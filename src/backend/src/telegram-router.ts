import { FastifyInstance } from "fastify";
import { PrismaClient, Prisma, ReceiptStatus } from "@prisma/client";
import { sendMessage, getFile, downloadFile, setWebhook } from "./telegram-client";
import { Update, CallbackQuery } from "./telegram-types";
import { createReceiptFromDto } from "./receipt-service";
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
    update: { isActive: true, lastSeenAt: new Date(), fullName: name ?? undefined },
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
    where: { isActive: true },
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

    // Handle callback_query (inline keyboard)
    if (update.callback_query) {
      const cb: CallbackQuery = update.callback_query;
      const data: string = cb.data || "";
      const chatId = cb.message?.chat?.id;
      const userId = cb.from?.id;
      if (!chatId) return { ok: true };
      const telegramId = (userId ?? chatId).toString();

      const driver = await ensureDriver(prisma, telegramId, cb.from?.first_name);

      if (data.startsWith("vehicle:")) {
        const vehicleId = data.replace("vehicle:", "");
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingVehicleId: vehicleId, pendingStep: STEP_MILEAGE },
        });
        await sendMessage(chatId, "Введи пробег (числом).", {
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
        await sendMessage(chatId, "Отправь фото/документ чека или выбери действие.", { reply_markup: manualKeyboard() });
        return { ok: true };
      }

      if (data === "manual:start") {
        if (!driver.pendingVehicleId) {
          await sendMessage(chatId, "Сначала выбери авто: напиши /fuel");
          return { ok: true };
        }
        // создать/обновить черновик чека под ручной ввод
        if (!driver.pendingReceiptId) {
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
              liters: null,
              pricePerLiter: null,
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
            data: { pendingReceiptId: draft.receipt.id },
          });
        }
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_MANUAL_DATE },
        });
        await sendMessage(chatId, "Введи дату и время чека в формате YYYY-MM-DD HH:MM (МСК).", {
          reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:PAYMENT" }]] },
        });
        return { ok: true };
      }

      if (data === "redo:photo") {
        let paymentMethod = driver.pendingPaymentMethod;
        if (!paymentMethod && driver.pendingReceiptId) {
          const existing = await prisma.receipt.findUnique({ where: { id: driver.pendingReceiptId } });
          paymentMethod = existing?.paymentMethod ?? null;
        }
        if (!paymentMethod) {
          await sendMessage(chatId, "Сначала выбери оплату: напиши /fuel");
          return { ok: true };
        }
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_PHOTO, pendingPaymentMethod: paymentMethod as any },
        });
        await sendMessage(chatId, "Отправь фото/документ чека или выбери действие.", { reply_markup: manualKeyboard() });
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
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_MANUAL_LITERS },
        });
        await sendMessage(chatId, "Введи литры (числом, можно с точкой).");
        return { ok: true };
      }

      if (data.startsWith("back:")) {
        const step = data.replace("back:", "");
        if (step === "VEHICLE") {
          const vehicles = await listActiveVehicles(prisma);
          await prisma.driver.update({
            where: { id: driver.id },
            data: { pendingStep: STEP_SELECT_VEHICLE, pendingVehicleId: null, pendingMileage: null, pendingPaymentMethod: null },
          });
          await sendMessage(chatId, "Выбери авто (госномер):", { reply_markup: vehicleKeyboard(vehicles) });
          return { ok: true };
        }
        if (step === "MILEAGE") {
          await prisma.driver.update({
            where: { id: driver.id },
            data: { pendingStep: STEP_MILEAGE, pendingPaymentMethod: null },
          });
          await sendMessage(chatId, "Введи пробег (числом).", {
            reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:VEHICLE" }]] },
          });
          return { ok: true };
        }
        if (step === "PHOTO") {
          await prisma.driver.update({
            where: { id: driver.id },
            data: { pendingStep: STEP_PAYMENT },
          });
          await sendMessage(chatId, "Выбери способ оплаты:", { reply_markup: paymentKeyboard() });
          return { ok: true };
        }
        if (step === "PAYMENT") {
          await prisma.driver.update({
            where: { id: driver.id },
            data: { pendingPaymentMethod: null, pendingStep: STEP_PAYMENT },
          });
          await sendMessage(chatId, "Выбери способ оплаты:", { reply_markup: paymentKeyboard() });
          return { ok: true };
        }
        if (step === "FUEL") {
          await prisma.driver.update({
            where: { id: driver.id },
            data: { pendingStep: STEP_MANUAL_DATE },
          });
          await sendMessage(chatId, "Введи дату и время чека в формате YYYY-MM-DD HH:MM (МСК).", {
            reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:PAYMENT" }]] },
          });
          return { ok: true };
        }
        if (step === "MANUAL_FUEL") {
          await prisma.driver.update({
            where: { id: driver.id },
            data: { pendingStep: STEP_MANUAL_FUEL },
          });
          await sendMessage(chatId, "Выбери тип топлива:", { reply_markup: fuelKeyboard() });
          return { ok: true };
        }
        if (step === "MANUAL_LITERS") {
          await prisma.driver.update({
            where: { id: driver.id },
            data: { pendingStep: STEP_MANUAL_LITERS },
          });
          await sendMessage(chatId, "Введи литры (числом, можно с точкой).", {
            reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:MANUAL_FUEL" }]] },
          });
          return { ok: true };
        }
      }

      return { ok: true };
    }

    if (!update.message) return { ok: true };

    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    // track lastSeen
    if (userId) {
      await prisma.driver.updateMany({
        where: { telegramUserId: userId.toString() },
        data: { lastSeenAt: new Date() },
      });
    }

    const telegramId = (userId ?? chatId).toString();

    // handle callbacks (not in this handler, only message)
    if (msg.text) {
      const text = msg.text.trim();
      if (text === "/start" || text === "/help" || text === "/fuel") {
        const driver = await ensureDriver(prisma, telegramId, msg.from?.first_name);
        await prisma.driver.update({
          where: { id: driver.id },
          data: {
            pendingStep: STEP_SELECT_VEHICLE,
            pendingVehicleId: null,
            pendingMileage: null,
            pendingPaymentMethod: null,
            pendingReceiptId: null,
          },
        });
        const vehicles = await listActiveVehicles(prisma);
        await sendMessage(chatId, "Выбери авто (госномер):", {
          reply_markup: vehicleKeyboard(vehicles),
        });
        return { ok: true };
      }

      // mileage step
      const driver = await prisma.driver.findUnique({
        where: { telegramUserId: telegramId },
      });
      if (driver?.pendingStep === STEP_MILEAGE) {
        const mileage = Number(text);
        if (Number.isNaN(mileage)) {
          await sendMessage(chatId, "Пробег должен быть числом. Введи ещё раз.");
          return { ok: true };
        }
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingMileage: Math.round(mileage), pendingStep: STEP_PAYMENT },
        });
        await sendMessage(chatId, "Выбери способ оплаты:", { reply_markup: paymentKeyboard() });
        return { ok: true };
      }

      // manual date/time
      const driverManual = await prisma.driver.findUnique({ where: { telegramUserId: telegramId } });
      if (driverManual?.pendingStep === STEP_MANUAL_DATE) {
        const parsed = new Date(text.replace(" ", "T") + ":00Z");
        if (isNaN(parsed.getTime())) {
          await sendMessage(chatId, "Дата/время не распознаны. Формат: YYYY-MM-DD HH:MM");
          return { ok: true };
        }
        if (driverManual.pendingReceiptId) {
          await prisma.receipt.update({
            where: { id: driverManual.pendingReceiptId },
            data: { receiptAt: parsed, status: ReceiptStatus.PENDING },
          });
        }
        await prisma.driver.update({
          where: { id: driverManual.id },
          data: { pendingStep: STEP_MANUAL_FUEL },
        });
        await sendMessage(chatId, "Выбери тип топлива:", { reply_markup: fuelKeyboard() });
        return { ok: true };
      }

      if (driverManual?.pendingStep === STEP_MANUAL_LITERS) {
        const liters = Number(text.replace(",", "."));
        if (Number.isNaN(liters) || liters <= 0) {
          await sendMessage(chatId, "Литры должны быть числом > 0. Введи ещё раз.");
          return { ok: true };
        }
        if (driverManual.pendingReceiptId) {
          await prisma.receipt.update({
            where: { id: driverManual.pendingReceiptId },
            data: { liters: new Prisma.Decimal(liters.toString()) },
          });
        }
        await prisma.driver.update({
          where: { id: driverManual.id },
          data: { pendingStep: STEP_MANUAL_TOTAL },
        });
        await sendMessage(chatId, "Введи сумму (руб), число.", {
          reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:MANUAL_FUEL" }]] },
        });
        return { ok: true };
      }

      if (driverManual?.pendingStep === STEP_MANUAL_TOTAL) {
        const total = Number(text.replace(",", "."));
        if (Number.isNaN(total) || total <= 0) {
          await sendMessage(chatId, "Сумма должна быть числом > 0. Введи ещё раз.");
          return { ok: true };
        }
        if (!driverManual.pendingReceiptId) {
          await sendMessage(chatId, "Чек не найден, начни заново: /fuel");
          return { ok: true };
        }
        const receipt = await prisma.receipt.findUnique({ where: { id: driverManual.pendingReceiptId } });
        if (!receipt) {
          await sendMessage(chatId, "Чек не найден, начни заново: /fuel");
          return { ok: true };
        }
        // finalize manual: update receipt to DONE, set totals, create fuel item
        await prisma.receipt.update({
          where: { id: receipt.id },
          data: {
            totalAmount: new Prisma.Decimal(total.toString()),
            pricePerLiter:
              receipt.liters && !receipt.liters.isZero()
                ? new Prisma.Decimal(total.toString()).div(receipt.liters)
                : null,
            status: ReceiptStatus.DONE,
            dataSource: "MANUAL",
            raw: { ...(receipt.raw as any), manual: true },
          },
        });
        await prisma.receiptItem.deleteMany({ where: { receiptId: receipt.id } });
        await prisma.receiptItem.create({
          data: {
            receiptId: receipt.id,
            name: receipt.fuelType || "Fuel",
            quantity: receipt.liters,
            unitPrice:
              receipt.liters && !receipt.liters.isZero()
                ? new Prisma.Decimal(total.toString()).div(receipt.liters)
                : null,
            amount: new Prisma.Decimal(total.toString()),
            isFuel: true,
          },
        });
        await prisma.driver.update({
          where: { id: driverManual.id },
          data: {
            pendingStep: null,
            pendingReceiptId: null,
            pendingMileage: null,
            pendingPaymentMethod: null,
          },
        });
        await sendMessage(chatId, "✅ Чек добавлен вручную.");
        return { ok: true };
      }

      // fallback manual entry (not full state machine)
      await sendMessage(chatId, "Команда не распознана. Напиши /fuel чтобы начать.");
      return { ok: true };
    }

    const doc = msg.document;
    const photo = msg.photo?.[msg.photo.length - 1];
    const fileId = doc?.file_id || photo?.file_id;
    const fileSize = doc?.file_size || photo?.file_size;

    if (!fileId) {
      await sendMessage(chatId, "Не нашёл файл. Пришли фото или документ чека.");
      return { ok: true };
    }

    if (fileSize && fileSize > MAX_FILE_SIZE) {
      await sendMessage(chatId, "Файл слишком большой (>10MB).");
      return { ok: true };
    }

    const driver = await ensureDriver(prisma, telegramId, msg.from?.first_name);
    const state = await prisma.driver.findUnique({ where: { id: driver.id } });

    if (!state?.pendingVehicleId) {
      await sendMessage(chatId, "Сначала выбери авто: напиши /fuel");
      return { ok: true };
    }

    if (!state.pendingPaymentMethod) {
      await sendMessage(chatId, "Сначала выбери оплату: напиши /fuel");
      return { ok: true };
    }

    await sendMessage(chatId, "Чек принят, сохраняю…");

    let filePath: string | undefined;
    try {
      const info = await getFile(fileId);
      filePath = info.result.file_path;
    } catch (e) {
      await sendMessage(chatId, "Не удалось получить файл от Telegram");
      return { ok: true };
    }

    let buffer: Buffer | null = null;
    if (filePath) {
      try {
        buffer = await downloadFile(filePath);
      } catch (e) {
        await sendMessage(chatId, "Не удалось скачать файл");
        return { ok: true };
      }
    }

    let storedPath: string | undefined;
    if (buffer) {
      const ext = path.extname(filePath || "") || ".jpg";
      storedPath = await saveFile(buffer, `${fileId}${ext}`);
    }

    const vehicle = await prisma.vehicle.findUnique({ where: { id: state.pendingVehicleId } });
    if (!vehicle) {
      await sendMessage(chatId, "Авто не найдено, начни сначала: /fuel");
      return { ok: true };
    }

    const mileage = state.pendingMileage ?? null;

    let receiptId: string | undefined = state.pendingReceiptId ?? undefined;

    if (receiptId) {
      // Перефоткать: обновляем существующий PENDING чек
      await prisma.receipt.update({
        where: { id: receiptId },
        data: {
          imagePath: storedPath ?? undefined,
          status: ReceiptStatus.PENDING,
          paymentMethod: state.pendingPaymentMethod ?? undefined,
          mileage,
          raw: {
            source: "telegram-file",
            fileId,
            filePath,
            fileSize,
            storedPath,
            note: "image stored, awaiting parsing",
            retry: true,
          },
        },
      });
    } else {
      const created = await createReceiptFromDto(prisma, {
        driver: { telegramUserId: driver.telegramUserId, fullName: driver.fullName },
        vehicle: { name: vehicle.name, plateNumber: vehicle.plateNumber },
        receipt: {
          stationName: "telegram",
          totalAmount: 0,
          liters: null,
          pricePerLiter: null,
          mileage,
          status: "PENDING",
          paymentMethod: state.pendingPaymentMethod ?? undefined,
          imagePath: storedPath,
          raw: {
            source: "telegram-file",
            fileId,
            filePath,
            fileSize,
            storedPath,
            note: "image stored, awaiting parsing",
          },
        },
        items: [
          {
            name: "Pending",
            quantity: null,
            unitPrice: null,
            amount: null,
          },
        ],
      });
      receiptId = created.receipt.id;
    }

    await prisma.driver.update({
      where: { id: driver.id },
      data: {
        pendingMileage: null,
        pendingReceiptFileId: fileId,
        pendingReceiptId: receiptId ?? null,
        pendingPaymentMethod: null,
        pendingStep: null,
      },
    });

    await sendMessage(chatId, "Чек сохранён, распознавание в очереди.");
    return { ok: true };
  });

  // Inline callbacks (vehicle selection / payment / back)
  app.post("/telegram/callback", async (req, reply) => {
    const update = req.body as any;
    const cb = update?.callback_query;
    if (!cb) return { ok: true };
    const data: string = cb.data || "";
    const chatId = cb.message?.chat?.id;
    const userId = cb.from?.id;
    const telegramId = (userId ?? chatId).toString();

    const driver = await ensureDriver(prisma, telegramId, cb.from?.first_name);

    if (data.startsWith("vehicle:")) {
      const vehicleId = data.replace("vehicle:", "");
      await prisma.driver.update({
        where: { id: driver.id },
        data: { pendingVehicleId: vehicleId, pendingStep: STEP_MILEAGE },
      });
        await sendMessage(chatId, "Введи пробег (числом).", {
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
      await sendMessage(chatId, "Отправь фото/документ чека или выбери действие.", { reply_markup: manualKeyboard() });
      return { ok: true };
    }

    if (data.startsWith("back:")) {
      const step = data.replace("back:", "");
      if (step === "VEHICLE") {
        const vehicles = await listActiveVehicles(prisma);
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_SELECT_VEHICLE, pendingVehicleId: null, pendingMileage: null, pendingPaymentMethod: null },
        });
        await sendMessage(chatId, "Выбери авто (госномер):", { reply_markup: vehicleKeyboard(vehicles) });
        return { ok: true };
      }
      if (step === "MILEAGE") {
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_MILEAGE, pendingPaymentMethod: null },
        });
        await sendMessage(chatId, "Введи пробег (числом).", {
          reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:VEHICLE" }]] },
        });
        return { ok: true };
      }
      if (step === "PHOTO") {
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_PAYMENT },
        });
        await sendMessage(chatId, "Выбери способ оплаты:", { reply_markup: paymentKeyboard() });
        return { ok: true };
      }
      if (step === "PAYMENT") {
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingPaymentMethod: null, pendingStep: STEP_PAYMENT },
        });
        await sendMessage(chatId, "Выбери способ оплаты:", { reply_markup: paymentKeyboard() });
        return { ok: true };
      }
      if (step === "FUEL") {
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_MANUAL_DATE },
        });
        await sendMessage(chatId, "Введи дату и время чека в формате YYYY-MM-DD HH:MM (МСК).", {
          reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:PAYMENT" }]] },
        });
        return { ok: true };
      }
      if (step === "MANUAL_FUEL") {
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_MANUAL_FUEL },
        });
        await sendMessage(chatId, "Выбери тип топлива:", { reply_markup: fuelKeyboard() });
        return { ok: true };
      }
      if (step === "MANUAL_LITERS") {
        await prisma.driver.update({
          where: { id: driver.id },
          data: { pendingStep: STEP_MANUAL_LITERS },
        });
        await sendMessage(chatId, "Введи литры (числом, можно с точкой).", {
          reply_markup: { inline_keyboard: [[{ text: "Назад", callback_data: "back:MANUAL_FUEL" }]] },
        });
        return { ok: true };
      }
    }

    return { ok: true };
  });
}
