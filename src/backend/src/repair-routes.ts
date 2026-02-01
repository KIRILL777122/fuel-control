import { FastifyInstance } from "fastify";
import { Prisma, PrismaClient, RepairAttachmentSource, RepairAttachmentType, RepairCreatedFrom, RepairEventStatus, RepairEventType, PaymentStatus, RepairAiParseStatus, VehiclePartsGroup } from "@prisma/client";
import fs from "fs";
import path from "path";
import { REPAIR_CATEGORIES, refreshVehicleOdometer, getLastKnownOdometer } from "./repair-utils.js";

const REPAIR_FILES_DIR = process.env.REPAIR_FILES_DIR || "/app/data/repairs";

function toDecimal(value: any, fallback = "0") {
  if (value === null || value === undefined || value === "") return new Prisma.Decimal(fallback);
  const num = Number(value);
  if (Number.isNaN(num)) return new Prisma.Decimal(fallback);
  return new Prisma.Decimal(num.toString());
}

function toInt(value: any) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return Math.round(num);
}

function parseTags(input: any) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((item) => String(item));
  if (typeof input === "string") {
    return input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function calcTotals(works: any[], parts: any[], expenses: any[]) {
  const workTotal = works.reduce((sum, item) => sum.add(toDecimal(item.cost, "0")), new Prisma.Decimal(0));
  const partsTotal = parts.reduce((sum, item) => {
    const qty = Number(item.qty ?? 0);
    const price = Number(item.unitPrice ?? 0);
    const computed = Number.isNaN(qty * price) ? 0 : qty * price;
    return sum.add(toDecimal(item.totalPrice ?? computed, "0"));
  }, new Prisma.Decimal(0));
  const otherTotal = expenses.reduce((sum, item) => sum.add(toDecimal(item.cost, "0")), new Prisma.Decimal(0));
  return {
    totalCostWork: workTotal,
    totalCostParts: partsTotal,
    totalCostOther: otherTotal,
    totalCost: workTotal.add(partsTotal).add(otherTotal),
  };
}

async function saveAttachmentFile(file: any) {
  await fs.promises.mkdir(REPAIR_FILES_DIR, { recursive: true });
  const ext = path.extname(file.filename || "") || "";
  const storedName = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
  const target = path.join(REPAIR_FILES_DIR, storedName);
  await fs.promises.writeFile(target, await file.toBuffer());
  return { storedName, target };
}

async function buildSummary(prisma: PrismaClient, filters: any) {
  const where = filters.where;
  const [totals, byCategory] = await Promise.all([
    prisma.repairEvent.aggregate({
      where,
      _sum: { totalCost: true, totalCostWork: true, totalCostParts: true, totalCostOther: true },
      _count: { id: true },
    }),
    prisma.repairEvent.groupBy({
      by: ["categoryCode"],
      where,
      _sum: { totalCost: true },
      _count: { id: true },
    }),
  ]);

  const breakdown = byCategory.map((item) => ({
    categoryCode: item.categoryCode,
    total: item._sum.totalCost?.toString() ?? "0",
    count: item._count.id,
  }));

  const frequencyGroups = await prisma.repairEvent.groupBy({
    by: ["categoryCode", "subsystemCode"],
    where,
    _count: { id: true },
    _max: { startedAt: true },
  });

  const frequency = [] as any[];
  for (const group of frequencyGroups) {
    const events = await prisma.repairEvent.findMany({
      where: {
        ...where,
        categoryCode: group.categoryCode,
        subsystemCode: group.subsystemCode,
      },
      orderBy: { odometerKm: "asc" },
      select: { odometerKm: true },
    });
    let avgIntervalKm: number | null = null;
    if (events.length >= 2) {
      const diffs = [] as number[];
      for (let i = 1; i < events.length; i += 1) {
        diffs.push(events[i].odometerKm - events[i - 1].odometerKm);
      }
      avgIntervalKm = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    }
    frequency.push({
      categoryCode: group.categoryCode,
      subsystemCode: group.subsystemCode,
      count: group._count.id,
      lastOccurrence: group._max.startedAt,
      avgIntervalKm,
    });
  }

  return {
    totals: {
      totalCost: totals._sum.totalCost?.toString() ?? "0",
      totalCostWork: totals._sum.totalCostWork?.toString() ?? "0",
      totalCostParts: totals._sum.totalCostParts?.toString() ?? "0",
      totalCostOther: totals._sum.totalCostOther?.toString() ?? "0",
      count: totals._count.id,
    },
    breakdown,
    frequency,
  };
}

function buildRepairFilters(query: any) {
  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;
  if (to) {
    to.setHours(23, 59, 59, 999);
  }
  const vehicleId = query.vehicleId ? String(query.vehicleId) : null;
  const type = query.type ? String(query.type) : null;
  const status = query.status ? String(query.status) : null;
  const category = query.category ? String(query.category) : null;
  const hasDocs = String(query.hasDocs || "").toLowerCase() === "true";

  const and: any[] = [];
  if (from) and.push({ startedAt: { gte: from } });
  if (to) and.push({ startedAt: { lte: to } });
  if (vehicleId) and.push({ vehicleId });
  if (type) and.push({ eventType: type });
  if (status) and.push({ status });
  if (category) and.push({ categoryCode: category });
  if (hasDocs) and.push({ attachments: { some: {} } });

  return { where: and.length ? { AND: and } : {} };
}

export function registerRepairRoutes(app: FastifyInstance, prisma: PrismaClient, requireAuth: (req: any, reply: any) => Promise<boolean>) {
  app.get("/api/repairs", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const filters = buildRepairFilters(req.query);
    const items = await prisma.repairEvent.findMany({
      where: filters.where,
      orderBy: { startedAt: "desc" },
      include: {
        vehicle: { select: { id: true, plateNumber: true, name: true } },
        attachments: { select: { id: true } },
      },
    });
    return items.map((item) => ({
      ...item,
      totalCost: item.totalCost.toString(),
      totalCostWork: item.totalCostWork.toString(),
      totalCostParts: item.totalCostParts.toString(),
      totalCostOther: item.totalCostOther.toString(),
      attachmentsCount: item.attachments.length,
    }));
  });

  app.post("/api/repairs", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const body = (req.body ?? {}) as any;
    const works = Array.isArray(body.works) ? body.works : [];
    const parts = Array.isArray(body.parts) ? body.parts : [];
    const expenses = Array.isArray(body.expenses) ? body.expenses : [];
    const totals = calcTotals(works, parts, expenses);

    const created = await prisma.repairEvent.create({
      data: {
        vehicleId: body.vehicleId,
        eventType: body.eventType || RepairEventType.REPAIR,
        status: body.status || RepairEventStatus.DRAFT,
        startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
        finishedAt: body.finishedAt ? new Date(body.finishedAt) : null,
        odometerKm: toInt(body.odometerKm) ?? 0,
        categoryCode: body.categoryCode,
        subsystemCode: body.subsystemCode ?? null,
        symptomsText: body.symptomsText,
        findingsText: body.findingsText ?? null,
        serviceName: body.serviceName ?? null,
        paymentStatus: body.paymentStatus || PaymentStatus.UNPAID,
        totalCostWork: totals.totalCostWork,
        totalCostParts: totals.totalCostParts,
        totalCostOther: totals.totalCostOther,
        totalCost: totals.totalCost,
        tags: parseTags(body.tags),
        createdFrom: body.createdFrom || RepairCreatedFrom.WEB,
        rawInputText: body.rawInputText ?? null,
        aiParseStatus: body.aiParseStatus || RepairAiParseStatus.NONE,
        works: {
          create: works.map((item: any) => ({
            workName: item.workName,
            normHours: item.normHours ? toDecimal(item.normHours, "0") : null,
            cost: toDecimal(item.cost, "0"),
            comment: item.comment ?? null,
          })),
        },
        parts: {
          create: parts.map((item: any) => ({
            partName: item.partName,
            brand: item.brand ?? null,
            partNumber: item.partNumber ?? null,
            qty: toDecimal(item.qty ?? 1, "1"),
            unitPrice: toDecimal(item.unitPrice ?? 0, "0"),
            totalPrice: toDecimal(
              item.totalPrice ?? Number(item.qty ?? 0) * Number(item.unitPrice ?? 0),
              "0"
            ),
            supplier: item.supplier ?? null,
            warrantyUntilDate: item.warrantyUntilDate ? new Date(item.warrantyUntilDate) : null,
            warrantyUntilOdometerKm: toInt(item.warrantyUntilOdometerKm),
            comment: item.comment ?? null,
          })),
        },
        expenses: {
          create: expenses.map((item: any) => ({
            name: item.name,
            cost: toDecimal(item.cost, "0"),
            comment: item.comment ?? null,
          })),
        },
      },
      include: { vehicle: true },
    });

    if (created.vehicleId) {
      await refreshVehicleOdometer(prisma, created.vehicleId);
    }

    return reply.code(201).send(created);
  });

  app.get("/api/repairs/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const item = await prisma.repairEvent.findUnique({
      where: { id },
      include: {
        vehicle: true,
        works: true,
        parts: true,
        expenses: true,
        attachments: true,
      },
    });
    if (!item) return reply.code(404).send({ error: "not found" });
    return {
      ...item,
      totalCost: item.totalCost.toString(),
      totalCostWork: item.totalCostWork.toString(),
      totalCostParts: item.totalCostParts.toString(),
      totalCostOther: item.totalCostOther.toString(),
    };
  });

  app.patch("/api/repairs/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const body = (req.body ?? {}) as any;
    const works = Array.isArray(body.works) ? body.works : null;
    const parts = Array.isArray(body.parts) ? body.parts : null;
    const expenses = Array.isArray(body.expenses) ? body.expenses : null;
    const totals = calcTotals(works ?? [], parts ?? [], expenses ?? []);

    const data: any = {
      vehicleId: body.vehicleId,
      eventType: body.eventType,
      status: body.status,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      finishedAt: body.finishedAt ? new Date(body.finishedAt) : null,
      odometerKm: toInt(body.odometerKm) ?? undefined,
      categoryCode: body.categoryCode,
      subsystemCode: body.subsystemCode ?? null,
      symptomsText: body.symptomsText,
      findingsText: body.findingsText ?? null,
      serviceName: body.serviceName ?? null,
      paymentStatus: body.paymentStatus,
      totalCostWork: totals.totalCostWork,
      totalCostParts: totals.totalCostParts,
      totalCostOther: totals.totalCostOther,
      totalCost: totals.totalCost,
      tags: body.tags ? parseTags(body.tags) : undefined,
      rawInputText: body.rawInputText ?? undefined,
      aiParseStatus: body.aiParseStatus ?? undefined,
    };

    const updated = await prisma.repairEvent.update({
      where: { id },
      data,
    });

    if (works) {
      await prisma.repairWork.deleteMany({ where: { repairEventId: id } });
      if (works.length) {
        await prisma.repairWork.createMany({
          data: works.map((item: any) => ({
            repairEventId: id,
            workName: item.workName,
            normHours: item.normHours ? toDecimal(item.normHours, "0") : null,
            cost: toDecimal(item.cost, "0"),
            comment: item.comment ?? null,
          })),
        });
      }
    }
    if (parts) {
      await prisma.repairPart.deleteMany({ where: { repairEventId: id } });
      if (parts.length) {
        await prisma.repairPart.createMany({
          data: parts.map((item: any) => ({
            repairEventId: id,
            partName: item.partName,
            brand: item.brand ?? null,
            partNumber: item.partNumber ?? null,
            qty: toDecimal(item.qty ?? 1, "1"),
            unitPrice: toDecimal(item.unitPrice ?? 0, "0"),
            totalPrice: toDecimal(
              item.totalPrice ?? Number(item.qty ?? 0) * Number(item.unitPrice ?? 0),
              "0"
            ),
            supplier: item.supplier ?? null,
            warrantyUntilDate: item.warrantyUntilDate ? new Date(item.warrantyUntilDate) : null,
            warrantyUntilOdometerKm: toInt(item.warrantyUntilOdometerKm),
            comment: item.comment ?? null,
          })),
        });
      }
    }
    if (expenses) {
      await prisma.repairExpense.deleteMany({ where: { repairEventId: id } });
      if (expenses.length) {
        await prisma.repairExpense.createMany({
          data: expenses.map((item: any) => ({
            repairEventId: id,
            name: item.name,
            cost: toDecimal(item.cost, "0"),
            comment: item.comment ?? null,
          })),
        });
      }
    }

    if (updated.vehicleId) {
      await refreshVehicleOdometer(prisma, updated.vehicleId);
    }

    return updated;
  });

  app.delete("/api/repairs/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    await prisma.repairEvent.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post("/api/repairs/:id/attachments", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });

    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: "file required" });
    const fileType = (file.fields?.fileType?.value as string | undefined) || RepairAttachmentType.OTHER;
    const stored = await saveAttachmentFile(file);
    const attachment = await prisma.repairAttachment.create({
      data: {
        repairEventId: id,
        fileType: fileType as RepairAttachmentType,
        fileName: file.filename,
        mimeType: file.mimetype,
        size: file.file?.bytesRead ?? 0,
        storageKey: stored.storedName,
        source: RepairAttachmentSource.WEB,
      },
    });
    return reply.code(201).send(attachment);
  });

  app.get("/api/attachments/:id/file", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const attachment = await prisma.repairAttachment.findUnique({ where: { id } });
    if (!attachment) return reply.code(404).send({ error: "not found" });
    const filePath = path.join(REPAIR_FILES_DIR, attachment.storageKey);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "file not found" });
    reply.type(attachment.mimeType);
    return reply.send(fs.createReadStream(filePath));
  });

  app.delete("/api/attachments/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const attachment = await prisma.repairAttachment.findUnique({ where: { id } });
    if (!attachment) return reply.code(404).send({ error: "not found" });
    const filePath = path.join(REPAIR_FILES_DIR, attachment.storageKey);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
    await prisma.repairAttachment.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.get("/api/repairs/summary", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const filters = buildRepairFilters(req.query);
    return buildSummary(prisma, filters);
  });

  app.get("/api/maintenance", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const vehicleId = (req.query as any)?.vehicleId as string | undefined;
    const where: any = {};
    if (vehicleId) where.vehicleId = vehicleId;
    return prisma.maintenanceItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { vehicle: true },
    });
  });

  app.post("/api/maintenance", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const body = (req.body ?? {}) as any;
    const created = await prisma.maintenanceItem.create({
      data: {
        vehicleId: body.vehicleId,
        name: body.name,
        intervalKm: toInt(body.intervalKm),
        intervalDays: toInt(body.intervalDays),
        lastDoneAt: body.lastDoneAt ? new Date(body.lastDoneAt) : null,
        lastDoneOdometerKm: toInt(body.lastDoneOdometerKm),
        notifyBeforeKm: toInt(body.notifyBeforeKm) ?? 500,
        notifyBeforeDays: toInt(body.notifyBeforeDays) ?? 7,
        isActive: body.isActive ?? true,
      },
    });
    return reply.code(201).send(created);
  });

  app.patch("/api/maintenance/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const body = (req.body ?? {}) as any;
    const updated = await prisma.maintenanceItem.update({
      where: { id },
      data: {
        name: body.name,
        intervalKm: toInt(body.intervalKm),
        intervalDays: toInt(body.intervalDays),
        lastDoneAt: body.lastDoneAt ? new Date(body.lastDoneAt) : null,
        lastDoneOdometerKm: toInt(body.lastDoneOdometerKm),
        notifyBeforeKm: toInt(body.notifyBeforeKm) ?? 500,
        notifyBeforeDays: toInt(body.notifyBeforeDays) ?? 7,
        isActive: body.isActive,
      },
    });
    return updated;
  });

  app.post("/api/maintenance/:id/mark-done", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const body = (req.body ?? {}) as any;
    const item = await prisma.maintenanceItem.update({
      where: { id },
      data: {
        lastDoneAt: body.date ? new Date(body.date) : new Date(),
        lastDoneOdometerKm: toInt(body.odometerKm),
      },
    });
    if (body.createRepairEvent) {
      await prisma.repairEvent.create({
        data: {
          vehicleId: item.vehicleId,
          eventType: RepairEventType.MAINTENANCE,
          status: RepairEventStatus.DONE,
          startedAt: body.date ? new Date(body.date) : new Date(),
          odometerKm: toInt(body.odometerKm) ?? 0,
          categoryCode: body.categoryCode || "OTHER",
          symptomsText: item.name,
          paymentStatus: PaymentStatus.UNPAID,
          totalCostWork: new Prisma.Decimal("0"),
          totalCostParts: new Prisma.Decimal("0"),
          totalCostOther: new Prisma.Decimal("0"),
          totalCost: new Prisma.Decimal("0"),
        },
      });
      await refreshVehicleOdometer(prisma, item.vehicleId);
    }
    return item;
  });

  app.get("/api/vehicle-parts-spec", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const vehicleId = (req.query as any)?.vehicleId as string | undefined;
    const where: any = {};
    if (vehicleId) where.vehicleId = vehicleId;
    return prisma.vehiclePartsSpec.findMany({ where, orderBy: { createdAt: "desc" } });
  });

  app.post("/api/vehicle-parts-spec", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const body = (req.body ?? {}) as any;
    const created = await prisma.vehiclePartsSpec.create({
      data: {
        vehicleId: body.vehicleId,
        groupCode: body.groupCode as VehiclePartsGroup,
        recommendedText: body.recommendedText,
        preferredBrands: body.preferredBrands ?? [],
        avoidBrands: body.avoidBrands ?? [],
        notes: body.notes ?? null,
      },
    });
    return reply.code(201).send(created);
  });

  app.patch("/api/vehicle-parts-spec/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const body = (req.body ?? {}) as any;
    const updated = await prisma.vehiclePartsSpec.update({
      where: { id },
      data: {
        groupCode: body.groupCode as VehiclePartsGroup,
        recommendedText: body.recommendedText,
        preferredBrands: body.preferredBrands ?? [],
        avoidBrands: body.avoidBrands ?? [],
        notes: body.notes ?? null,
      },
    });
    return updated;
  });

  app.delete("/api/vehicle-parts-spec/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    await prisma.vehiclePartsSpec.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.get("/api/accidents", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const vehicleId = (req.query as any)?.vehicleId as string | undefined;
    const where: any = {};
    if (vehicleId) where.vehicleId = vehicleId;
    return prisma.accidentEvent.findMany({ where, orderBy: { occurredAt: "desc" } });
  });

  app.post("/api/accidents", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const body = (req.body ?? {}) as any;
    const created = await prisma.accidentEvent.create({
      data: {
        vehicleId: body.vehicleId,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        odometerKm: toInt(body.odometerKm),
        description: body.description,
        damage: body.damage ?? null,
        repaired: body.repaired ?? false,
        repairEventId: body.repairEventId ?? null,
      },
    });
    return reply.code(201).send(created);
  });

  app.patch("/api/accidents/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const body = (req.body ?? {}) as any;
    const updated = await prisma.accidentEvent.update({
      where: { id },
      data: {
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
        odometerKm: toInt(body.odometerKm),
        description: body.description,
        damage: body.damage ?? null,
        repaired: body.repaired ?? false,
        repairEventId: body.repairEventId ?? null,
      },
    });
    return updated;
  });

  app.delete("/api/accidents/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    await prisma.accidentEvent.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post("/api/repairs/drafts", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const body = (req.body ?? {}) as any;
    const created = await prisma.repairDraft.create({
      data: {
        chatId: body.chatId,
        step: body.step ?? "START",
        payload: body.payload ?? {},
        createdFrom: RepairCreatedFrom.TELEGRAM_BOT,
      },
    });
    return reply.code(201).send(created);
  });

  app.patch("/api/repairs/drafts/:id", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const body = (req.body ?? {}) as any;
    const updated = await prisma.repairDraft.update({
      where: { id },
      data: {
        step: body.step,
        payload: body.payload,
      },
    });
    return updated;
  });

  app.post("/api/repairs/drafts/:id/submit", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const draft = await prisma.repairDraft.findUnique({ where: { id } });
    if (!draft) return reply.code(404).send({ error: "not found" });
    const payload = (draft.payload ?? {}) as any;
    const works = Array.isArray(payload.works) ? payload.works : [];
    const parts = Array.isArray(payload.parts) ? payload.parts : [];
    const expenses = Array.isArray(payload.expenses) ? payload.expenses : [];
    const totals = calcTotals(works, parts, expenses);
    const created = await prisma.repairEvent.create({
      data: {
        vehicleId: payload.vehicleId,
        eventType: payload.eventType || RepairEventType.REPAIR,
        status: RepairEventStatus.IN_PROGRESS,
        startedAt: payload.startedAt ? new Date(payload.startedAt) : new Date(),
        odometerKm: toInt(payload.odometerKm) ?? 0,
        categoryCode: payload.categoryCode || "OTHER",
        subsystemCode: payload.subsystemCode ?? null,
        symptomsText: payload.symptomsText ?? "",
        findingsText: payload.findingsText ?? null,
        serviceName: payload.serviceName ?? null,
        paymentStatus: payload.paymentStatus || PaymentStatus.UNPAID,
        totalCostWork: totals.totalCostWork,
        totalCostParts: totals.totalCostParts,
        totalCostOther: totals.totalCostOther,
        totalCost: totals.totalCost,
        tags: parseTags(payload.tags),
        createdFrom: RepairCreatedFrom.TELEGRAM_BOT,
        rawInputText: payload.rawInputText ?? null,
        aiParseStatus: RepairAiParseStatus.NONE,
        works: { create: works },
        parts: { create: parts },
        expenses: { create: expenses },
      },
    });
    await prisma.repairDraft.delete({ where: { id } });
    await refreshVehicleOdometer(prisma, created.vehicleId);
    return created;
  });

  app.get("/api/repairs/drafts", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const status = (req.query as any)?.status as string | undefined;
    const createdFrom = (req.query as any)?.created_from as string | undefined;
    const where: any = {};
    if (status) where.step = status;
    if (createdFrom) where.createdFrom = createdFrom;
    return prisma.repairDraft.findMany({ where, orderBy: { updatedAt: "desc" } });
  });

  app.get("/api/repair-categories", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    return Object.entries(REPAIR_CATEGORIES).map(([code, label]) => ({ code, label }));
  });

  app.get("/api/vehicles/:id/odometer", async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const id = (req.params as any)?.id as string | undefined;
    if (!id) return reply.code(400).send({ error: "id required" });
    const lastKnown = await getLastKnownOdometer(prisma, id);
    return { lastKnown };
  });
}
