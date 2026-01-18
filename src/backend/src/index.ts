import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fs from "fs";
import path from "path";
import Excel from "exceljs";
import { PrismaClient, Prisma, ReceiptStatus, PaymentMethod, FuelType, DataSource } from "@prisma/client";
import { createReceiptFromDto, CreateReceiptDto } from "./receipt-service.js";
import { registerTelegramRoutes } from "./telegram-router.js";
import { startPendingWorker } from "./pending-worker.js";
import { errorLogger } from "./logger.js";
import { registerRepairRoutes } from "./repair-routes.js";
import { refreshVehicleOdometer } from "./repair-utils.js";
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

app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const ADMIN_LOGIN = process.env.WEB_ADMIN_LOGIN;
const ADMIN_PASSWORD = process.env.WEB_ADMIN_PASSWORD;
const sessionSecret = process.env.WEB_SESSION_SECRET || jwtSecret;

app.log.info({
  WEB_ADMIN_LOGIN: ADMIN_LOGIN ? "SET" : "NOT SET",
  WEB_ADMIN_PASSWORD: ADMIN_PASSWORD ? `SET len=${ADMIN_PASSWORD.length}` : "NOT SET",
  WEB_SESSION_SECRET: sessionSecret ? `SET len=${sessionSecret.length}` : "NOT SET",
  COOKIE_DOMAIN: cookieDomain || "NOT SET",
  WEB_ORIGIN: allowedOrigin || "NOT SET",
}, "auth env info");

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
      return reply
        .code(400)
        .send({
          error: "unique_constraint",
          target,
          message:
            target === "plateNumber"
              ? "Госномер уже существует"
              : target === "telegramUserId"
              ? "Такой Telegram ID уже существует"
              : undefined,
        });
    }
  }
  return reply.code(500).send({ error: err?.message ?? "unexpected error" });
}

async function requireAuth(req: any, reply: any) {
  try {
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
    // Try jwtVerify as fallback
    try {
      const verified = await req.jwtVerify();
      req.user = verified;
      return true;
    } catch (jwtErr) {
      // Log auth failure for debugging
      req.log.warn({ 
        path: req.url, 
        cookies: Object.keys(req.cookies || {}), 
        hasAuth: !!auth,
        error: (jwtErr as Error).message 
      }, "auth failed");
      reply.code(401).send({ error: "unauthorized" });
      return false;
    }
  } catch (err) {
    req.log.warn({ path: req.url, error: (err as Error).message }, "requireAuth exception");
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
}

app.setErrorHandler((error, req, reply) => {
  errorLogger.error({
    message: error?.message ?? "unhandled_error",
    stack: error?.stack,
    path: req.url,
    method: req.method,
    ip: req.ip,
    reqId: req.id,
    user: (req as any)?.user?.login ?? "anonymous",
  });
  // Also log via Fastify logger for stdout/aggregated logs.
  req.log.error({ err: error }, "unhandled error");
  if (!reply.sent) {
    reply.code(500).send({ error: "internal_error" });
  }
});

app.get("/", async () => ({ ok: true, service: "fuel-control" }));
app.get("/health", async () => ({ ok: true }));

app.post("/api/auth/login", async (req, reply) => {
  if (!sessionSecret) {
    app.log.error("session secret not set");
    return reply.code(500).send({ error: "admin credentials not configured" });
  }
  const body = (req.body ?? {}) as any;
  const login = (body.login ?? "").toString();
  const password = (body.password ?? "").toString();

  if (!ADMIN_LOGIN || !ADMIN_PASSWORD || login !== ADMIN_LOGIN || password !== ADMIN_PASSWORD) {
    app.log.warn({ login }, "auth login failed");
    return reply.code(401).send({ error: "invalid credentials" });
  }

  const token = app.jwt.sign({ login, role: "admin" }, { expiresIn: "7d" });
  reply.setCookie("fuel_token", token, cookieOpts());
  app.log.info({ login }, "auth login success");
  return reply.code(200).send({ token });
});

app.post("/api/auth/logout", async (req, reply) => {
  reply.clearCookie("fuel_token", cookieOpts());
  return reply.code(200).send({ ok: true });
});

// Client-side error intake: allows frontend to report JS/runtime errors.
app.post("/api/client-log", async (req, reply) => {
  const body = (req.body ?? {}) as any;
  errorLogger.error({
    kind: "client_error",
    message: body?.message ?? "client_error",
    stack: body?.stack,
    context: body?.context,
    path: req.url,
    method: req.method,
    ip: req.ip,
    user: (req as any)?.user?.login ?? "anonymous",
  });
  return reply.code(200).send({ ok: true });
});

app.get("/api/auth/me", async (req, reply) => {
  try {
    const ok = await requireAuth(req, reply);
    if (!ok || !req.user) return;
    const user = req.user as any;
    return reply.code(200).send({ login: user?.login ?? "admin", role: "admin" });
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/api/drivers", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  return prisma.driver.findMany({
    orderBy: { createdAt: "desc" },
  });
});

