import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import fs from "fs";
import path from "path";
import Excel from "exceljs";
import nodemailer from "nodemailer";
import { PrismaClient, Prisma, ReceiptStatus, PaymentMethod, FuelType, DataSource } from "@prisma/client";
import { createReceiptFromDto, CreateReceiptDto } from "./receipt-service.js";
import { registerTelegramRoutes } from "./telegram-router.js";
import { startPendingWorker } from "./pending-worker.js";
import { errorLogger } from "./logger.js";
import { registerRepairRoutes } from "./repair-routes.js";
import { startRepairBot } from "./repair-bot.js";
import { startMaintenanceCron } from "./maintenance-cron.js";

const app = Fastify({ logger: true });
const prisma = new PrismaClient();

const allowedOrigin = process.env.WEB_ORIGIN || process.env.CORS_ORIGIN || undefined;
const allowCredentials = true;
app.register(cors, {
  origin: allowedOrigin ? [allowedOrigin] : true,
  credentials: allowCredentials,
});

const jwtSecret = process.env.JWT_SECRET;
app.register(jwt, {
  secret: jwtSecret || "dev-secret-change-me-32chars",
});
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
const secureCookie = (process.env.APP_ENV || process.env.NODE_ENV || "").toLowerCase() === "production";

app.register(cookie, {
  secret: jwtSecret || "dev-secret-change-me-32chars",
});

const ADMIN_LOGIN = process.env.WEB_ADMIN_LOGIN;
const ADMIN_PASSWORD = process.env.WEB_ADMIN_PASSWORD;
const sessionSecret = process.env.WEB_SESSION_SECRET || jwtSecret;

app.log.info({
  WEB_ADMIN_LOGIN: ADMIN_LOGIN ? "SET" : "NOT SET",
  WEB_ADMIN_PASSWORD: ADMIN_PASSWORD ? "SET" : "NOT SET",
}, "auth info");

function cookieOpts() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookie,
    domain: cookieDomain || undefined,
  };
}

function handlePrismaError(err: any, reply: any) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = Array.isArray(err.meta?.target) ? err.meta?.target.join(",") : err.meta?.target;
      return reply.code(400).send({
        error: "unique_constraint",
        message: target === "plateNumber" ? "Госномер уже существует" : "ID уже существует",
      });
    }
  }
  return reply.code(500).send({ error: err?.message ?? "unexpected error" });
}

async function requireAuth(req: any, reply: any) {
  try {
    const remoteAddress = req.ip || req.socket?.remoteAddress || "";
    const isInternal = 
      remoteAddress === "127.0.0.1" || 
      remoteAddress === "::1" || 
      remoteAddress === "::ffff:127.0.0.1" || 
      remoteAddress.startsWith("172.") || 
      remoteAddress.startsWith("192.168.");

    if (isInternal) return true;

    const auth = req.headers["authorization"] as string | undefined;
    let token: string | undefined;
    if (auth?.toLowerCase().startsWith("bearer ")) {
      token = auth.slice(7);
    } else if (req.cookies?.fuel_token) {
      token = req.cookies.fuel_token;
    }
    if (token) {
      req.user = app.jwt.verify(token);
      return true;
    }
    
    try {
      const verified = await req.jwtVerify();
      req.user = verified;
      return true;
    } catch (jwtErr) {
      reply.code(401).send({ error: "unauthorized" });
      return false;
    }
  } catch (err) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
}

function toDecimal(v: any): Prisma.Decimal | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return new Prisma.Decimal(n.toString());
}

function formatRuDate(value?: string | null) {
  if (!value) return "";
  const match = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function buildSmtpConfig() {
  const host = process.env.SMTP_HOST || "smtp.yandex.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER || process.env.YA_IMAP_USER;
  const pass = process.env.SMTP_PASS || process.env.YA_IMAP_PASS;
  const from = process.env.SMTP_FROM || user;
  const secure = String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false";
  return { host, port, user, pass, from, secure };
}

function toCsv(rows: Record<string, any>[]) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const header = cols.join(";");
  const body = rows
    .map((r) =>
      cols
        .map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return "";
          const s = typeof v === "object" ? JSON.stringify(v) : String(v);
          return '"' + s.replace(/"/g, '""') + '"';
        })
        .join(";")
    )
    .join("\n");
  return header + "\n" + body;
}

function buildCompensationFilters(q: any) {
  const pendingOnly = ((q.pending ?? "true").toString().toLowerCase()) !== "false";
  const includePaid = ((q.includePaid ?? "false").toString().toLowerCase()) === "true";
  const dateFrom = q.dateFrom ? new Date(q.dateFrom as string) : null;
  const dateTo = q.dateTo ? new Date(`${q.dateTo as string}T23:59:59.999Z`) : null;
  const driver = (q.driver as string | undefined) ?? "";
  const vehicle = (q.vehicle as string | undefined) ?? "";

  const and: any[] = [];
  if (!includePaid) and.push({ paidByDriver: true });
  if (pendingOnly) and.push({ reimbursed: false });
  if (dateFrom) and.push({ receiptAt: { gte: dateFrom } });
  if (dateTo) and.push({ receiptAt: { lte: dateTo } });
  if (driver) {
    and.push({
      driver: {
        OR: [
          { fullName: { contains: driver, mode: "insensitive" } },
          { telegramUserId: { contains: driver, mode: "insensitive" } },
        ],
      },
    });
  }
  if (vehicle) {
    and.push({
      vehicle: {
        OR: [
          { plateNumber: { contains: vehicle, mode: "insensitive" } },
          { name: { contains: vehicle, mode: "insensitive" } },
        ],
      },
    });
  }

  const where = and.length ? { AND: and } : {};
  return { where, pendingOnly, includePaid, dateFrom, dateTo, driver, vehicle };
}

app.get("/", async () => ({ ok: true, service: "fuel-control" }));
app.get("/health", async () => ({ ok: true }));

app.post("/api/auth/login", async (req, reply) => {
  const body = (req.body ?? {}) as any;
  const login = (body.login ?? "").toString();
  const password = (body.password ?? "").toString();

  if (!ADMIN_LOGIN || !ADMIN_PASSWORD || login !== ADMIN_LOGIN || password !== ADMIN_PASSWORD) {
    return reply.code(401).send({ error: "invalid credentials" });
  }

  const token = app.jwt.sign({ login, role: "admin" }, { expiresIn: "7d" });
  reply.setCookie("fuel_token", token, cookieOpts());
  return reply.code(200).send({ token });
});

app.post("/api/auth/logout", async (req, reply) => {
  reply.clearCookie("fuel_token", cookieOpts());
  return reply.code(200).send({ ok: true });
});

