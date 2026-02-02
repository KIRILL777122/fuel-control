import { PrismaClient, Prisma, ReceiptStatus } from "@prisma/client";
import { decodeQrFromImage } from "./qr-decoder.js";
import { recognizeByQr, recognizeByFile } from "./receipt-recognition.js";
import { sendMessage } from "./telegram-client.js";
import fs from "fs";
import path from "path";

const INTERVAL_MS = Number(process.env.PENDING_WORKER_INTERVAL_MS ?? 15000);
const BATCH_SIZE = Number(process.env.PENDING_WORKER_BATCH ?? 2);
const MAX_ATTEMPTS = Number(process.env.PENDING_WORKER_MAX_ATTEMPTS ?? 3);
const PROVIDER_TIMEOUT_MS = Number(process.env.PENDING_WORKER_TIMEOUT_MS ?? 15000);
const FILES_DIR = process.env.TELEGRAM_FILES_DIR || "/app/data/telegram";

async function recognizeWithTimeout(qrRaw?: string | null, imagePath?: string | null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    if (imagePath) {
      return await recognizeByFile(imagePath);
    }
    if (qrRaw) {
      return await recognizeByQr(qrRaw);
    }
    return { ok: false, note: "no qr data" };
  } finally {
    clearTimeout(timer);
  }
}

export function startPendingWorker(prisma: PrismaClient) {
  const savePdfFromUrl = async (url: string, receiptId: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.promises.mkdir(FILES_DIR, { recursive: true });
      const fileName = `receipt_${receiptId}.pdf`;
      const full = path.join(FILES_DIR, fileName);
      await fs.promises.writeFile(full, buffer);
      return full;
    } catch {
      return null;
    }
  };

  const formatDateTime = (date: Date) => {
    try {
      const dateStr = date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
      const timeStr = date.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
      return { dateStr, timeStr };
    } catch {
      return { dateStr: date.toISOString().slice(0, 10), timeStr: date.toISOString().slice(11, 16) };
    }
  };

  const notifyDriver = async (telegramUserId?: string | null, text?: string | null) => {
    if (!telegramUserId || !text) return;
    try {
      await sendMessage(telegramUserId, text);
    } catch (e) {
      console.error("[worker] failed to notify driver", e);
    }
  };

  async function tick() {
    try {
      const pending = await prisma.receipt.findMany({
        where: { status: ReceiptStatus.PENDING },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        include: { driver: { select: { id: true, telegramUserId: true } } },
      });

      for (const r of pending) {
        let qrRaw = (r.raw as any)?.qrRaw || r.qrRaw;
        const attempts = Number((r.raw as any)?.workerAttempts ?? 0);

        // попытка декодировать из изображения, если qrRaw отсутствует
        if (!qrRaw && r.imagePath) {
          qrRaw = await decodeQrFromImage(r.imagePath);
          if (qrRaw) {
            await prisma.receipt.update({
              where: { id: r.id },
              data: { qrRaw, raw: { ...(r.raw as any), workerNote: "qr decoded from image", workerAttempts: attempts } },
            });
          }
        }

        const suppressNotify = !!(r.raw as any)?.manualRecognize;

        if (!qrRaw && !r.imagePath) {
          await prisma.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.FAILED,
              raw: { ...(r.raw as any), workerNote: "no qrRaw after decode, mark FAILED", workerAttempts: attempts + 1 },
            },
          });
          if (!suppressNotify) {
            await notifyDriver(
              r.driver?.telegramUserId,
              "⚠️ QR-код должен быть хорошо виден на фото.\nОтправьте фото чека снова."
            );
          }
          continue;
        }

        if (attempts >= MAX_ATTEMPTS) {
          await prisma.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.FAILED,
              raw: { ...(r.raw as any), workerNote: `max attempts ${MAX_ATTEMPTS} reached`, workerAttempts: attempts },
            },
          });
          if (!suppressNotify) {
            await notifyDriver(
              r.driver?.telegramUserId,
              "⚠️ QR-код должен быть хорошо виден на фото.\nОтправьте фото чека снова."
            );
          }
          continue;
        }

        const provider = await recognizeWithTimeout(qrRaw, r.imagePath);
        if (!provider.ok) {
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

        const totalAmount =
          provider.totalAmount !== undefined
            ? new Prisma.Decimal(provider.totalAmount.toString())
            : r.totalAmount;
        const receiptAt = provider.receiptAt ?? r.receiptAt ?? new Date();
        const stationName = provider.stationName ?? r.stationName;
        const liters =
          provider.liters !== undefined && provider.liters !== null
            ? new Prisma.Decimal(provider.liters.toString())
            : r.liters;
        const pricePerLiter =
          provider.pricePerLiter !== undefined && provider.pricePerLiter !== null
            ? new Prisma.Decimal(provider.pricePerLiter.toString())
            : r.pricePerLiter;
        const addressShort = provider.addressShort ?? r.addressShort;
        const fuelType = provider.fuelType ?? r.fuelType;
        const fuelGroup = provider.fuelGroup ?? r.fuelGroup;
        let pdfPath = r.pdfPath ?? null;
        if (!pdfPath && provider.pdfUrl) {
          pdfPath = await savePdfFromUrl(provider.pdfUrl, r.id);
        }

        await prisma.$transaction(async (tx) => {
          await tx.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.DONE,
              receiptAt,
              totalAmount,
              stationName,
              qrRaw: qrRaw ?? r.qrRaw,
              liters,
              pricePerLiter,
              fuelType: fuelType as any,
              fuelGroup: fuelGroup as any,
              addressShort,
              pdfPath,
              raw: { ...(r.raw as any), provider: provider.raw, workerNote: provider.note ?? "provider ok", workerAttempts: attempts + 1 },
            },
          });

          if (provider.items && provider.items.length > 0) {
            await tx.receiptItem.deleteMany({ where: { receiptId: r.id } });
            const itemsData = provider.items.map((it: any) => ({
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
              isFuel: false,
              createdAt: new Date(),
            }));
            if (itemsData.length > 0) {
              await tx.receiptItem.createMany({ data: itemsData });
            }
          }
        });

        const { dateStr, timeStr } = receiptAt ? formatDateTime(receiptAt) : { dateStr: "", timeStr: "" };
        const money = totalAmount ? `${Number(totalAmount).toFixed(2)}`.replace(".", ",") : null;
        const lines = [
          "✅ Чек распознан успешно.",
          stationName ? `АЗС: ${stationName}` : null,
          money ? `Сумма: ${money}` : null,
          receiptAt ? `Дата: ${dateStr}` : null,
          receiptAt ? `Время: ${timeStr}` : null,
          "До встречи!",
        ].filter(Boolean) as string[];
        if (r.driver?.telegramUserId) {
          await sendMessage(r.driver.telegramUserId, lines.join("\n"), {
            keyboard: [[{ text: "/start" }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          });
        }
        if (r.driver?.id) {
          await prisma.driver.update({
            where: { id: r.driver.id },
            data: {
              pendingStep: null,
              pendingVehicleId: null,
              pendingMileage: null,
              pendingPaymentMethod: null,
              pendingReceiptId: null,
            },
          });
        }
      }
    } catch (e) {
      console.error("[worker] error", e);
    } finally {
      setTimeout(tick, INTERVAL_MS);
    }
  }

  setTimeout(tick, INTERVAL_MS);
}