app.post("/api/drivers", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const body = (req.body ?? {}) as any;
  const id = body.id as string | undefined;
  const telegramUserId = (body.telegramUserId as string | undefined)?.trim();
  if (!telegramUserId) return reply.code(400).send({ error: "telegramUserId is required" });
  const fullName = (body.fullName as string | undefined)?.trim();
  const isActive = body.isActive as boolean | undefined;

  try {
    req.log.info({ id, telegramUserId }, "driver upsert attempt");
    
    // Если редактируем существующего водителя
    if (id) {
      const payload = {
        telegramUserId,
        fullName: fullName ?? telegramUserId,
        isActive: isActive ?? true,
      };
      const driver = await prisma.driver.update({ where: { id }, data: payload });
      req.log.info({ id: driver.id, telegramUserId: driver.telegramUserId }, "driver updated");
      return reply.code(200).send(driver);
    }

    // Если создаем нового водителя - проверяем, существует ли уже (включая неактивных)
    const existing = await prisma.driver.findUnique({
      where: { telegramUserId },
    });

    if (existing) {
      // Если существует активный водитель - возвращаем ошибку
      if (existing.isActive) {
        return reply.code(400).send({ error: "driver_already_exists", message: "Водитель с таким Telegram ID уже добавлен" });
      }
      // Если существует неактивный - активируем и обновляем
      const payload = {
        fullName: fullName ?? telegramUserId,
        isActive: true,
      };
      const driver = await prisma.driver.update({ where: { id: existing.id }, data: payload });
      req.log.info({ id: driver.id, telegramUserId: driver.telegramUserId }, "driver reactivated");
      return reply.code(200).send(driver);
    }

    // Создаем нового водителя
    const payload = {
      telegramUserId,
      fullName: fullName ?? telegramUserId,
      isActive: isActive ?? true,
    };
    const driver = await prisma.driver.create({ data: payload });
    req.log.info({ id: driver.id, telegramUserId: driver.telegramUserId }, "driver created");
    return reply.code(201).send(driver);
  } catch (err: any) {
    req.log.error({ err, id, telegramUserId }, "driver save error");
    return handlePrismaError(err, reply);
  }
});

app.post("/api/drivers/:id/deactivate", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id as string | undefined;
  if (!id) return reply.code(400).send({ error: "id is required" });
  try {
    const driver = await prisma.driver.update({
      where: { id },
      data: { isActive: false },
    });
    return reply.code(200).send(driver);
  } catch (err: any) {
    req.log.error({ err, id }, "driver deactivate error");
    return handlePrismaError(err, reply);
  }
});

app.get("/api/vehicles", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  return prisma.vehicle.findMany({
    orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
  });
});

function computeDerived(receipts: any[]) {
  const sortedAsc = [...receipts].sort((a, b) => {
    const ta = new Date(a.receiptAt).getTime();
    const tb = new Date(b.receiptAt).getTime();
    return ta - tb;
  });
  const lastMileageByVehicle = new Map<string, number>();
  const derived = new Map<string, { deltaKm: number | null; lPer100: number | null }>();
  for (const r of sortedAsc) {
    const prevMileage = r.vehicleId ? lastMileageByVehicle.get(r.vehicleId) : undefined;
    let deltaKm: number | null = null;
    let lPer100: number | null = null;
    if (r.mileage !== null && r.mileage !== undefined && typeof prevMileage === "number") {
      deltaKm = r.mileage - prevMileage;
      if (deltaKm <= 0) {
        deltaKm = null;
      }
    }
    if (deltaKm !== null && r.liters !== null && r.liters !== undefined) {
      const litersNum = Number(r.liters);
      if (!Number.isNaN(litersNum) && deltaKm > 0) {
        lPer100 = Number((litersNum / deltaKm) * 100);
      }
    }
    if (deltaKm !== null || lPer100 !== null) {
      derived.set(r.id, { deltaKm, lPer100 });
    }
    if (r.vehicleId && r.mileage !== null && r.mileage !== undefined) {
      lastMileageByVehicle.set(r.vehicleId, r.mileage);
    }
  }
  return derived;
}