app.get("/api/auth/me", async (req, reply) => {
  try {
    const ok = await requireAuth(req, reply);
    if (!ok || !req.user) return;
    return reply.code(200).send({ login: (req.user as any)?.login ?? "admin", role: "admin" });
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

// FILES
app.get("/api/receipts/:id/file", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  const type = (req.query as any)?.type ?? "image";
  const receipt = await prisma.receipt.findUnique({ where: { id } });
  if (!receipt) return reply.code(404).send({ error: "receipt not found" });
  const targetPath = type === "pdf" ? receipt.pdfPath : receipt.imagePath;
  if (!targetPath) return reply.code(404).send({ error: "file path not found" });
  let abs = targetPath;
  if (!path.isAbsolute(abs)) abs = path.join("/app", targetPath);
  if (!fs.existsSync(abs)) {
    const alt = path.join("/app/data/telegram", path.basename(targetPath));
    if (fs.existsSync(alt)) abs = alt;
    else return reply.code(404).send({ error: "file not found on disk" });
  }
  const stream = fs.createReadStream(abs);
  const ext = path.extname(abs).toLowerCase();
  const contentType = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : "image/jpeg";
  reply.type(contentType);
  return reply.send(stream);
});

// DRIVERS
app.get("/api/drivers", async () => prisma.driver.findMany({ orderBy: { createdAt: "desc" } }));
app.post("/api/drivers", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const body = (req.body ?? {}) as any;
  let { id, telegramUserId, fullName, isActive, isPinned } = body; 
  if (telegramUserId) telegramUserId = String(telegramUserId);
  if (!telegramUserId) return reply.code(400).send({ error: "telegramUserId required" });
  try {
    if (id) {
      const d = await prisma.driver.update({ 
        where: { id }, 
        data: { 
          telegramUserId, 
          fullName: fullName ?? telegramUserId, 
          isActive: isActive ?? true,
          isPinned: typeof isPinned === 'boolean' ? isPinned : undefined
        } 
      });
      return reply.send(d);
    }
    const existing = await prisma.driver.findUnique({ where: { telegramUserId } });
    if (existing) {
      // If driver already exists (active or inactive), just update the info and ensure it is active
      const d = await prisma.driver.update({ 
        where: { id: existing.id }, 
        data: { 
          fullName: fullName || existing.fullName, // Keep existing name if new one not provided
          isActive: true, // Reactivate if it was inactive
          isPinned: typeof isPinned === 'boolean' ? isPinned : existing.isPinned
        } 
      });
      return reply.send(d);
    }
    const d = await prisma.driver.create({ 
      data: { 
        telegramUserId, 
        fullName: fullName ?? telegramUserId, 
        isActive: isActive ?? true,
        isPinned: isPinned ?? false
      } 
    });
    return reply.code(201).send(d);
  } catch (e) { return handlePrismaError(e, reply); }
});
app.delete("/api/drivers/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  try {
    await prisma.driver.delete({ where: { id } });
    return { ok: true };
  } catch (err: any) {
    return handlePrismaError(err, reply);
  }
});
app.post("/api/drivers/:id/deactivate", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  try {
    const d = await prisma.driver.update({ where: { id }, data: { isActive: false } });
    return reply.send(d);
  } catch (e) { return handlePrismaError(e, reply); }
});

// VEHICLES
app.get("/api/vehicles", async () => prisma.vehicle.findMany({ orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }] }));
app.get("/api/vehicles/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  const v = await prisma.vehicle.findUnique({ where: { id } });
  if (!v) return reply.code(404).send({ error: "not found" });
  return v;
});
app.patch("/api/vehicles/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  const body = (req.body ?? {}) as any;
  try {
    const v = await prisma.vehicle.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        plateNumber: body.plateNumber?.toUpperCase() ?? undefined,
        makeModel: body.makeModel ?? undefined,
        year: body.year ? Number(body.year) : undefined,
        vin: body.vin ?? undefined,
        engine: body.engine ?? undefined,
        color: body.color ?? undefined,
        purchasedAt: body.purchasedAt ? new Date(body.purchasedAt) : undefined,
        purchasedOdometerKm: body.purchasedOdometerKm ? Number(body.purchasedOdometerKm) : undefined,
        currentOdometerKm: body.currentOdometerKm ? Number(body.currentOdometerKm) : undefined,
        notes: body.notes ?? undefined,
        sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
        isActive: body.isActive ?? undefined,
        isTelegramEnabled: typeof body.isTelegramEnabled === "boolean" ? body.isTelegramEnabled : undefined,
      }
    });
    return v;
  } catch (e) { return handlePrismaError(e, reply); }
});
app.delete("/api/vehicles/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  await prisma.vehicle.delete({ where: { id } });
  return reply.code(204).send();
});
app.post("/api/vehicles/:id/deactivate", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  try {
    const v = await prisma.vehicle.update({ where: { id }, data: { isActive: false } });
    return reply.send(v);
  } catch (e) { return handlePrismaError(e, reply); }
});
app.post("/api/vehicles", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const body = (req.body ?? {}) as any;
  const { id, plateNumber, name, sortOrder, isActive, isPinned, isTelegramEnabled } = body;
  if (!plateNumber) return reply.code(400).send({ error: "plateNumber required" });
  try {
    const payload = {
      name: name ?? plateNumber,
      plateNumber: plateNumber.toUpperCase(),
      makeModel: body.makeModel ?? null,
      year: body.year ? Number(body.year) : null,
      vin: body.vin ?? null,
      engine: body.engine ?? null,
      color: body.color ?? null,
      purchasedAt: body.purchasedAt ? new Date(body.purchasedAt) : null,
      purchasedOdometerKm: body.purchasedOdometerKm ? Number(body.purchasedOdometerKm) : null,
      currentOdometerKm: body.currentOdometerKm ? Number(body.currentOdometerKm) : null,
      notes: body.notes ?? null,
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
      isPinned: typeof isPinned === 'boolean' ? isPinned : undefined,
      isTelegramEnabled: typeof isTelegramEnabled === "boolean" ? isTelegramEnabled : undefined,
    };
    if (id) {
      const v = await prisma.vehicle.update({ where: { id }, data: payload });
      return reply.send(v);
    }
    const existing = await prisma.vehicle.findUnique({ where: { plateNumber: plateNumber.toUpperCase() } });
    if (existing) {
      if (existing.isActive) return reply.code(400).send({ error: "exists" });
      const v = await prisma.vehicle.update({ where: { id: existing.id }, data: { ...payload, isActive: true } });
      return reply.send(v);
    }
    const v = await prisma.vehicle.create({ data: payload });
    return reply.code(201).send(v);
  } catch (e) { return handlePrismaError(e, reply); }
});

