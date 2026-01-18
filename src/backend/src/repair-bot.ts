import { Telegraf, Markup } from "telegraf";
import { PrismaClient, RepairCreatedFrom, RepairEventStatus, RepairEventType, PaymentStatus, RepairAttachmentSource, RepairAttachmentType } from "@prisma/client";
import fs from "fs";
import path from "path";
import { REPAIR_CATEGORIES, refreshVehicleOdometer } from "./repair-utils.js";
import { downloadRepairFile, getRepairFile, sendRepairMessage } from "./repair-telegram-client.js";

const token = process.env.REPAIR_BOT_TOKEN ?? "";
const REPAIR_FILES_DIR = process.env.REPAIR_FILES_DIR || "/app/data/repairs";

const STEP_SELECT_VEHICLE = "SELECT_VEHICLE";
const STEP_SELECT_TYPE = "SELECT_TYPE";
const STEP_ODOMETER = "ODOMETER";
const STEP_CATEGORY = "CATEGORY";
const STEP_SYMPTOMS = "SYMPTOMS";
const STEP_WORKS = "WORKS";
const STEP_PARTS = "PARTS";
const STEP_ATTACHMENTS = "ATTACHMENTS";
const STEP_PREVIEW = "PREVIEW";

function categoryKeyboard() {
  const rows = Object.entries(REPAIR_CATEGORIES).map(([code, label]) => [Markup.button.callback(label, `category:${code}`)]);
  return Markup.inlineKeyboard(rows);
}

function typeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("ТО", "type:MAINTENANCE"), Markup.button.callback("Ремонт", "type:REPAIR")],
  ]);
}

function previewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Отправить", "submit")],
    [Markup.button.callback("✏️ Исправить", "edit")],
    [Markup.button.callback("🗑 Удалить", "delete")],
  ]);
}

function editKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Авто", "edit:vehicle"), Markup.button.callback("Тип", "edit:type")],
    [Markup.button.callback("Пробег", "edit:odometer"), Markup.button.callback("Категория", "edit:category")],
    [Markup.button.callback("Симптомы", "edit:symptoms"), Markup.button.callback("Работы", "edit:works")],
    [Markup.button.callback("Запчасти", "edit:parts")],
  ]);
}