app.post("/api/vehicles", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const body = (req.body ?? {}) as any;
  const id = body.id as string | undefined;
  const rawPlate = (body.plateNumber as string | undefined)?.trim();
  const plateNumber = rawPlate ? rawPlate.toUpperCase() : null;
  const name = (body.name as string | undefined)?.trim() || plateNumber || "Без названия";
  const sortOrder = body.sortOrder as number | undefined;
  const isActive = body.isActive as boolean | undefined;

  if (!plateNumber) {
    return reply.code(400).send({ error: "plateNumber_required", message: "Госномер обязателен" });
  }

  const payload = {
    name,
    plateNumber: plateNumber ?? "",
    makeModel: (body.makeModel as string | undefined)?.trim() ?? null,
    year: body.year ? Number(body.year) : null,
    vin: (body.vin as string | undefined)?.trim() ?? null,
    engine: (body.engine as string | undefined)?.trim() ?? null,
    color: (body.color as string | undefined)?.trim() ?? null,
    purchasedAt: body.purchasedAt ? new Date(body.purchasedAt) : null,
    purchasedOdometerKm: body.purchasedOdometerKm ? Number(body.purchasedOdometerKm) : null,
    currentOdometerKm: body.currentOdometerKm ? Number(body.currentOdometerKm) : null,
    notes: (body.notes as string | undefined)?.trim() ?? null,
    sortOrder: sortOrder ?? 0,
    isActive: isActive ?? true,
  };

  try {
    req.log.info({ plateNumber, id }, "vehicle upsert attempt");
    
    // Если редактируем существующее авто
    if (id) {
      const vehicle = await prisma.vehicle.update({ where: { id }, data: payload });
      req.log.info({ id: vehicle.id, plateNumber: vehicle.plateNumber }, "vehicle updated");
      return reply.code(200).send(vehicle);
    }

    // Если создаем новое авто - проверяем, существует ли уже (включая неактивные)
    const existing = await prisma.vehicle.findUnique({
      where: { plateNumber },
    });

    if (existing) {
      // Если существует активное авто - возвращаем ошибку
      if (existing.isActive) {
        return reply.code(400).send({ error: "vehicle_already_exists", message: "Авто с таким госномером уже добавлено" });
      }
      // Если существует неактивное - активируем и обновляем
      const vehicle = await prisma.vehicle.update({ where: { id: existing.id }, data: { ...payload, isActive: true } });
      req.log.info({ id: vehicle.id, plateNumber: vehicle.plateNumber }, "vehicle reactivated");
      return reply.code(200).send(vehicle);
    }

    // Создаем новое авто
    const vehicle = await prisma.vehicle.create({ data: payload });
    req.log.info({ id: vehicle.id, plateNumber: vehicle.plateNumber }, "vehicle created");
    return reply.code(201).send(vehicle);
  } catch (err: any) {
    req.log.error({ err, plateNumber, id }, "vehicle save error");
    return handlePrismaError(err, reply);

  }
});

app.post("/api/vehicles/:id/deactivate", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id as string | undefined;
  if (!id) return reply.code(400).send({ error: "id is required" });
  try {
    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: { isActive: false },
    });
    return reply.code(200).send(vehicle);
  } catch (err: any) {
    req.log.error({ err, id }, "vehicle deactivate error");
    return handlePrismaError(err, reply);
  }
});

app.get("/api/vehicles/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id as string | undefined;
  if (!id) return reply.code(400).send({ error: "id is required" });
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle) return reply.code(404).send({ error: "not found" });
  return vehicle;
});