// RECEIPTS
function computeDerived(receipts: any[]) {
  const sorted = [...receipts].sort((a, b) => new Date(a.receiptAt).getTime() - new Date(b.receiptAt).getTime());
  const lastKm = new Map<string, number>();
  const results = new Map<string, any>();
  for (const r of sorted) {
    const prev = r.vehicleId ? lastKm.get(r.vehicleId) : undefined;
    let dKm = null, lp100 = null;
    if (r.mileage && prev) {
      dKm = r.mileage - prev;
      if (dKm > 0 && r.liters) lp100 = (Number(r.liters) / dKm) * 100;
    }
    results.set(r.id, { dKm, lp100 });
    if (r.vehicleId && r.mileage) lastKm.set(r.vehicleId, r.mileage);
  }
  return results;
}
app.get("/api/receipts", async (req) => {
  const q = (req.query ?? {}) as any;
  const limit = Math.max(1, Math.min(500, Number(q.limit ?? 50) || 50));
  const receipts = await prisma.receipt.findMany({
    take: limit, orderBy: { receiptAt: "desc" },
    include: {
      driver: { select: { id: true, fullName: true, telegramUserId: true } },
      vehicle: { select: { id: true, name: true, plateNumber: true } },
    },
  });
  const res = computeDerived(receipts);
  return receipts.map(r => ({ ...r, derivedDeltaKm: res.get(r.id)?.dKm ?? null, derivedLPer100: res.get(r.id)?.lp100 ?? null }));
});
app.patch("/api/receipts/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  const body = (req.body ?? {}) as any;
  const data: any = {};
  if (body.status) data.status = body.status;
  if (typeof body.paymentMethod === "string") data.paymentMethod = body.paymentMethod;
  if (body.paymentMethod === null) data.paymentMethod = null;
  if (typeof body.fuelType === "string") data.fuelType = body.fuelType;
  if (body.fuelType === null) data.fuelType = null;
  if (typeof body.dataSource === "string") data.dataSource = body.dataSource;
  if (body.dataSource === null) data.dataSource = null;
  if (body.mileage !== undefined) data.mileage = Number.isNaN(Number(body.mileage)) ? null : Number(body.mileage);
  if (body.totalAmount !== undefined) data.totalAmount = toDecimal(body.totalAmount);
  if (body.liters !== undefined) data.liters = toDecimal(body.liters);
  if (typeof body.paidByDriver === "boolean") data.paidByDriver = body.paidByDriver;
  if (typeof body.reimbursed === "boolean") data.reimbursed = body.reimbursed;
  if (typeof body.paymentComment === "string") data.paymentComment = body.paymentComment;
  if (body.paymentComment === null) data.paymentComment = null;
  
  // Added fields for update
  if (body.pricePerLiter !== undefined) data.pricePerLiter = toDecimal(body.pricePerLiter);
  if (typeof body.stationName === "string") data.stationName = body.stationName;
  if (body.stationName === null) data.stationName = null;
  if (typeof body.addressShort === "string") data.addressShort = body.addressShort;
  if (body.addressShort === null) data.addressShort = null;
  if (body.receiptAt) data.receiptAt = new Date(body.receiptAt);
  if (body.receiptAt === null) data.receiptAt = null;
  if (typeof body.driverId === "string") data.driverId = body.driverId;
  if (typeof body.vehicleId === "string") data.vehicleId = body.vehicleId;

  try {
    const updated = await prisma.receipt.update({
      where: { id },
      data,
      include: {
        driver: { select: { id: true, fullName: true, telegramUserId: true } },
        vehicle: { select: { id: true, name: true, plateNumber: true } },
      }
    });
    return updated;
  }
  catch (e) { return reply.code(400).send({ error: "update failed" }); }
});
app.delete("/api/receipts/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  await prisma.receipt.delete({ where: { id } });
  return reply.code(204).send();
});
app.delete("/api/receipts", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const ids = Array.isArray((req.body as any)?.ids) ? (req.body as any).ids : [];
  if (!ids.length) return reply.code(400).send({ error: "ids required" });
  await prisma.receipt.deleteMany({ where: { id: { in: ids } } });
  return { ok: true };
});

app.post("/api/receipts/:id/recognize", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  if (!id) return reply.code(400).send({ error: "id required" });
  const receipt = await prisma.receipt.findUnique({ where: { id } });
  if (!receipt) return reply.code(404).send({ error: "not found" });
  if (!receipt.qrRaw && !receipt.imagePath) {
    return reply.code(400).send({ error: "no qrRaw or image" });
  }
  const raw = (receipt.raw as any) || {};
  await prisma.receipt.update({
    where: { id },
    data: {
      status: ReceiptStatus.PENDING,
      totalAmount: toDecimal(0) ?? new Prisma.Decimal("0"),
      liters: null,
      pricePerLiter: null,
      fuelType: null,
      fuelGroup: null,
      stationName: null,
      addressShort: null,
      pdfPath: null,
      raw: {
        ...raw,
        workerAttempts: 0,
        workerNote: "manual recognize",
        manualRecognize: true,
        providerResponse: null,
      },
    },
  });
  await prisma.receiptItem.deleteMany({ where: { receiptId: id } });
  return { ok: true };
});
app.post("/api/receipts/mark-reimbursed", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const ids = (req.body as any)?.ids || [];
  await prisma.receipt.updateMany({ where: { id: { in: ids } }, data: { reimbursed: true } });
  return { ok: true };
});

// COMPENSATIONS
app.get("/api/compensations", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const filters = buildCompensationFilters(req.query);
  const limit = Math.max(1, Math.min(500, Number((req.query as any)?.limit ?? 300) || 300));
  const items = await prisma.receipt.findMany({
    where: filters.where,
    orderBy: { receiptAt: "desc" },
    take: limit,
    include: {
      driver: { select: { id: true, fullName: true, telegramUserId: true } },
      vehicle: { select: { id: true, name: true, plateNumber: true } },
    },
  });
  return { items };
});

app.get("/api/reports/compensations/export", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const filters = buildCompensationFilters(req.query);
  const receipts = await prisma.receipt.findMany({
    where: filters.where,
    orderBy: { receiptAt: "desc" },
    include: { driver: true, vehicle: true },
  });
  const header = ["id", "date", "driver", "vehicle", "totalAmount", "paymentComment", "reimbursed"];
  const rows = receipts.map((r) =>
    [
      r.id,
      r.receiptAt ? new Date(r.receiptAt).toISOString() : "",
      r.driver?.fullName || r.driver?.telegramUserId || "",
      r.vehicle?.plateNumber || r.vehicle?.name || "",
      r.totalAmount?.toString() || "",
      r.paymentComment || "",
      r.reimbursed ? "1" : "0",
    ]
      .map((v) => {
        const s = v === null || v === undefined ? "" : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      })
      .join(";")
  );
  const csv = `${header.join(";")}\n${rows.join("\n")}`;
  reply.type("text/csv");
  reply.header("Content-Disposition", 'attachment; filename="compensations.csv"');
  return csv;
});

