import { PrismaClient, Prisma, ReceiptStatus } from "@prisma/client";
import { decodeQrFromImage } from "./qr-decoder.js";
import { recognizeByQr } from "./receipt-recognition.js";
import { sendMessage } from "./telegram-client.js";

const STEP_PHOTO = "PHOTO";

function detectFuelType(name: string): { type: string | null; group: string | null } {
  const lower = name.toLowerCase();
  if (lower.includes("92") || lower.includes("аи-92") || lower.includes("ai-92")) {
    return { type: "AI92", group: "BENZIN" };
  }
  if (lower.includes("95") || lower.includes("аи-95") || lower.includes("ai-95")) {
    return { type: "AI95", group: "BENZIN" };
  }
  if (lower.includes("дт") || lower.includes("дизель") || lower.includes("diesel")) {
    return { type: "DIESEL", group: "DIESEL" };
  }
  if (lower.includes("газ") || lower.includes("lpg") || lower.includes("cng")) {
    return { type: "GAS", group: "GAS" };
  }
  return { type: null, group: null };
}

const INTERVAL_MS = Number(process.env.PENDING_WORKER_INTERVAL_MS ?? 15000);
const BATCH_SIZE = Number(process.env.PENDING_WORKER_BATCH ?? 2);
const MAX_ATTEMPTS = Number(process.env.PENDING_WORKER_MAX_ATTEMPTS ?? 3);
const PROVIDER_TIMEOUT_MS = Number(process.env.PENDING_WORKER_TIMEOUT_MS ?? 15000);