app.patch("/api/vehicles/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id as string | undefined;
  if (!id) return reply.code(400).send({ error: "id is required" });
  const body = (req.body ?? {}) as any;
  const rawPlate = (body.plateNumber as string | undefined)?.trim();
  const plateNumber = rawPlate ? rawPlate.toUpperCase() : undefined;
  try {
    const updated = await prisma.vehicle.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        plateNumber: plateNumber ?? undefined,
        makeModel: body.makeModel ?? undefined,
        year: body.year ? Number(body.year) : undefined,
        vin: body.vin ?? undefined,
        engine: body.engine ?? undefined,
        color: body.color ?? undefined,
        purchasedAt: body.purchasedAt ? new Date(body.purchasedAt) : undefined,
        purchasedOdometerKm: body.purchasedOdometerKm ? Number(body.purchasedOdometerKm) : undefined,
        currentOdometerKm: body.currentOdometerKm ? Number(body.currentOdometerKm) : undefined,
        notes: body.notes ?? undefined,
        isActive: body.isActive ?? undefined,
        sortOrder: body.sortOrder ?? undefined,
      },
    });
    return updated;
  } catch (err: any) {
    req.log.error({ err, id }, "vehicle update error");
    return handlePrismaError(err, reply);
  }
});

app.delete("/api/vehicles/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id as string | undefined;
  if (!id) return reply.code(400).send({ error: "id is required" });
  await prisma.vehicle.delete({ where: { id } });
  return reply.code(204).send();
});

app.get("/api/receipts", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const limit = Math.max(1, Math.min(200, Number(q.limit ?? 50) || 50));
  const receipts = await prisma.receipt.findMany({
    take: limit,
    orderBy: { receiptAt: "desc" },
    include: {
      driver: { select: { id: true, fullName: true, telegramUserId: true } },
      vehicle: { select: { id: true, name: true, plateNumber: true } },
    },
  });

  const derived = computeDerived(receipts);

  return receipts.map((r) => {
    const d = derived.get(r.id);
    return { ...r, derivedDeltaKm: d?.deltaKm ?? null, derivedLPer100: d?.lPer100 ?? null };
  });
});

app.get("/api/receipts/:id/file", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id as string | undefined;
  const type = ((req.query as any)?.type as string | undefined) ?? "image";
  if (!id) return reply.code(400).send({ error: "id is required" });
  const receipt = await prisma.receipt.findUnique({ where: { id } });
  if (!receipt) return reply.code(404).send({ error: "not found" });
  const targetPath = type === "pdf" ? receipt.pdfPath : receipt.imagePath;
  if (!targetPath) return reply.code(404).send({ error: "file not found" });
  
  // Handle both absolute and relative paths
  let abs: string;
  if (path.isAbsolute(targetPath)) {
    abs = targetPath;
  } else {
    // Try relative to current working directory first
    abs = path.join(process.cwd(), targetPath);
    // If not found, try relative to /app/data/telegram
    if (!fs.existsSync(abs) && targetPath.includes("telegram")) {
      const altPath = path.join("/app/data/telegram", path.basename(targetPath));
      if (fs.existsSync(altPath)) {
        abs = altPath;
      }
    }
  }
  
  if (!fs.existsSync(abs)) {
    req.log.warn({ targetPath, abs, cwd: process.cwd() }, "File not found for receipt");
    return reply.code(404).send({ error: "file not found", path: targetPath });
  }
  const stream = fs.createReadStream(abs);
  const ext = path.extname(abs).toLowerCase();
  const contentType =
    ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
  reply.type(contentType);
  return reply.send(stream);
});

app.get("/api/reports/summary", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const receipts = await prisma.receipt.findMany({
    where: { status: { in: [ReceiptStatus.DONE, ReceiptStatus.PENDING] } },
  });

  let totalAmount = new Prisma.Decimal(0);
  let totalLiters = new Prisma.Decimal(0);
  let count = 0;
  const lPer100Values: number[] = [];
  let paidByDriverCount = 0;
  let reimbursedCount = 0;
  let selfPaidTotal = new Prisma.Decimal(0);

  for (const r of receipts) {
    count += 1;
    if (r.totalAmount) {
      totalAmount = totalAmount.add(r.totalAmount);
    }
    if (r.liters) {
      totalLiters = totalLiters.add(r.liters);
    }
    if (r.paidByDriver) {
      paidByDriverCount += 1;
      if (r.totalAmount) selfPaidTotal = selfPaidTotal.add(r.totalAmount);
    }
    if (r.reimbursed) {
      reimbursedCount += 1;
    }
    // derive l/100 if possible
    if (r.mileage && r.liters && r.mileage > 0) {
      // crude: cannot compute delta without previous; rely on stored derivedLPer100 if present
      const raw = (r as any).derivedLPer100 ?? null;
      if (raw !== null && raw !== undefined && !Number.isNaN(Number(raw))) {
        lPer100Values.push(Number(raw));
      }
    }
  }

  const avgLPer100 =
    lPer100Values.length > 0
      ? lPer100Values.reduce((a, b) => a + b, 0) / lPer100Values.length
      : null;

  return {
    count,
    totalAmount: totalAmount.toString(),
    totalLiters: totalLiters.toString(),
    avgLPer100,
    paidByDriverCount,
    reimbursedCount,
    selfPaidTotal: selfPaidTotal.toString(),
  };
});

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