app.get("/api/reports/compensations/export.xlsx", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const filters = buildCompensationFilters(req.query);
  const receipts = await prisma.receipt.findMany({
    where: filters.where,
    orderBy: { receiptAt: "desc" },
    include: { driver: true, vehicle: true },
  });

  const workbook = new Excel.Workbook();
  const sheet = workbook.addWorksheet("Compensations");
  sheet.columns = [
    { header: "ID", key: "id", width: 36 },
    { header: "Дата", key: "date", width: 20 },
    { header: "Водитель", key: "driver", width: 24 },
    { header: "Авто", key: "vehicle", width: 20 },
    { header: "Сумма", key: "totalAmount", width: 12 },
    { header: "Комментарий", key: "paymentComment", width: 30 },
    { header: "Компенсация", key: "reimbursed", width: 12 },
  ];

  receipts.forEach((r) => {
    sheet.addRow({
      id: r.id,
      date: r.receiptAt ? new Date(r.receiptAt).toISOString() : "",
      driver: r.driver?.fullName || r.driver?.telegramUserId || "",
      vehicle: r.vehicle?.plateNumber || r.vehicle?.name || "",
      totalAmount: r.totalAmount?.toString() || "",
      paymentComment: r.paymentComment || "",
      reimbursed: r.reimbursed ? "Да" : "Нет",
    });
  });

  reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  reply.header("Content-Disposition", 'attachment; filename="compensations.xlsx"');
  const buffer = await workbook.xlsx.writeBuffer();
  return reply.send(Buffer.from(buffer));
});

// REPORTS
app.get("/api/reports/export", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const receipts = await prisma.receipt.findMany({
    orderBy: { receiptAt: "desc" },
    include: { driver: true, vehicle: true },
  });
  const derived = computeDerived(receipts);
  const header = [
    "id",
    "date",
    "driver",
    "vehicle",
    "status",
    "paymentMethod",
    "paidByDriver",
    "reimbursed",
    "paymentComment",
    "totalAmount",
    "mileage",
    "deltaKm",
    "lPer100",
    "fuelType",
    "dataSource",
  ];
  const rows = receipts.map((r) => {
    const d = derived.get(r.id);
    return [
      r.id,
      r.receiptAt ? new Date(r.receiptAt).toISOString() : "",
      r.driver?.fullName || r.driver?.telegramUserId || "",
      r.vehicle?.plateNumber || r.vehicle?.name || "",
      r.status,
      r.paymentMethod || "",
      r.paidByDriver ? "1" : "",
      r.reimbursed ? "1" : "",
      r.paymentComment || "",
      r.totalAmount?.toString() || "",
      r.mileage ?? "",
      d?.deltaKm ?? "",
      d?.lPer100 ?? "",
      r.fuelType || "",
      r.dataSource || "",
    ]
      .map((v) => {
        const s = v === null || v === undefined ? "" : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      })
      .join(";");
  });

  const csv = `${header.join(";")}\n${rows.join("\n")}`;
  reply.type("text/csv");
  reply.header("Content-Disposition", 'attachment; filename="receipts.csv"');
  return csv;
});

app.get("/api/reports/summary", async () => {
  const receipts = await prisma.receipt.findMany({ where: { status: { in: ["DONE", "PENDING"] } } });
  let totalAmount = new Prisma.Decimal(0), totalLiters = new Prisma.Decimal(0), count = 0;
  receipts.forEach(r => {
    count++;
    if (r.totalAmount) totalAmount = totalAmount.add(r.totalAmount);
    if (r.liters) totalLiters = totalLiters.add(r.liters);
  });
  return { count, totalAmount: totalAmount.toString(), totalLiters: totalLiters.toString() };
});

app.get("/api/reports/export.xlsx", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const receipts = await prisma.receipt.findMany({
    orderBy: { receiptAt: "desc" },
    include: { driver: true, vehicle: true },
  });
  const derived = computeDerived(receipts);

  const workbook = new Excel.Workbook();
  const sheet = workbook.addWorksheet("Receipts");
  sheet.columns = [
    { header: "ID", key: "id", width: 36 },
    { header: "Дата", key: "date", width: 20 },
    { header: "Водитель", key: "driver", width: 24 },
    { header: "Авто", key: "vehicle", width: 20 },
    { header: "Статус", key: "status", width: 10 },
    { header: "Оплата", key: "paymentMethod", width: 12 },
    { header: "Оплатил сам", key: "paidByDriver", width: 12 },
    { header: "Компенсация", key: "reimbursed", width: 12 },
    { header: "Комментарий", key: "paymentComment", width: 24 },
    { header: "Сумма", key: "totalAmount", width: 12 },
    { header: "Пробег", key: "mileage", width: 10 },
    { header: "Δкм", key: "deltaKm", width: 10 },
    { header: "л/100", key: "lPer100", width: 10 },
    { header: "Топливо", key: "fuelType", width: 10 },
    { header: "Источник", key: "dataSource", width: 12 },
  ];

  receipts.forEach((r) => {
    const d = derived.get(r.id);
    sheet.addRow({
      id: r.id,
      date: r.receiptAt ? new Date(r.receiptAt).toISOString() : "",
      driver: r.driver?.fullName || r.driver?.telegramUserId || "",
      vehicle: r.vehicle?.plateNumber || r.vehicle?.name || "",
      status: r.status,
      paymentMethod: r.paymentMethod || "",
      paidByDriver: r.paidByDriver ? "Да" : "Нет",
      reimbursed: r.reimbursed ? "Да" : "Нет",
      paymentComment: r.paymentComment || "",
      totalAmount: r.totalAmount?.toString() || "",
      mileage: r.mileage ?? "",
      deltaKm: d?.deltaKm ?? "",
      lPer100: d?.lPer100 ?? "",
      fuelType: r.fuelType || "",
      dataSource: r.dataSource || "",
    });
  });

  reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  reply.header("Content-Disposition", 'attachment; filename="receipts.xlsx"');
  const buffer = await workbook.xlsx.writeBuffer();
  return reply.send(Buffer.from(buffer));
});