async function recognizeWithTimeout(qrRaw: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    // recognizeByQr does not accept AbortController options; just race on abort
    const res = await recognizeByQr(qrRaw);
    if (controller.signal.aborted) {
      return { ok: false, note: "provider timeout (aborted)" };
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function startPendingWorker(prisma: PrismaClient) {
  console.log(`[pending-worker] Starting worker: interval=${INTERVAL_MS}ms, batch=${BATCH_SIZE}, maxAttempts=${MAX_ATTEMPTS}`);
  
  async function tick() {
    try {
      const pending = await prisma.receipt.findMany({
        where: { status: ReceiptStatus.PENDING },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
      });

      if (pending.length > 0) {
        console.log(`[pending-worker] Found ${pending.length} pending receipt(s) to process`);
      }

      for (const r of pending) {
        console.log(`[pending-worker] Processing receipt ${r.id}, attempts=${(r.raw as any)?.workerAttempts ?? 0}`);
        let qrRaw = (r.raw as any)?.qrRaw || r.qrRaw;
        const attempts = Number((r.raw as any)?.workerAttempts ?? 0);

        // попытка декодировать из изображения, если qrRaw отсутствует
        if (!qrRaw && r.imagePath) {
          console.log(`[pending-worker] Attempting to decode QR from image: ${r.imagePath}`);
          qrRaw = await decodeQrFromImage(r.imagePath);
          if (qrRaw) {
            console.log(`[pending-worker] QR decoded successfully from image`);
            await prisma.receipt.update({
              where: { id: r.id },
              data: { qrRaw, raw: { ...(r.raw as any), workerNote: "qr decoded from image", workerAttempts: attempts } },
            });
          } else {
            console.log(`[pending-worker] Failed to decode QR from image`);
            // Если QR не распознан локально, но есть изображение, оставляем чек в PENDING
            // чтобы попробовать еще раз в следующих попытках (может быть, изображение обработается лучше)
            // Ставим FAILED только если достигнуто максимальное количество попыток
            if (attempts >= MAX_ATTEMPTS - 1) {
              // Предпоследняя или последняя попытка - если QR все еще не найден, ставим FAILED
              console.log(`[pending-worker] No QR code found after ${attempts + 1} attempts, marking as FAILED`);
              await prisma.receipt.update({
                where: { id: r.id },
                data: {
                  status: ReceiptStatus.FAILED,
                  raw: { ...(r.raw as any), workerNote: "no qrRaw after decode, mark FAILED", workerAttempts: attempts + 1 },
                },
              });
              
              // Send notification to driver with retry request
              try {
                const receiptWithDetails = await prisma.receipt.findUnique({
                  where: { id: r.id },
                  include: { driver: true, vehicle: true },
                });
                if (receiptWithDetails?.driver?.telegramUserId) {
                  const vehiclePlate = receiptWithDetails.vehicle?.plateNumber || "не выбрано";
                  const mileage = receiptWithDetails.mileage ? `${receiptWithDetails.mileage}` : "не указан";
                  
                  // Преобразуем способ оплаты в читаемый формат
                  const paymentMethodNames: Record<string, string> = {
                    CARD: "Карта",
                    CASH: "Наличные",
                    QR: "QR-код",
                    SELF: "Оплатил сам",
                  };
                  const paymentMethodName = receiptWithDetails.paymentMethod
                    ? paymentMethodNames[receiptWithDetails.paymentMethod] || receiptWithDetails.paymentMethod
                    : "не указан";
                  
                  const summary = `✅ Номер авто: ${vehiclePlate}\n✅ Пробег: ${mileage}\n✅ Способ оплаты: ${paymentMethodName}`;
                  const message = `${summary}\n\n❗ Чек не распознан.\n\nОтправьте фото чека снова.\n⚠️ QR-код должен быть хорошо виден на фото.`;
                  
                  await sendMessage(receiptWithDetails.driver.telegramUserId, message);
                  console.log(`[pending-worker] FAILED notification sent to driver ${receiptWithDetails.driver.telegramUserId}`);
                  
                  // Восстанавливаем состояние водителя для повторной отправки фото
                  // чтобы не нужно было заново выбирать авто, пробег и способ оплаты
                  await prisma.driver.update({
                    where: { id: receiptWithDetails.driver.id },
                    data: {
                      pendingVehicleId: receiptWithDetails.vehicleId,
                      pendingMileage: receiptWithDetails.mileage,
                      pendingPaymentMethod: receiptWithDetails.paymentMethod as any,
                      pendingStep: STEP_PHOTO,
                    },
                  });
                  console.log(`[pending-worker] Driver state restored for retry: vehicle=${receiptWithDetails.vehicleId}, mileage=${receiptWithDetails.mileage}, payment=${receiptWithDetails.paymentMethod}`);
                }
              } catch (notifErr) {
                console.error(`[pending-worker] Failed to send FAILED notification for receipt ${r.id}:`, notifErr);
              }
              
              continue;
            } else {
              // Увеличиваем счетчик попыток и оставляем в PENDING для следующей попытки
              await prisma.receipt.update({
                where: { id: r.id },
                data: {
                  raw: { ...(r.raw as any), workerNote: "qr not decoded, will retry", workerAttempts: attempts + 1 },
                },
              });
              console.log(`[pending-worker] QR not found, will retry. Attempt ${attempts + 1}/${MAX_ATTEMPTS}`);
              continue;
            }
          }
        }

        // Если QR все еще не найден и нет изображения для декодирования
        if (!qrRaw && !r.imagePath) {
          console.log(`[pending-worker] No QR code and no image path, marking as FAILED`);
          await prisma.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.FAILED,
              raw: { ...(r.raw as any), workerNote: "no qrRaw and no imagePath, mark FAILED", workerAttempts: attempts + 1 },
            },
          });
          continue;
        }

        if (attempts >= MAX_ATTEMPTS) {
          console.log(`[pending-worker] Max attempts (${MAX_ATTEMPTS}) reached for receipt ${r.id}, marking as FAILED`);
          await prisma.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.FAILED,
              raw: { ...(r.raw as any), workerNote: `max attempts ${MAX_ATTEMPTS} reached`, workerAttempts: attempts },
            },
          });
          
          // Send notification to driver with retry request
          try {
            const receiptWithDetails = await prisma.receipt.findUnique({
              where: { id: r.id },
              include: { driver: true, vehicle: true },
            });
            if (receiptWithDetails?.driver?.telegramUserId) {
              const vehiclePlate = receiptWithDetails.vehicle?.plateNumber || "не выбрано";
              const mileage = receiptWithDetails.mileage ? `${receiptWithDetails.mileage}` : "не указан";
              
              // Преобразуем способ оплаты в читаемый формат
              const paymentMethodNames: Record<string, string> = {
                CARD: "Карта",
                CASH: "Наличные",
                QR: "QR-код",
                SELF: "Оплатил сам",
              };
              const paymentMethodName = receiptWithDetails.paymentMethod
                ? paymentMethodNames[receiptWithDetails.paymentMethod] || receiptWithDetails.paymentMethod
                : "не указан";
              
              const summary = `✅ Номер авто: ${vehiclePlate}\n✅ Пробег: ${mileage}\n✅ Способ оплаты: ${paymentMethodName}`;
              const message = `${summary}\n\n❗ Чек не распознан.\n\nОтправьте фото чека снова.\n⚠️ QR-код должен быть хорошо виден на фото.`;
              
              await sendMessage(receiptWithDetails.driver.telegramUserId, message);
              console.log(`[pending-worker] FAILED notification sent to driver ${receiptWithDetails.driver.telegramUserId}`);
              
              // Восстанавливаем состояние водителя для повторной отправки фото
              // чтобы не нужно было заново выбирать авто, пробег и способ оплаты
              await prisma.driver.update({
                where: { id: receiptWithDetails.driver.id },
                data: {
                  pendingVehicleId: receiptWithDetails.vehicleId,
                  pendingMileage: receiptWithDetails.mileage,
                  pendingPaymentMethod: receiptWithDetails.paymentMethod as any,
                  pendingStep: STEP_PHOTO,
                },
              });
              console.log(`[pending-worker] Driver state restored for retry: vehicle=${receiptWithDetails.vehicleId}, mileage=${receiptWithDetails.mileage}, payment=${receiptWithDetails.paymentMethod}`);
            }
          } catch (notifErr) {
            console.error(`[pending-worker] Failed to send FAILED notification for receipt ${r.id}:`, notifErr);
          }
          
          continue;
        }

        console.log(`[pending-worker] Calling recognition API for receipt ${r.id} (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
        const provider = await recognizeWithTimeout(qrRaw);
        if (!provider.ok) {
          console.log(`[pending-worker] Recognition failed for receipt ${r.id}: ${provider.note}`);
          await prisma.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.PENDING,
              raw: {
                ...(r.raw as any),
                workerNote: provider.note || "provider failed",
                providerResponse: provider.raw,
                workerAttempts: attempts + 1,
              },
            },
          });
          continue;
        }

        console.log(`[pending-worker] Recognition successful for receipt ${r.id}, updating to DONE`);

        const totalAmount =
          provider.totalAmount !== undefined
            ? new Prisma.Decimal(provider.totalAmount.toString())
            : r.totalAmount;
        const receiptAt = provider.receiptAt ?? r.receiptAt ?? new Date();
        const stationName = provider.stationName ?? r.stationName;
        const addressShort = provider.addressShort ?? r.addressShort;
        const liters = provider.liters !== undefined && provider.liters !== null
          ? new Prisma.Decimal(provider.liters.toString())
          : r.liters;
        const pricePerLiter = provider.pricePerLiter !== undefined && provider.pricePerLiter !== null
          ? new Prisma.Decimal(provider.pricePerLiter.toString())
          : r.pricePerLiter;
        
        // Map fuel type
        let fuelType: any = r.fuelType;
        if (provider.fuelType) {
          const ft = provider.fuelType.toUpperCase();
          if (["AI92", "AI95", "DIESEL", "GAS", "OTHER"].includes(ft)) {
            fuelType = ft;
          }
        }
        
        let fuelGroup: any = r.fuelGroup;
        if (provider.fuelGroup) {
          const fg = provider.fuelGroup.toUpperCase();
          if (["BENZIN", "DIESEL", "GAS", "OTHER"].includes(fg)) {
            fuelGroup = fg;
          }
        }

        // Download PDF if URL is provided
        let pdfPath: string | null = r.pdfPath;
        if (provider.pdfUrl && !pdfPath) {
          try {
            const pdfRes = await fetch(provider.pdfUrl);
            if (pdfRes.ok) {
              const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
              const pdfFileName = `${r.id}.pdf`;
              const FILES_DIR = process.env.TELEGRAM_FILES_DIR || "/app/data/telegram";
              const fs = await import("fs");
              const path = await import("path");
              await fs.promises.mkdir(FILES_DIR, { recursive: true });
              pdfPath = path.join(FILES_DIR, pdfFileName);
              await fs.promises.writeFile(pdfPath, pdfBuffer);
              console.log(`[pending-worker] PDF saved to ${pdfPath}`);
            }
          } catch (pdfErr) {
            console.error(`[pending-worker] Failed to download PDF:`, pdfErr);
          }
        }

        await prisma.$transaction(async (tx) => {
          await tx.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.DONE,
              receiptAt,
              totalAmount,
              stationName,
              addressShort,
              liters,
              pricePerLiter,
              fuelType,
              fuelGroup,
              pdfPath,
              qrRaw,
              raw: { ...(r.raw as any), provider: provider.raw, workerNote: provider.note ?? "provider ok", workerAttempts: attempts + 1 },
            },
          });

          if (provider.items && provider.items.length > 0) {
            await tx.receiptItem.deleteMany({ where: { receiptId: r.id } });
            const itemsData = provider.items.map((it: any) => {
              const itemName = (it.name || it.description || "item").toLowerCase();
              const fuelDetected = detectFuelType(itemName);
              const isFuel = !!fuelDetected.type;
              
              return {
                receiptId: r.id,
                name: it.name || it.description || "item",
                quantity:
                  it.quantity !== undefined && it.quantity !== null
                    ? new Prisma.Decimal(it.quantity.toString())
                    : null,
                unitPrice:
                  it.price !== undefined && it.price !== null
                    ? new Prisma.Decimal(it.price.toString())
                    : it.unitPrice !== undefined && it.unitPrice !== null
                      ? new Prisma.Decimal(it.unitPrice.toString())
                      : null,
                amount:
                  it.sum !== undefined && it.sum !== null
                    ? new Prisma.Decimal(it.sum.toString())
                    : it.amount !== undefined && it.amount !== null
                      ? new Prisma.Decimal(it.amount.toString())
                      : null,
                isFuel,
                createdAt: new Date(),
              };
            });
            if (itemsData.length > 0) {
              await tx.receiptItem.createMany({ data: itemsData });
              console.log(`[pending-worker] Created ${itemsData.length} items for receipt ${r.id}`);
            }
          }
        });
        console.log(`[pending-worker] Receipt ${r.id} marked as DONE`);

        // Send notification to driver via Telegram
        try {
          const receiptWithDriver = await prisma.receipt.findUnique({
            where: { id: r.id },
            include: { driver: true },
          });
          if (receiptWithDriver?.driver?.telegramUserId) {
            const total = receiptWithDriver.totalAmount?.toString() || "0";
            const station = receiptWithDriver.stationName || "неизвестная АЗС";
            const date = receiptWithDriver.receiptAt
              ? new Date(receiptWithDriver.receiptAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
              : "не указана";
            const message = `✅ Чек распознан успешно!\n\n` +
              `АЗС: ${station}\n` +
              `Сумма: ${total} ₽\n` +
              `Дата: ${date}`;
            await sendMessage(receiptWithDriver.driver.telegramUserId, message);
            // Отправляем кликабельный /start после успешного распознавания
            await sendMessage(receiptWithDriver.driver.telegramUserId, "Нажмите /start, чтобы отправить новый чек.");
            console.log(`[pending-worker] Notification sent to driver ${receiptWithDriver.driver.telegramUserId}`);
          }
        } catch (notifErr) {
          console.error(`[pending-worker] Failed to send notification for receipt ${r.id}:`, notifErr);
        }
      }
    } catch (e) {
      console.error("[pending-worker] error", e);
    } finally {
      setTimeout(tick, INTERVAL_MS);
    }
  }

  setTimeout(tick, INTERVAL_MS);
  console.log(`[pending-worker] Worker started, first tick scheduled in ${INTERVAL_MS}ms`);
}