app.get("/api/reports/export", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const receipts = await prisma.receipt.findMany({
    orderBy: { receiptAt: "desc" },
    include: {
      driver: true,
      vehicle: true,
    },
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
      new Date(r.receiptAt).toISOString(),
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

app.get("/api/reports/compensations/export", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const filters = buildCompensationFilters(req.query);
  const receipts = await prisma.receipt.findMany({
    where: filters.where,
    orderBy: { receiptAt: "desc" },
    include: { driver: true, vehicle: true },
  });
  const header = [
    "id",
    "date",
    "driver",
    "vehicle",
    "totalAmount",
    "paymentComment",
    "reimbursed",
  ];
  const rows = receipts.map((r) =>
    [
      r.id,
      new Date(r.receiptAt).toISOString(),
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
      date: new Date(r.receiptAt).toISOString(),
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

app.get("/api/reports/export.xlsx", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const receipts = await prisma.receipt.findMany({
    orderBy: { receiptAt: "desc" },
    include: {
      driver: true,
      vehicle: true,
    },
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
      date: new Date(r.receiptAt).toISOString(),
      driver: r.driver?.fullName || r.driver?.telegramUserId || "",
      vehicle: r.vehicle?.plateNumber || r.vehicle?.name || "",
      status: r.status,
      paymentMethod: r.paymentMethod || "",
      paidByDriver: r.paidByDriver ? "Да" : "",
      reimbursed: r.reimbursed ? "Да" : "",
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

app.get("/api/compensations", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const limit = Math.max(1, Math.min(500, Number(q.limit ?? 100) || 100));
  const offset = Math.max(0, Number(q.offset ?? 0) || 0);
  const filters = buildCompensationFilters(q);

  const [items, total] = await Promise.all([
    prisma.receipt.findMany({
      where: filters.where,
      orderBy: { receiptAt: "desc" },
      include: {
        driver: { select: { id: true, fullName: true, telegramUserId: true } },
        vehicle: { select: { id: true, name: true, plateNumber: true } },
      },
      skip: offset,
      take: limit,
    }),
    prisma.receipt.count({ where: filters.where }),
  ]);

  return { items, total };
});

function toDecimal(v: any): Prisma.Decimal | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return new Prisma.Decimal(n.toString());
}

app.patch("/api/receipts/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id as string | undefined;
  if (!id) return reply.code(400).send({ error: "id is required" });
  const body = (req.body ?? {}) as any;

  const data: any = {};
  if (body.status && Object.values(ReceiptStatus).includes(body.status as ReceiptStatus)) {
    data.status = body.status as ReceiptStatus;
  }
  if (body.paymentMethod && Object.values(PaymentMethod).includes(body.paymentMethod as PaymentMethod)) {
    data.paymentMethod = body.paymentMethod as PaymentMethod;
  }
  if (body.fuelType && Object.values(FuelType).includes(body.fuelType as FuelType)) {
    data.fuelType = body.fuelType as FuelType;
  }
  if (body.dataSource && Object.values(DataSource).includes(body.dataSource as DataSource)) {
    data.dataSource = body.dataSource as DataSource;
  }
  if (body.mileage !== undefined) data.mileage = Number.isNaN(Number(body.mileage)) ? null : Number(body.mileage);
  if (body.totalAmount !== undefined) data.totalAmount = toDecimal(body.totalAmount) ?? undefined;
  if (typeof body.paidByDriver === "boolean") data.paidByDriver = body.paidByDriver;
  if (typeof body.reimbursed === "boolean") data.reimbursed = body.reimbursed;
  if (typeof body.paymentComment === "string") data.paymentComment = body.paymentComment;

  if (Object.keys(data).length === 0) {
    return reply.code(400).send({ error: "no updatable fields provided" });
  }

  try {
    const updated = await prisma.receipt.update({ where: { id }, data });
    if (updated.mileage !== null) {
      await refreshVehicleOdometer(prisma, updated.vehicleId);
    }
    return updated;
  } catch (err: any) {
    return reply.code(400).send({ error: err?.message ?? "update failed" });
  }
});

app.delete("/api/receipts/:id", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const id = (req.params as any)?.id as string | undefined;
  if (!id) return reply.code(400).send({ error: "id is required" });
  try {
    await prisma.receipt.delete({ where: { id } });
    return reply.code(204).send();
  } catch (err: any) {
    return reply.code(400).send({ error: err?.message ?? "delete failed" });
  }
});

app.post("/api/receipts/mark-reimbursed", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const body = (req.body ?? {}) as any;
  const ids = Array.isArray(body.ids) ? (body.ids as any[]).filter((x: any) => typeof x === "string") : [];
  if (!ids.length) return reply.code(400).send({ error: "ids required" });
  const result = await prisma.receipt.updateMany({
    where: { id: { in: ids } },
    data: { reimbursed: true },
  });
  return { updated: result.count };
});

app.get("/api/receipt-items", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const limit = Math.max(1, Math.min(500, Number(q.limit ?? 200) || 200));
  return prisma.receiptItem.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
  });
});

app.post("/api/receipts", async (req, reply) => {
  const apiKey = process.env.RECEIPTS_API_KEY;
  if (apiKey && req.headers["x-api-key"] !== apiKey) {
    // allow JWT as alternative
    const ok = await requireAuth(req, reply);
    if (!ok) return;
  } else if (!apiKey) {
    // no API key configured: protect by auth
    const ok = await requireAuth(req, reply);
    if (!ok) return;
  }

  const body = req.body as CreateReceiptDto;

  if (!body?.driver?.telegramUserId) {
    return reply.code(400).send({ error: "driver.telegramUserId is required" });
  }
  if (!body?.receipt?.stationName) {
    return reply.code(400).send({ error: "receipt.stationName is required" });
  }
  if (!Array.isArray(body?.items) || body.items.length === 0) {
    return reply.code(400).send({ error: "items[] is required and must be non-empty" });
  }

  const result = await createReceiptFromDto(prisma, body);
  return reply.code(201).send(result);
});

// Late delays routes
app.get("/api/late-delays", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const dateFrom = q.dateFrom ? new Date(q.dateFrom) : null;
  const dateTo = q.dateTo ? new Date(q.dateTo) : null;
  const driverName = q.driverName ? String(q.driverName).trim() : null;
  
  const where: any = {};
  if (dateFrom || dateTo) {
    where.delayDate = {};
    if (dateFrom) where.delayDate.gte = dateFrom;
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      where.delayDate.lte = endDate;
    }
  }
  if (driverName) {
    where.driverName = { contains: driverName, mode: "insensitive" };
  }
  
  const items = await prisma.lateDelay.findMany({
    where,
    orderBy: { delayDate: "desc" },
    take: 1000,
  });
  
  return { items };
});