// LATE DELAYS
app.post("/api/late-delays", async (req, reply) => {
  const remoteAddress = req.ip || req.socket?.remoteAddress || "";
  const isInternal = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1" || remoteAddress.startsWith("172.") || remoteAddress.startsWith("192.168.");
  if (!isInternal && !(await requireAuth(req, reply))) return;
  const records = (req.body as any)?.records || [];
  for (const record of records) {
    if (!record.driver_name || !record.route_name) continue;
    const delayDate = record.delay_date ? new Date(record.delay_date) : new Date();
    const delayMinutes = parseInt(record.delay_minutes || "0");
    const exists = await prisma.lateDelay.findFirst({
      where: {
        driverName: record.driver_name,
        routeName: record.route_name,
        plateNumber: record.plate_number ?? null,
        plannedTime: record.planned_time ?? null,
        assignedTime: record.assigned_time ?? null,
        delayMinutes,
        delayDate,
      },
    });
    if (exists) continue;
    await prisma.lateDelay.create({
      data: {
        driverName: record.driver_name,
        plateNumber: record.plate_number,
        routeName: record.route_name,
        plannedTime: record.planned_time,
        assignedTime: record.assigned_time,
        delayMinutes,
        delayDate,
      }
    });
  }
  return { ok: true };
});
app.get("/api/late-delays", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const where: any = {};
  if (q.dateFrom || q.dateTo) {
    where.delayDate = {};
    if (q.dateFrom) where.delayDate.gte = new Date(q.dateFrom);
    if (q.dateTo) {
      const end = new Date(q.dateTo);
      end.setHours(23, 59, 59, 999);
      where.delayDate.lte = end;
    }
  }
  if (q.driverName) where.driverName = { contains: q.driverName, mode: "insensitive" };
  const raw = await prisma.lateDelay.findMany({ where, orderBy: { delayDate: "desc" }, take: 1000 });
  const seen = new Set<string>();
  const items = raw.filter((d) => {
    const dateKey = d.delayDate ? d.delayDate.toISOString().slice(0, 10) : "";
    const key = [
      (d.driverName || "").trim().toLowerCase(),
      (d.routeName || "").trim().toLowerCase(),
      (d.plannedTime || "").trim(),
      (d.assignedTime || "").trim(),
      (d.plateNumber || "").trim().toUpperCase(),
      String(d.delayMinutes ?? ""),
      dateKey,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items };
});
app.get("/api/late-delays/summary", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const where: any = {};
  if (q.dateFrom || q.dateTo) {
    where.delayDate = {};
    if (q.dateFrom) where.delayDate.gte = new Date(q.dateFrom);
    if (q.dateTo) {
      const end = new Date(q.dateTo);
      end.setHours(23, 59, 59, 999);
      where.delayDate.lte = end;
    }
  }
  if (q.driverName) where.driverName = { contains: q.driverName, mode: "insensitive" };
  const raw = await prisma.lateDelay.findMany({ where });
  const seen = new Set<string>();
  const all = raw.filter((d) => {
    const dateKey = d.delayDate ? d.delayDate.toISOString().slice(0, 10) : "";
    const key = [
      (d.driverName || "").trim().toLowerCase(),
      (d.routeName || "").trim().toLowerCase(),
      (d.plannedTime || "").trim(),
      (d.assignedTime || "").trim(),
      (d.plateNumber || "").trim().toUpperCase(),
      String(d.delayMinutes ?? ""),
      dateKey,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const map = new Map<string, any>();
  for (const d of all) {
    if (!map.has(d.driverName)) map.set(d.driverName, { driverName: d.driverName, red: 0, yellow: 0, green: 0 });
    const s = map.get(d.driverName);
    if (d.delayMinutes >= 21) s.red++;
    else if (d.delayMinutes >= 11) s.yellow++;
    else s.green++;
  }
  return { summary: Array.from(map.values()).sort((a, b) => (b.red+b.yellow+b.green) - (a.red+a.yellow+a.green)) };
});

// FINANCE
app.get("/api/finance", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const source = String(q.source || "afina").toLowerCase();
  const fileName = source === "nika" ? "finance_nika.json" : "finance_afina.json";
  const filePath = path.join("/app/data", "finance", fileName);
  if (!fs.existsSync(filePath)) {
    return reply.code(404).send({ error: "finance file not found" });
  }
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    const stat = await fs.promises.stat(filePath);
    return { ...data, updatedAt: data.updatedAt || stat.mtime.toISOString() };
  } catch (e: any) {
    return reply.code(500).send({ error: e?.message || "failed to read finance file" });
  }
});

app.post("/api/finance/refresh", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const source = String(q.source || "all").toLowerCase();
  const baseDir = path.join("/app/data", "finance");
  const triggerPath = path.join(baseDir, "refresh.json");
  try {
    await fs.promises.mkdir(baseDir, { recursive: true });
    await fs.promises.writeFile(
      triggerPath,
      JSON.stringify({ source, requestedAt: new Date().toISOString() }),
      "utf-8"
    );
    return { ok: true };
  } catch (e: any) {
    return reply.code(500).send({ error: e?.message || "failed to request refresh" });
  }
});

// RELEASES
const RELEASES_RECIPIENTS = [
  "pleshakova@karavay.spb.ru",
  "disp_spb_pp1@karavay.spb.ru",
  "kolyukha@karavay.spb.ru",
  "tek-nika@mail.ru",
  "security01@karavay.spb.ru",
];

function getReleaseFile(source: string) {
  const name = source === "nika" ? "releases_nika.json" : "releases_afina.json";
  return path.join("/app/data", "releases", name);
}

function isEmptyReleaseRow(row: any) {
  const fields = [
    row?.time,
    row?.routeNumber,
    row?.routeName,
    row?.driverName,
    row?.vehicleNumber,
    row?.capacity,
    row?.phone,
    row?.comment,
  ];
  return fields.every((v) => !String(v ?? "").trim());
}

function buildListsFromReleases(afina: any, nika: any) {
  const drivers: Array<{ id: string; name: string; phone: string }> = [];
  const vehicles: Array<{ id: string; plate: string; capacity: string }> = [];
  const routes: Array<{ id: string; number: string; name: string; time: string }> = [];
  const driverKeys = new Set<string>();
  const vehicleKeys = new Set<string>();
  const routeKeys = new Set<string>();

  const pushRow = (row: any) => {
    const driverName = String(row?.driverName || "").trim();
    const phone = String(row?.phone || "").trim();
    const vehicleNumber = String(row?.vehicleNumber || "").trim();
    const capacity = String(row?.capacity || "").trim();
    const routeNumber = String(row?.routeNumber || "").trim();
    const routeName = String(row?.routeName || "").trim();
    const time = String(row?.time || "").trim();

    if (driverName) {
      const key = `${driverName.toLowerCase()}|${phone}`;
      if (!driverKeys.has(key)) {
        drivers.push({ id: crypto.randomUUID(), name: driverName, phone });
        driverKeys.add(key);
      }
    }

    if (vehicleNumber) {
      const key = `${vehicleNumber.toLowerCase()}|${capacity}`;
      if (!vehicleKeys.has(key)) {
        vehicles.push({ id: crypto.randomUUID(), plate: vehicleNumber, capacity });
        vehicleKeys.add(key);
      }
    }

    if (routeName || routeNumber) {
      const key = `${routeNumber.toLowerCase()}|${routeName.toLowerCase()}|${time}`;
      if (!routeKeys.has(key)) {
        routes.push({ id: crypto.randomUUID(), number: routeNumber, name: routeName, time });
        routeKeys.add(key);
      }
    }
  };

  const rowsA = Array.isArray(afina?.rows) ? afina.rows : [];
  const rowsN = Array.isArray(nika?.rows) ? nika.rows : [];
  rowsA.forEach(pushRow);
  rowsN.forEach(pushRow);

  return { drivers, vehicles, routes };
}

