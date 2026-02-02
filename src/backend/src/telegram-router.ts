import { FastifyInstance } from "fastify";
import { PrismaClient, Prisma, ReceiptStatus } from "@prisma/client";
import { sendMessage, getFile, downloadFile, setWebhook } from "./telegram-client.js";
import { Update, CallbackQuery } from "./telegram-types.js";
import { createReceiptFromDto } from "./receipt-service.js";
import fs from "fs";
import path from "path";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const FILES_DIR = process.env.TELEGRAM_FILES_DIR || "/app/data/telegram";

const STEP_SELECT_VEHICLE = "SELECT_VEHICLE";
const STEP_MILEAGE = "MILEAGE";
const STEP_PAYMENT = "PAYMENT";
const STEP_PHOTO = "PHOTO";
const STEP_MANUAL_DATE = "MANUAL_DATE";
const STEP_MANUAL_FUEL = "MANUAL_FUEL";
const STEP_MANUAL_LITERS = "MANUAL_LITERS";
const STEP_MANUAL_TOTAL = "MANUAL_TOTAL";

function vehicleKeyboard(vehicles: { id: string; plateNumber: string | null }[]) {
  return {
    inline_keyboard: vehicles.map((v) => [
      { text: v.plateNumber || "без номера", callback_data: `vehicle:${v.id}` },
    ]),
  };
}

function paymentKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Карта", callback_data: "pay:CARD" },
        { text: "Наличные", callback_data: "pay:CASH" },
      ],
      [
        { text: "QR", callback_data: "pay:QR" },
        { text: "Оплатил сам", callback_data: "pay:SELF" },
      ],
      [{ text: "Назад", callback_data: "back:MILEAGE" }],
    ],
  };
}

function manualKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Перефоткать чек", callback_data: "redo:photo" },
        { text: "Ввести вручную", callback_data: "manual:start" },
      ],
      [{ text: "Назад", callback_data: "back:PHOTO" }],
    ],
  };
}

function fuelKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "АИ-92", callback_data: "fuel:AI92" },
        { text: "АИ-95", callback_data: "fuel:AI95" },
      ],
      [
        { text: "ДТ", callback_data: "fuel:DIESEL" },
        { text: "Газ", callback_data: "fuel:GAS" },
      ],
      [{ text: "Назад", callback_data: "back:FUEL" }],
    ],
  };
}

async function ensureDriver(prisma: PrismaClient, telegramId: string, name?: string) {
  return prisma.driver.upsert({
    where: { telegramUserId: telegramId },
    update: { 
      isActive: true, 
      lastSeenAt: new Date(),
      // Не перезаписываем имя автоматически, чтобы не затирать ручные правки на сайте
    },
    create: {
      telegramUserId: telegramId,
      fullName: name ?? telegramId,
      isActive: true,
      lastSeenAt: new Date(),
    },
  });
}

async function listActiveVehicles(prisma: PrismaClient) {
  return prisma.vehicle.findMany({
    where: { isActive: true, isTelegramEnabled: true },
    orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
    take: 10,
    select: { id: true, plateNumber: true },
  });
}

async function saveFile(buffer: Buffer, fileName: string) {
  await fs.promises.mkdir(FILES_DIR, { recursive: true });
  const full = path.join(FILES_DIR, fileName);
  await fs.promises.writeFile(full, buffer);
  return full;
}

