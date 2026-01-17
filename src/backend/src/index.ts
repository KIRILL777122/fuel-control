import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import fs from "fs";
import path from "path";
import Excel from "exceljs";
import { PrismaClient, Prisma, ReceiptStatus, PaymentMethod, FuelType, DataSource } from "@prisma/client";
import { createReceiptFromDto, CreateReceiptDto } from "./receipt-service";
import { registerTelegramRoutes } from "./telegram-router";
import { startPendingWorker } from "./pending-worker";

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
      return;
    }
    const verified = await req.jwtVerify();
    req.user = verified;
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
}

app.get("/", async () => ({ ok: true, service: "fuel-control" }));
app.get("/health", async () => ({ ok: true }));

app.get("/api/drivers", async () =>
  prisma.driver.findMany({
    orderBy: { createdAt: "desc" },
  })
);

app.post("/api/drivers", async (req, reply) => {
  await requireAuth(req, reply);
  const body = (req.body ?? {}) as any;
  const id = body.id as string | undefined;
  const telegramUserId = body.telegramUserId as string | undefined;
  if (!telegramUserId) return reply.code(400).send({ error: "telegramUserId is required" });
  const fullName = body.fullName as string | undefined;
  const isActive = body.isActive as boolean | undefined;

  const payload = {
    telegramUserId,
    fullName: fullName ?? telegramUserId,
    isActive: isActive ?? true,
  };

  const driver = id
    ? await prisma.driver.update({ where: { id }, data: payload })
    : await prisma.driver.create({ data: payload });
  return reply.code(id ? 200 : 201).send(driver);
});

app.get("/api/vehicles", async () =>
  prisma.vehicle.findMany({
    orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
  })
);

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
  await requireAuth(req, reply);
  const body = (req.body ?? {}) as any;
  const id = body.id as string | undefined;
  const name = (body.name as string | undefined) ?? body.plateNumber ?? "Без названия";
  const plateNumber = body.plateNumber as string | null | undefined;
  const sortOrder = body.sortOrder as number | undefined;
  const isActive = body.isActive as boolean | undefined;

  const payload = {
    name,
    plateNumber: plateNumber ?? null,
    sortOrder: sortOrder ?? 0,
    isActive: isActive ?? true,
  };

  const vehicle = id
    ? await prisma.vehicle.update({ where: { id }, data: payload })
    : await prisma.vehicle.create({ data: payload });
  return reply.code(id ? 200 : 201).send(vehicle);
});

app.get("/api/receipts", async (req) => {
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
  await requireAuth(req, reply);
  const id = (req.params as any)?.id as string | undefined;
  const type = ((req.query as any)?.type as string | undefined) ?? "image";
  if (!id) return reply.code(400).send({ error: "id is required" });
  const receipt = await prisma.receipt.findUnique({ where: { id } });
  if (!receipt) return reply.code(404).send({ error: "not found" });
  const targetPath = type === "pdf" ? receipt.pdfPath : receipt.imagePath;
  if (!targetPath) return reply.code(404).send({ error: "file not found" });
  const abs = path.isAbsolute(targetPath) ? targetPath : path.join(process.cwd(), targetPath);
  if (!fs.existsSync(abs)) return reply.code(404).send({ error: "file not found" });
  const stream = fs.createReadStream(abs);
  const ext = path.extname(abs).toLowerCase();
  const contentType =
    ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
  reply.type(contentType);
  return reply.send(stream);
});

app.get("/api/reports/summary", async () => {
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
  await requireAuth(req, reply);
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
  await requireAuth(req, reply);
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
  await requireAuth(req, reply);
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
  await requireAuth(req, reply);
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

app.post("/api/auth/login", async (req, reply) => {
  const body = (req.body ?? {}) as any;
  const login = body.login as string | undefined;
  const password = body.password as string | undefined;
  const expectedLogin = process.env.WEB_ADMIN_LOGIN || process.env.ADMIN_LOGIN;
  const expectedPassword = process.env.WEB_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!expectedLogin || !expectedPassword) {
    return reply.code(500).send({ error: "admin creds not set" });
  }
  if (login !== expectedLogin || password !== expectedPassword) {
    return reply.code(401).send({ error: "invalid credentials" });
  }
  const token = app.jwt.sign({ sub: login, role: "admin" }, { expiresIn: "4h" });
  reply.setCookie("fuel_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    domain: cookieDomain,
    maxAge: 4 * 60 * 60,
  });
  return { token };
});

app.get("/api/auth/me", async (req, reply) => {
  await requireAuth(req, reply);
  return { ok: true, user: req.user ?? { role: "admin" } };
});

app.post("/api/auth/logout", async (_req, reply) => {
  reply.clearCookie("fuel_token", {
    path: "/",
    domain: cookieDomain,
    secure: secureCookie,
    sameSite: "lax",
  });
  return { ok: true };
});

app.get("/api/compensations", async (req, reply) => {
  await requireAuth(req, reply);
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
  await requireAuth(req, reply);
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
    return updated;
  } catch (err: any) {
    return reply.code(400).send({ error: err?.message ?? "update failed" });
  }
});

app.delete("/api/receipts/:id", async (req, reply) => {
  await requireAuth(req, reply);
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
  await requireAuth(req, reply);
  const body = (req.body ?? {}) as any;
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : [];
  if (!ids.length) return reply.code(400).send({ error: "ids required" });
  const result = await prisma.receipt.updateMany({
    where: { id: { in: ids } },
    data: { reimbursed: true },
  });
  return { updated: result.count };
});

app.get("/api/receipt-items", async (req) => {
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
    try {
      await requireAuth(req, reply);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
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

// Telegram routes
registerTelegramRoutes(app, prisma);

const port = Number(process.env.BACKEND_PORT ?? 3000);

async function main() {
  try {
    await app.listen({ host: "0.0.0.0", port });
    // start lightweight worker for PENDING receipts
    startPendingWorker(prisma);
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