app.get("/api/releases", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const source = String(q.source || "afina").toLowerCase();
  const filePath = getReleaseFile(source);
  try {
    if (!fs.existsSync(filePath)) {
      return {
        source,
        date: new Date().toISOString().slice(0, 10),
        rows: [],
        updatedAt: new Date().toISOString(),
      };
    }
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data?.rows)) {
      const filteredRows = data.rows.filter((row: any) => !isEmptyReleaseRow(row));
      if (filteredRows.length !== data.rows.length) {
        data.rows = filteredRows;
        try {
          await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
        } catch {
          // ignore cleanup errors
        }
      }
    }
    const stat = await fs.promises.stat(filePath);
    return { ...data, updatedAt: data.updatedAt || stat.mtime.toISOString() };
  } catch (e: any) {
    return reply.code(500).send({ error: e?.message || "failed to read releases file" });
  }
});

app.post("/api/releases", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const source = String(q.source || "afina").toLowerCase();
  const body = (req.body ?? {}) as any;
  const date = String(body.date || "").trim();
  const rows = Array.isArray(body.rows)
    ? body.rows.filter((row: any) => !isEmptyReleaseRow(row))
    : [];
  const payload = {
    source,
    date: date || new Date().toISOString().slice(0, 10),
    rows,
    updatedAt: new Date().toISOString(),
  };
  const dir = path.join("/app/data", "releases");
  const filePath = getReleaseFile(source);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return { ok: true };
  } catch (e: any) {
    return reply.code(500).send({ error: e?.message || "failed to save releases file" });
  }
});

app.get("/api/releases/lists", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const filePath = path.join("/app/data", "releases", "lists.json");
  try {
    if (!fs.existsSync(filePath)) {
      const afinaPath = getReleaseFile("afina");
      const nikaPath = getReleaseFile("nika");
      const afina = fs.existsSync(afinaPath) ? JSON.parse(await fs.promises.readFile(afinaPath, "utf-8")) : { rows: [] };
      const nika = fs.existsSync(nikaPath) ? JSON.parse(await fs.promises.readFile(nikaPath, "utf-8")) : { rows: [] };
      const lists = buildListsFromReleases(afina, nika);
      const payload = { ...lists, updatedAt: new Date().toISOString() };
      try {
        await fs.promises.mkdir(path.join("/app/data", "releases"), { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
      } catch {
        // ignore write errors
      }
      return payload;
    }
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    const stat = await fs.promises.stat(filePath);
    return { ...data, updatedAt: data.updatedAt || stat.mtime.toISOString() };
  } catch (e: any) {
    return reply.code(500).send({ error: e?.message || "failed to read releases lists" });
  }
});

app.post("/api/releases/lists", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const body = (req.body ?? {}) as any;
  const drivers = Array.isArray(body.drivers) ? body.drivers : [];
  const vehicles = Array.isArray(body.vehicles) ? body.vehicles : [];
  const routes = Array.isArray(body.routes) ? body.routes : [];
  const payload = { drivers, vehicles, routes, updatedAt: new Date().toISOString() };
  const dir = path.join("/app/data", "releases");
  const filePath = path.join(dir, "lists.json");
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return { ok: true };
  } catch (e: any) {
    return reply.code(500).send({ error: e?.message || "failed to save releases lists" });
  }
});