export function registerTelegramRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/telegram/health", async () => ({ ok: true }));

  app.post("/telegram/set-webhook", async (req, reply) => {
    const adminKey = process.env.ADMIN_API_KEY;
    if (adminKey && req.headers["x-admin-key"] !== adminKey) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (!webhookUrl) return reply.code(400).send({ error: "TELEGRAM_WEBHOOK_URL not set" });
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await setWebhook(webhookUrl, secret);
    return { ok: true, webhook: webhookUrl, telegram: res };
  });

  app.post("/telegram/webhook", async (req, reply) => {
    const secretEnv = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secretEnv) {
      const incoming = req.headers["x-telegram-bot-api-secret-token"];
      if (incoming !== secretEnv) {
        return reply.code(401).send({ error: "invalid secret token" });
      }
    }

    const update = req.body as Update;
    if (!update) return { ok: true };

    const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
    const userId = update.message?.from?.id || update.callback_query?.from?.id;
    if (!chatId || !userId) return { ok: true };

    const telegramId = userId.toString();
    const existingDriver = await prisma.driver.findUnique({ where: { telegramUserId: telegramId } });

    // Handle unauthorized users
    if (!existingDriver || !existingDriver.isActive) {
      const isStart = update.message?.text?.trim() === "/start";
      await sendMessage(
        chatId,
        `❌ Вы не авторизованы.\n\nОбратитесь к администратору.\n\nВаш ID: \`${telegramId}\``,
        { parse_mode: "Markdown" }
      );
      if (!isStart) await sendMessage(chatId, "Нажмите /start, если хотите начать сначала.");
      return { ok: true };
    }

    // Update lastSeen
    await prisma.driver.update({ where: { id: existingDriver.id }, data: { lastSeenAt: new Date() } });

    // 1. Handle Callback Queries
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || "";
      const driver = existingDriver;

      if (data.startsWith("vehicle:")) {
        const vehicleId = data.replace("vehicle:", "");
        const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingVehicleId: vehicleId, pendingStep: STEP_MILEAGE },
        });
        await sendMessage(chatId, `Выбрано:\n✅ ${vehicle?.plateNumber || "без номера"}\n\nВведи пробег (числом).\n⚠️ Напишите пробег числом, как на приборной панели авто`, {
          reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:VEHICLE" }]] },
        });
        return { ok: true };
      }

      if (data.startsWith("pay:")) {
        const pm = data.replace("pay:", "");
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingPaymentMethod: pm as any, pendingStep: STEP_PHOTO },
        });
        await sendMessage(
          chatId,
          "✅ Авто выбрано\n✅ Пробег введён\n✅ Способ оплаты выбран\n\nОтправьте фото/документ чека.\n\n⚠️ QR-код должен быть хорошо виден на фото."
        );
        return { ok: true };
      }

      if (data === "manual:start") {
        if (!driver.pendingVehicleId) {
          await sendMessage(chatId, "Сначала выбери авто: напиши /fuel");
          return { ok: true };
        }
        const vehicle = await prisma.vehicle.findUnique({ where: { id: driver.pendingVehicleId } });
        if (!vehicle) {
          await sendMessage(chatId, "Авто не найдено, начни сначала: /fuel");
          return { ok: true };
        }
        const draft = await createReceiptFromDto(prisma, {
          driver: { telegramUserId: driver.telegramUserId, fullName: driver.fullName },
          vehicle: { name: vehicle.name, plateNumber: vehicle.plateNumber },
          receipt: {
            stationName: "manual",
            totalAmount: 0,
            mileage: driver.pendingMileage ?? null,
            status: "PENDING",
            paymentMethod: driver.pendingPaymentMethod ?? undefined,
            dataSource: "MANUAL",
            raw: { source: "telegram-manual" },
          },
          items: [],
        });
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingReceiptId: draft.receipt.id, pendingStep: STEP_MANUAL_DATE },
        });
        await sendMessage(chatId, "Введи дату и время чека в формате YYYY-MM-DD HH:MM (МСК).", {
          reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:PAYMENT" }]] },
        });
        return { ok: true };
      }

      if (data === "redo:photo") {
        await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_PHOTO } });
        await sendMessage(
          chatId,
          "Отправьте фото/документ чека.\n\n⚠️ QR-код должен быть хорошо виден на фото."
        );
        return { ok: true };
      }

      if (data.startsWith("fuel:")) {
        const ft = data.replace("fuel:", "");
        if (driver.pendingReceiptId) {
          await prisma.receipt.update({
            where: { id: driver.pendingReceiptId },
            data: {
              fuelType: ft as any,
              fuelGroup: ft === "AI92" || ft === "AI95" ? "BENZIN" : ft === "DIESEL" ? "DIESEL" : ft === "GAS" ? "GAS" : "OTHER",
            },
          });
        }
        await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_MANUAL_LITERS } });
        await sendMessage(chatId, "Введи литры (числом, можно с точкой).");
        return { ok: true };
      }

      if (data.startsWith("back:")) {
        const step = data.replace("back:", "");
        if (step === "VEHICLE") {
          const vehicles = await listActiveVehicles(prisma);
          await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_SELECT_VEHICLE, pendingVehicleId: null } });
          await sendMessage(chatId, "Выбери авто (госномер):", { reply_markup: vehicleKeyboard(vehicles) });
        } else if (step === "MILEAGE") {
          await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_MILEAGE, pendingPaymentMethod: null } });
          await sendMessage(chatId, "Введи пробег (числом).", { reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:VEHICLE" }]] } });
        } else if (step === "PHOTO" || step === "PAYMENT") {
          await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_PAYMENT, pendingPaymentMethod: null } });
          await sendMessage(chatId, "Выбери способ оплаты:", { reply_markup: paymentKeyboard() });
        } else if (step === "FUEL") {
          await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_MANUAL_DATE } });
          await sendMessage(chatId, "Введи дату и время чека в формате YYYY-MM-DD HH:MM (МСК).", { reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:PAYMENT" }]] } });
        } else if (step === "MANUAL_FUEL") {
          await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_MANUAL_FUEL } });
          await sendMessage(chatId, "Выбери тип топлива:", { reply_markup: fuelKeyboard() });
        } else if (step === "MANUAL_LITERS") {
          await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_MANUAL_LITERS } });
          await sendMessage(chatId, "Введи литры (числом, можно с точкой).", { reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:MANUAL_FUEL" }]] } });
        }
        return { ok: true };
      }
      return { ok: true };
    }

    // 2. Handle Messages
    if (update.message) {
      const msg = update.message;
      const text = msg.text?.trim();
      const driver = existingDriver;

      // Check for Start commands
      if (text === "/start" || text === "/fuel" || text === "/help" || text?.toLowerCase() === "start") {
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_SELECT_VEHICLE, pendingVehicleId: null, pendingMileage: null, pendingPaymentMethod: null, pendingReceiptId: null },
        });
        const vehicles = await listActiveVehicles(prisma);
        await sendMessage(chatId, "Выбери авто (госномер):", { reply_markup: vehicleKeyboard(vehicles) });
        return { ok: true };
      }

      // Handle Photos/Documents
      const photo = msg.photo?.[msg.photo.length - 1];
      const doc = msg.document;
      const fileId = photo?.file_id || doc?.file_id;

      if (fileId) {
        if (!driver.pendingVehicleId || !driver.pendingPaymentMethod) {
          await sendMessage(chatId, "Сначала выбери авто и оплату: напиши /fuel");
          return { ok: true };
        }

        // ОТПРАВЛЯЕМ СООБЩЕНИЕ О НАЧАЛЕ РАСПОЗНАВАНИЯ СРАЗУ
        await sendMessage(chatId, "🤔 Идёт распознавание чека...");

        try {
          const info = await getFile(fileId);
          const filePath = info?.result?.file_path;
          if (!filePath) {
            await sendMessage(chatId, "Не удалось получить файл. Попробуйте ещё раз.");
            return { ok: true };
          }
          const buffer = await downloadFile(filePath);
          const ext = path.extname(filePath || "") || ".jpg";
          const storedPath = await saveFile(buffer, `${fileId}${ext}`);

          const vehicle = driver.pendingVehicleId
            ? await prisma.vehicle.findUnique({ where: { id: driver.pendingVehicleId } })
            : null;
          const created = await createReceiptFromDto(prisma, {
            driver: { telegramUserId: driver.telegramUserId, fullName: driver.fullName },
            vehicle: { name: vehicle?.name, plateNumber: vehicle?.plateNumber },
            receipt: {
              stationName: "telegram",
              totalAmount: 0,
              mileage: driver.pendingMileage ?? null,
              status: "PENDING",
              paymentMethod: driver.pendingPaymentMethod ?? undefined,
              imagePath: storedPath,
              raw: { source: "telegram-file", fileId, storedPath },
            },
            items: [{ name: "Pending", quantity: null, unitPrice: null, amount: null }],
          });

          await prisma.driver.update({
            where: { id: driver.id },
            data: { pendingStep: STEP_PHOTO, pendingReceiptId: created.receipt.id },
          });
        } catch (e) {
          app.log.error(e, "Error processing photo");
          await sendMessage(chatId, "Ошибка при сохранении чека. Попробуйте ещё раз.");
        }
        return { ok: true };
      }

      // Handle Text inputs based on state
      if (text) {
        if (driver.pendingStep === STEP_MILEAGE) {
          const mileage = Number(text);
          if (isNaN(mileage)) {
            await sendMessage(chatId, "Пробег должен быть числом. Введи ещё раз.");
          } else {
            await prisma.driver.update({ where: { id: driver.id }, data: { pendingMileage: Math.round(mileage), pendingStep: STEP_PAYMENT } });
            await sendMessage(chatId, "✅ Авто выбрано\n✅ Пробег введён\n\nВыберите способ оплаты:", { reply_markup: paymentKeyboard() });
          }
          return { ok: true };
        }

        if (driver.pendingStep === STEP_MANUAL_DATE) {
          const parsed = new Date(text.replace(" ", "T") + ":00Z");
          if (isNaN(parsed.getTime())) {
            await sendMessage(chatId, "Дата/время не распознаны. Формат: YYYY-MM-DD HH:MM");
          } else {
            if (driver.pendingReceiptId) {
              await prisma.receipt.update({ where: { id: driver.pendingReceiptId }, data: { receiptAt: parsed } });
            }
            await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_MANUAL_FUEL } });
            await sendMessage(chatId, "Выбери тип топлива:", { reply_markup: fuelKeyboard() });
          }
          return { ok: true };
        }

        if (driver.pendingStep === STEP_MANUAL_LITERS) {
          const liters = Number(text.replace(",", "."));
          if (isNaN(liters) || liters <= 0) {
            await sendMessage(chatId, "Литры должны быть числом > 0. Введи ещё раз.");
          } else {
            if (driver.pendingReceiptId) {
              await prisma.receipt.update({ where: { id: driver.pendingReceiptId }, data: { liters: new Prisma.Decimal(liters.toString()) } });
            }
            await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: STEP_MANUAL_TOTAL } });
            await sendMessage(chatId, "Введи сумму (руб), число.", { reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:MANUAL_FUEL" }]] } });
          }
          return { ok: true };
        }

        if (driver.pendingStep === STEP_MANUAL_TOTAL) {
          const total = Number(text.replace(",", "."));
          if (isNaN(total) || total <= 0) {
            await sendMessage(chatId, "Сумма должна быть числом > 0. Введи ещё раз.");
          } else if (driver.pendingReceiptId) {
            const receipt = await prisma.receipt.findUnique({ where: { id: driver.pendingReceiptId } });
            if (receipt) {
              await prisma.receipt.update({
                where: { id: receipt.id },
                data: {
                  totalAmount: new Prisma.Decimal(total.toString()),
                  pricePerLiter: receipt.liters && !receipt.liters.isZero() ? new Prisma.Decimal(total.toString()).div(receipt.liters) : null,
                  status: ReceiptStatus.DONE,
                  dataSource: "MANUAL",
                  raw: { ...(receipt.raw as any), manual: true },
                },
              });
              await prisma.receiptItem.deleteMany({ where: { receiptId: receipt.id } });
              await prisma.receiptItem.create({
                data: { receiptId: receipt.id, name: receipt.fuelType || "Fuel", quantity: receipt.liters, amount: new Prisma.Decimal(total.toString()), isFuel: true },
              });
              await prisma.driver.update({ where: { id: driver.id }, data: { pendingStep: null, pendingReceiptId: null, pendingMileage: null, pendingPaymentMethod: null } });
              await sendMessage(chatId, "✅ Чек добавлен вручную.");
            }
          }
          return { ok: true };
        }

        // If no state matched and it's just text
        await sendMessage(chatId, "Нажмите /start, если хотите начать сначала.");
      }
    }

    return { ok: true };
  });
}