app.get("/api/late-delays/summary", async (req, reply) => {
  if (!(await requireAuth(req, reply))) return;
  const q = (req.query ?? {}) as any;
  const dateFrom = q.dateFrom ? new Date(q.dateFrom) : null;
  const dateTo = q.dateTo ? new Date(q.dateTo) : null;
  
  const where: any = {};
  if (dateFrom || dateTo) {
    where.delayDate = {};
    if (dateFrom) where.delayDate.gte = dateFrom;
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      where.delayDate.lte = endDate;
    }
  }
  
  const allDelays = await prisma.lateDelay.findMany({ where });
  
  const summaryMap = new Map<string, { driverName: string; red: number; yellow: number; green: number }>();
  
  for (const delay of allDelays) {
    const key = delay.driverName;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, { driverName: key, red: 0, yellow: 0, green: 0 });
    }
    const stats = summaryMap.get(key)!;
    if (delay.delayMinutes >= 21) {
      stats.red++;
    } else if (delay.delayMinutes >= 11) {
      stats.yellow++;
    } else {
      stats.green++;
    }
  }
  
  const summary = Array.from(summaryMap.values()).sort((a, b) => 
    (b.red + b.yellow + b.green) - (a.red + a.yellow + a.green)
  );
  
  return { summary };
});

// Telegram routes
registerTelegramRoutes(app, prisma);
registerRepairRoutes(app, prisma, requireAuth);

const port = Number(process.env.BACKEND_PORT ?? 3000);

async function main() {
  try {
    await app.listen({ host: "0.0.0.0", port });
    // start lightweight worker for PENDING receipts
    startPendingWorker(prisma);
    startRepairBot(prisma);
    startMaintenanceCron(prisma);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

main();