app.post("/api/releases/email", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const body = (req.body ?? {}) as any;
  const source = String(body.source || "afina").toLowerCase();
  const date = String(body.date || "").trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];

  const smtp = buildSmtpConfig();
  if (!smtp.user || !smtp.pass) {
    return reply.code(400).send({ error: "smtp credentials not set" });
  }

  const workbook = new Excel.Workbook();
  const sheetName = source === "nika" ? "Ника" : "Афина";
  const sheet = workbook.addWorksheet(sheetName);

  const headers = [
    "№ п/п",
    "Время подачи",
    "Номер маршрута",
    "Наименование маршрута",
    "ФИО водителя",
    "Гос. номер а/м",
    "Вместимость а/м",
    "Номер телефона",
    "Комментарии",
  ];
  const keys = [
    "index",
    "time",
    "routeNumber",
    "routeName",
    "driverName",
    "vehicleNumber",
    "capacity",
    "phone",
    "comment",
  ];
  const widths = [6, 14, 16, 28, 24, 16, 14, 18, 22];
  sheet.columns = keys.map((key, idx) => ({ key, width: widths[idx] }));

  const title = `Сводка на ${formatRuDate(date)}`;
  sheet.mergeCells(1, 1, 1, 9);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true };
  sheet.getCell(1, 1).alignment = { horizontal: "center" };
  sheet.getRow(2).values = headers;
  sheet.getRow(2).font = { bold: true };

  rows.forEach((row: any, idx: number) => {
    sheet.addRow({
      index: idx + 1,
      time: row.time || "",
      routeNumber: row.routeNumber || "",
      routeName: row.routeName || "",
      driverName: row.driverName || "",
      vehicleNumber: row.vehicleNumber || "",
      capacity: row.capacity || "",
      phone: row.phone || "",
      comment: row.comment || "",
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const subject = `Выпуск Афина-Ника на ${formatRuDate(date)}`;
  const text = `Здравствуйте, высылаю выпуск Афина-Ника на ${formatRuDate(date)}`;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  await transporter.sendMail({
    from: smtp.from,
    to: RELEASES_RECIPIENTS,
    subject,
    text,
    attachments: [
      {
        filename: `Выпуск_${sheetName}_${formatRuDate(date)}.xlsx`,
        content: Buffer.from(buffer),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });

  return { ok: true };
});

app.get("/api/releases/export.xlsx", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const afinaPath = getReleaseFile("afina");
  const nikaPath = getReleaseFile("nika");
  const afina = fs.existsSync(afinaPath) ? JSON.parse(await fs.promises.readFile(afinaPath, "utf-8")) : { date: "", rows: [] };
  const nika = fs.existsSync(nikaPath) ? JSON.parse(await fs.promises.readFile(nikaPath, "utf-8")) : { date: "", rows: [] };

  const workbook = new Excel.Workbook();
  const addSheet = (name: string, payload: any, fallbackDate?: string) => {
    const sheet = workbook.addWorksheet(name);
    const headers = [
      "№ п/п",
      "Время подачи",
      "Номер маршрута",
      "Наименование маршрута",
      "ФИО водителя",
      "Гос. номер а/м",
      "Вместимость а/м",
      "Номер телефона",
      "Комментарии",
    ];
    const keys = [
      "index",
      "time",
      "routeNumber",
      "routeName",
      "driverName",
      "vehicleNumber",
      "capacity",
      "phone",
      "comment",
    ];
    const widths = [8, 16, 18, 40, 30, 20, 18, 20, 30];
    sheet.columns = keys.map((key, idx) => ({ key, width: widths[idx] }));
    
    // Header Row 1: "Сводка на ..."
    sheet.mergeCells(1, 1, 1, headers.length);
    const titleCell = sheet.getCell(1, 1);
    const dateValue = payload?.date || fallbackDate || "";
    titleCell.value = `Сводка на ${formatRuDate(dateValue)}`;
    titleCell.font = { bold: true, size: 14, color: { argb: "FF1F2937" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5F2D8" } };

    // Header Row 2: Column names
    const headerRow = sheet.getRow(2);
    headerRow.values = headers;
    headerRow.font = { bold: true, color: { argb: "FF475569" } };
    headerRow.height = 25;
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    rows.forEach((row: any, idx: number) => {
      sheet.addRow({
        index: idx + 1,
        time: row.time || "",
        routeNumber: row.routeNumber || "",
        routeName: row.routeName || "",
        driverName: row.driverName || "",
        vehicleNumber: row.vehicleNumber || "",
        capacity: row.capacity || "",
        phone: row.phone || "",
        comment: row.comment || "",
      });
    });

    const borderStyle = {
      top: { style: "thin" as const, color: { argb: "FF9CA3AF" } },
      left: { style: "thin" as const, color: { argb: "FF9CA3AF" } },
      bottom: { style: "thin" as const, color: { argb: "FF9CA3AF" } },
      right: { style: "thin" as const, color: { argb: "FF9CA3AF" } },
    };

    const lastRowNum = sheet.lastRow?.number ?? 2;
    for (let r = 1; r <= lastRowNum; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= headers.length; c++) {
        const cell = row.getCell(c);
        cell.border = borderStyle;
        if (r === 1) {
          // Keep title centered
          cell.alignment = { horizontal: "center", vertical: "middle" };
        } else if (r === 2) {
          // Keep headers centered
          cell.alignment = { horizontal: "center", vertical: "middle" };
        } else {
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
          cell.font = { size: 11 };
          // Zebra striping for readability
          if (r % 2 === 1) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
          }
        }
      }
    }
  };

  addSheet("Ника", nika, afina?.date);
  addSheet("Афина", afina, nika?.date);

  reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  reply.header("Content-Disposition", 'attachment; filename="releases.xlsx"');
  const buffer = await workbook.xlsx.writeBuffer();
  return reply.send(Buffer.from(buffer));
});

// SHIFTS
app.post("/api/shifts", async (req, reply) => {
  const remoteAddress = req.ip || req.socket?.remoteAddress || "";
  const isInternal = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1" || remoteAddress.startsWith("172.") || remoteAddress.startsWith("192.168.");
  if (!isInternal && !(await requireAuth(req, reply))) return;
  const { records } = (req.body ?? {}) as any;
  if (!Array.isArray(records)) return reply.code(400).send({ error: "records array required" });

  for (const r of records) {
    if (!r.driver_name || !r.route_name || !r.shift_date) continue;
    const shiftDate = new Date(r.shift_date);
    const dayStart = new Date(shiftDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(shiftDate);
    dayEnd.setHours(23, 59, 59, 999);

    const where = {
      driverName: r.driver_name,
      routeName: r.route_name,
      routeNumber: r.route_number || null,
      plateNumber: r.plate_number || null,
      plannedTime: r.planned_time || null,
      assignedTime: r.assigned_time || null,
      departureTime: r.departure_time || null,
      delayMinutes: r.delay_minutes ?? null,
      shiftDate: { gte: dayStart, lte: dayEnd },
    };

    const data = {
      driverName: r.driver_name,
      plateNumber: r.plate_number || null,
      routeName: r.route_name,
      routeNumber: r.route_number || null,
      plannedTime: r.planned_time || null,
      assignedTime: r.assigned_time || null,
      departureTime: r.departure_time || null,
      delayMinutes: r.delay_minutes ?? null,
      shiftDate,
    };

    const existing = await prisma.shift.findFirst({ where });
    if (existing) {
      await prisma.shift.update({ where: { id: existing.id }, data });
    } else {
      await prisma.shift.create({ data });
    }
  }
  return { ok: true, count: records.length };
});

app.get("/api/shifts", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const where: any = {};
  if (q.dateFrom || q.dateTo) {
    where.shiftDate = {};
    if (q.dateFrom) where.shiftDate.gte = new Date(q.dateFrom);
    if (q.dateTo) {
      const end = new Date(q.dateTo);
      end.setHours(23, 59, 59, 999);
      where.shiftDate.lte = end;
    }
  }
  if (q.driverName) where.driverName = { contains: q.driverName, mode: "insensitive" };
  if (q.plateNumber) where.plateNumber = { contains: q.plateNumber, mode: "insensitive" };
  
  return { items: await prisma.shift.findMany({ where, orderBy: { shiftDate: "desc" }, take: 2000 }) };
});

app.delete("/api/shifts/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { id } = req.params as any;
  if (!id) return reply.code(400).send({ error: "id required" });
  await prisma.shift.deleteMany({ where: { id } });
  return { ok: true };
});

app.get("/api/shifts/routes", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const items = await prisma.shift.findMany({
    where: { routeNumber: { not: null } },
    select: { routeNumber: true, routeName: true, shiftDate: true },
    orderBy: { shiftDate: "desc" },
  });
  const map: Record<string, string> = {};
  const mapNormalized: Record<string, string> = {};
  const mapByDate: Record<string, string> = {};
  const mskDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" });
  for (const item of items) {
    const key = item.routeNumber ? String(item.routeNumber) : "";
    if (key && !(key in map)) {
      map[key] = item.routeName || "";
    }
    if (key) {
      const match = key.match(/\d+/);
      if (match && !(match[0] in mapNormalized)) {
        mapNormalized[match[0]] = item.routeName || "";
      }
    }
    if (key && item.shiftDate) {
      const dateKey = mskDateFormatter.format(item.shiftDate);
      const matches = key.match(/\d+/g) || [];
      const routeNumbers = matches.length > 0 ? matches : [key];
      for (const routeNumber of routeNumbers) {
        const compoundKey = `${routeNumber}|${dateKey}`;
        if (!(compoundKey in mapByDate)) {
          mapByDate[compoundKey] = item.routeName || "";
        }
      }
    }
  }
  return { items, map, mapNormalized, mapByDate };
});

app.get("/api/shifts/summary", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const where: any = {};
  if (q.dateFrom || q.dateTo) {
    where.shiftDate = {};
    if (q.dateFrom) where.shiftDate.gte = new Date(q.dateFrom);
    if (q.dateTo) {
      const end = new Date(q.dateTo);
      end.setHours(23, 59, 59, 999);
      where.shiftDate.lte = end;
    }
  }
  
  const all = await prisma.shift.findMany({ where });
  const driverMap = new Map<string, any>();
  const vehicleMap = new Map<string, any>();

  for (const s of all) {
    if (!driverMap.has(s.driverName)) {
      driverMap.set(s.driverName, { 
        driverName: s.driverName, 
        shiftCount: 0, 
        routes: new Set(), 
        vehicles: new Set() 
      });
    }
    const d = driverMap.get(s.driverName);
    d.shiftCount++;
    d.routes.add(s.routeName);
    if (s.plateNumber) d.vehicles.add(s.plateNumber);

    if (s.plateNumber) {
      if (!vehicleMap.has(s.plateNumber)) {
        vehicleMap.set(s.plateNumber, { 
          plateNumber: s.plateNumber, 
          shiftCount: 0, 
          routes: new Set(), 
          drivers: new Set() 
        });
      }
      const v = vehicleMap.get(s.plateNumber);
      v.shiftCount++;
      v.routes.add(s.routeName);
      v.drivers.add(s.driverName);
    }
  }

  const driverSummary = Array.from(driverMap.values()).map(d => ({
    ...d,
    routes: Array.from(d.routes),
    vehicles: Array.from(d.vehicles)
  })).sort((a, b) => b.shiftCount - a.shiftCount);

  const vehicleSummary = Array.from(vehicleMap.values()).map(v => ({
    ...v,
    routes: Array.from(v.routes),
    drivers: Array.from(v.drivers)
  })).sort((a, b) => b.shiftCount - a.shiftCount);

  return { driverSummary, vehicleSummary };
});