async function ensureDraft(prisma: PrismaClient, chatId: string) {
  const existing = await prisma.repairDraft.findFirst({
    where: { chatId },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return prisma.repairDraft.create({
    data: { chatId, step: STEP_SELECT_VEHICLE, payload: { works: [], parts: [], attachments: [] }, createdFrom: RepairCreatedFrom.TELEGRAM_BOT },
  });
}

async function updateDraft(prisma: PrismaClient, id: string, data: any) {
  return prisma.repairDraft.update({
    where: { id },
    data,
  });
}

async function storeAttachment(file: any) {
  await fs.promises.mkdir(REPAIR_FILES_DIR, { recursive: true });
  const info = await getRepairFile(file.file_id);
  const filePath = info.result.file_path;
  if (!filePath) throw new Error("file path not found");
  const buffer = await downloadRepairFile(filePath);
  const ext = path.extname(filePath);
  const storedName = `${Date.now()}-${file.file_id}${ext}`;
  const target = path.join(REPAIR_FILES_DIR, storedName);
  await fs.promises.writeFile(target, buffer);
  return { storedName, mimeType: file.mime_type || "application/octet-stream", size: buffer.length, fileName: file.file_name || storedName };
}

function buildPreview(payload: any) {
  return [
    `Авто: ${payload.vehiclePlate || "—"}`,
    `Тип: ${payload.eventType === "MAINTENANCE" ? "ТО" : "Ремонт"}`,
    `Пробег: ${payload.odometerKm || "—"}`,
    `Категория: ${REPAIR_CATEGORIES[payload.categoryCode] || payload.categoryCode || "—"}`,
    `Симптомы: ${payload.symptomsText || "—"}`,
    `Работы: ${payload.works?.length || 0}`,
    `Запчасти: ${payload.parts?.length || 0}`,
    `Документы: ${payload.attachments?.length || 0}`,
  ].join("\n");
}

export function startRepairBot(prisma: PrismaClient) {
  if (!token) return;
  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    await ctx.reply("Выберите действие:", Markup.keyboard([["➕ Новый ремонт/ТО"], ["📝 Черновики"]]).resize());
  });

  bot.hears("➕ Новый ремонт/ТО", async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    const vehicles = await prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" } });
    const rows = vehicles.map((v) => [Markup.button.callback(v.plateNumber, `vehicle:${v.id}`)]);
    await prisma.repairDraft.create({
      data: { chatId, step: STEP_SELECT_VEHICLE, payload: { works: [], parts: [], attachments: [] }, createdFrom: RepairCreatedFrom.TELEGRAM_BOT },
    });
    await ctx.reply("Выберите авто:", Markup.inlineKeyboard(rows));
  });

  bot.hears("📝 Черновики", async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    const drafts = await prisma.repairDraft.findMany({ where: { chatId }, orderBy: { updatedAt: "desc" }, take: 5 });
    if (!drafts.length) {
      await ctx.reply("Черновики не найдены.");
      return;
    }
    const message = drafts
      .map((draft) => `• ${draft.id} — шаг ${draft.step}`)
      .join("\n");
    await ctx.reply(`Черновики:\n${message}`);
  });

  bot.on("callback_query", async (ctx) => {
    const data = (ctx.callbackQuery as any)?.data;
    const chatId = ctx.chat?.id.toString();
    if (!data || !chatId) return;
    const draft = await ensureDraft(prisma, chatId);
    const payload = (draft.payload ?? {}) as any;

    if (data.startsWith("vehicle:")) {
      const vehicleId = data.replace("vehicle:", "");
      const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle) {
        await ctx.reply("Авто не найдено.");
        return;
      }
      payload.vehicleId = vehicleId;
      payload.vehiclePlate = vehicle.plateNumber;
      await updateDraft(prisma, draft.id, { step: STEP_SELECT_TYPE, payload });
      await ctx.reply("Выберите тип события:", typeKeyboard());
      return;
    }

    if (data.startsWith("type:")) {
      payload.eventType = data.replace("type:", "");
      await updateDraft(prisma, draft.id, { step: STEP_ODOMETER, payload });
      await ctx.reply("Введите пробег (числом).", Markup.removeKeyboard());
      return;
    }

    if (data.startsWith("category:")) {
      payload.categoryCode = data.replace("category:", "");
      await updateDraft(prisma, draft.id, { step: STEP_SYMPTOMS, payload });
      await ctx.reply("Опишите симптомы:");
      return;
    }

    if (data === "submit") {
      const created = await prisma.repairEvent.create({
        data: {
          vehicleId: payload.vehicleId,
          eventType: payload.eventType || RepairEventType.REPAIR,
          status: RepairEventStatus.IN_PROGRESS,
          startedAt: payload.startedAt ? new Date(payload.startedAt) : new Date(),
          odometerKm: payload.odometerKm ?? 0,
          categoryCode: payload.categoryCode || "OTHER",
          symptomsText: payload.symptomsText || "",
          paymentStatus: PaymentStatus.UNPAID,
          createdFrom: RepairCreatedFrom.TELEGRAM_BOT,
          works: { create: payload.works ?? [] },
          parts: { create: payload.parts ?? [] },
          attachments: {
            create: (payload.attachments ?? []).map((item: any) => ({
              fileType: item.fileType || RepairAttachmentType.OTHER,
              fileName: item.fileName,
              mimeType: item.mimeType,
              size: item.size,
              storageKey: item.storageKey,
              source: RepairAttachmentSource.TELEGRAM_BOT,
            })),
          },
        },
      });
      await prisma.repairDraft.delete({ where: { id: draft.id } });
      await refreshVehicleOdometer(prisma, created.vehicleId);
      await ctx.reply("✅ Ремонт отправлен.");
      return;
    }

    if (data === "edit") {
      await ctx.reply("Что изменить?", editKeyboard());
      return;
    }

    if (data === "delete") {
      await prisma.repairDraft.delete({ where: { id: draft.id } });
      await ctx.reply("Черновик удалён.");
      return;
    }

    if (data.startsWith("edit:")) {
      const step = data.replace("edit:", "");
      if (step === "vehicle") {
        const vehicles = await prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" } });
        const rows = vehicles.map((v) => [Markup.button.callback(v.plateNumber, `vehicle:${v.id}`)]);
        await updateDraft(prisma, draft.id, { step: STEP_SELECT_VEHICLE, payload });
        await ctx.reply("Выберите авто:", Markup.inlineKeyboard(rows));
        return;
      }
      if (step === "type") {
        await updateDraft(prisma, draft.id, { step: STEP_SELECT_TYPE, payload });
        await ctx.reply("Выберите тип события:", typeKeyboard());
        return;
      }
      if (step === "odometer") {
        await updateDraft(prisma, draft.id, { step: STEP_ODOMETER, payload });
        await ctx.reply("Введите пробег:");
        return;
      }
      if (step === "category") {
        await updateDraft(prisma, draft.id, { step: STEP_CATEGORY, payload });
        await ctx.reply("Выберите категорию:", categoryKeyboard());
        return;
      }
      if (step === "symptoms") {
        await updateDraft(prisma, draft.id, { step: STEP_SYMPTOMS, payload });
        await ctx.reply("Опишите симптомы:");
        return;
      }
      if (step === "works") {
        payload.works = [];
        await updateDraft(prisma, draft.id, { step: STEP_WORKS, payload });
        await ctx.reply("Добавляйте работы сообщениями. Нажмите «Готово».", Markup.keyboard([["Готово"]]).resize());
        return;
      }
      if (step === "parts") {
        payload.parts = [];
        await updateDraft(prisma, draft.id, { step: STEP_PARTS, payload });
        await ctx.reply("Введите запчасти в формате: Название; кол-во; цена. Нажмите «Готово».", Markup.keyboard([["Готово"]]).resize());
        return;
      }
    }
  });

  bot.on("message", async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    const draft = await ensureDraft(prisma, chatId);
    const payload = (draft.payload ?? {}) as any;
    const text = (ctx.message as any).text?.trim?.() ?? "";

    if (draft.step === STEP_ODOMETER) {
      const km = Number(text.replace(/\s+/g, ""));
      if (Number.isNaN(km)) {
        await ctx.reply("Пробег должен быть числом.");
        return;
      }
      payload.odometerKm = Math.round(km);
      await updateDraft(prisma, draft.id, { step: STEP_CATEGORY, payload });
      await ctx.reply("Выберите категорию:", categoryKeyboard());
      return;
    }

    if (draft.step === STEP_SYMPTOMS) {
      payload.symptomsText = text;
      await updateDraft(prisma, draft.id, { step: STEP_WORKS, payload });
      await ctx.reply("Добавляйте работы сообщениями. Нажмите «Готово».", Markup.keyboard([["Готово"]]).resize());
      return;
    }

    if (draft.step === STEP_WORKS) {
      if (text.toLowerCase() === "готово") {
        await updateDraft(prisma, draft.id, { step: STEP_PARTS, payload });
        await ctx.reply("Введите запчасти в формате: Название; кол-во; цена. Нажмите «Готово».", Markup.keyboard([["Готово"]]).resize());
        return;
      }
      payload.works = payload.works ?? [];
      payload.works.push({ workName: text, cost: "0" });
      await updateDraft(prisma, draft.id, { payload });
      await ctx.reply("Работа добавлена.");
      return;
    }

    if (draft.step === STEP_PARTS) {
      if (text.toLowerCase() === "готово") {
        await updateDraft(prisma, draft.id, { step: STEP_ATTACHMENTS, payload });
        await ctx.reply("Добавьте документы или нажмите «Пропустить».", Markup.keyboard([["Пропустить"]]).resize());
        return;
      }
      const [name, qtyRaw, priceRaw] = text.split(";").map((item: any) => item.trim());
      if (!name || !qtyRaw || !priceRaw) {
        await ctx.reply("Формат: Название; кол-во; цена");
        return;
      }
      const qty = Number(qtyRaw.replace(",", "."));
      const unitPrice = Number(priceRaw.replace(",", "."));
      if (Number.isNaN(qty) || Number.isNaN(unitPrice)) {
        await ctx.reply("Кол-во и цена должны быть числами.");
        return;
      }
      payload.parts = payload.parts ?? [];
      payload.parts.push({
        partName: name,
        qty: qty.toString(),
        unitPrice: unitPrice.toString(),
        totalPrice: (qty * unitPrice).toString(),
      });
      await updateDraft(prisma, draft.id, { payload });
      await ctx.reply("Запчасть добавлена.");
      return;
    }

    if (draft.step === STEP_ATTACHMENTS) {
      if (text.toLowerCase() === "пропустить") {
        await updateDraft(prisma, draft.id, { step: STEP_PREVIEW, payload });
        await ctx.reply(buildPreview(payload), previewKeyboard());
        return;
      }

      const doc = (ctx.message as any).document;
      const photo = (ctx.message as any).photo?.[(ctx.message as any).photo?.length - 1];
      const file = doc || photo;
      if (file) {
        const stored = await storeAttachment(file);
        payload.attachments = payload.attachments ?? [];
        payload.attachments.push({
          storageKey: stored.storedName,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          size: stored.size,
          fileType: doc ? RepairAttachmentType.ORDER : RepairAttachmentType.PHOTO,
        });
        await updateDraft(prisma, draft.id, { payload });
        await ctx.reply("Документ добавлен. Добавьте ещё или нажмите «Пропустить».", Markup.keyboard([["Пропустить"]]).resize());
        return;
      }
    }
  });

  bot.launch();

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
    sendRepairMessage(process.env.TELEGRAM_ADMIN_CHAT_ID, "🤖 Бот ремонта запущен.");
  }
}