// ROUTE RATES
app.get("/api/route-rates", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  return await prisma.routeRate.findMany({ orderBy: { routeName: "asc" } });
});

app.post("/api/route-rates", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { routeName, rate } = (req.body ?? {}) as any;
  if (!routeName) return reply.code(400).send({ error: "routeName required" });
  return await prisma.routeRate.upsert({
    where: { routeName },
    update: { rate },
    create: { routeName, rate },
  });
});

app.delete("/api/route-rates/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { id } = req.params as any;
  await prisma.routeRate.delete({ where: { id } });
  return { ok: true };
});

// DRIVER PAYMENTS
app.get("/api/driver-payments", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  return await prisma.driverPayment.findMany({ orderBy: { paymentDate: "desc" }, include: { driver: true } });
});

app.post("/api/driver-payments", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const data = (req.body ?? {}) as any;
  return await prisma.driverPayment.create({
    data: {
      driverId: data.driverId,
      amount: data.amount,
      paymentDate: new Date(data.paymentDate),
      accountedDate: data.accountedDate ? new Date(data.accountedDate) : null,
      payoutType: data.payoutType,
      period: data.period,
      periodFrom: data.periodFrom ? new Date(data.periodFrom) : null,
      periodTo: data.periodTo ? new Date(data.periodTo) : null,
      comment: data.comment,
    },
  });
});

app.patch("/api/driver-payments/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { id } = req.params as any;
  const data = (req.body ?? {}) as any;
  const updateData: any = {};
  if (data.amount !== undefined) updateData.amount = data.amount;
  if (data.paymentDate) updateData.paymentDate = new Date(data.paymentDate);
  if (data.accountedDate !== undefined) updateData.accountedDate = data.accountedDate ? new Date(data.accountedDate) : null;
  if (data.payoutType !== undefined) updateData.payoutType = data.payoutType;
  if (data.comment !== undefined) updateData.comment = data.comment;
  return await prisma.driverPayment.update({ where: { id }, data: updateData });
});

app.delete("/api/driver-payments/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { id } = req.params as any;
  await prisma.driverPayment.delete({ where: { id } });
  return { ok: true };
});

// CUSTOM LISTS
app.get("/api/lists", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { type } = (req.query ?? {}) as any;
  return await prisma.customList.findMany({
    where: type ? { type } : {},
    include: { items: { include: { driver: true, vehicle: true } } },
    orderBy: { createdAt: "desc" },
  });
});

app.post("/api/lists", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { name, type } = (req.body ?? {}) as any;
  if (!name || !type) return reply.code(400).send({ error: "name and type required" });
  return await prisma.customList.create({ data: { name, type } });
});

app.delete("/api/lists/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { id } = req.params as any;
  await prisma.customList.delete({ where: { id } });
  return { ok: true };
});

app.post("/api/lists/:id/items", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { id } = req.params as any;
  const { driverId, vehicleId, routeName } = (req.body ?? {}) as any;
  if (!driverId && !vehicleId && !routeName) return reply.code(400).send({ error: "driverId, vehicleId, or routeName required" });
  return await prisma.customListItem.create({
    data: { listId: id, driverId, vehicleId, routeName },
  });
});

app.delete("/api/lists/items/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { id } = req.params as any;
  await prisma.customListItem.delete({ where: { id } });
  return { ok: true };
});

// PAYMENT DETAILS
app.get("/api/drivers/:id/payment-details", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { id } = req.params as any;
  return await prisma.driverPaymentDetail.findMany({ where: { driverId: id } });
});

app.post("/api/payment-details", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const data = (req.body ?? {}) as any;
  return await prisma.driverPaymentDetail.create({
    data: {
      driverId: data.driverId,
      type: data.type,
      bankName: data.bankName,
      account: data.account,
      isDefault: !!data.isDefault,
    },
  });
});

app.delete("/api/payment-details/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const { id } = req.params as any;
  await prisma.driverPaymentDetail.delete({ where: { id } });
  return { ok: true };
});

app.delete("/api/late-delays", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const ids = (req.body as any)?.ids || [];
  if (!Array.isArray(ids) || ids.length === 0) return reply.code(400).send({ error: "ids required" });
  await prisma.lateDelay.deleteMany({ where: { id: { in: ids } } });
  return { ok: true };
});

app.delete("/api/late-delays/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id;
  await prisma.lateDelay.delete({ where: { id } });
  return reply.code(204).send();
});

registerTelegramRoutes(app, prisma);
registerRepairRoutes(app, prisma, requireAuth);

const port = Number(process.env.BACKEND_PORT ?? 3000);
async function main() {
  try {
    await app.listen({ host: "0.0.0.0", port });
    startPendingWorker(prisma);
    startRepairBot(prisma);
    startMaintenanceCron(prisma);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
main();
