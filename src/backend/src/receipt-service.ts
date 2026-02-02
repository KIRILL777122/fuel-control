import {
  PrismaClient,
  Prisma,
  ReceiptStatus,
  FuelType,
  FuelGroup,
  PaymentMethod,
  DataSource,
} from "@prisma/client";

export type ReceiptItemInput = {
  name: string;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  amount?: string | number | null;
};

export type ReceiptInput = {
  receiptAt?: string | Date;
  mileage?: number | null;
  stationName: string;
  stationInn?: string | null;
  paymentMethod?: string | null;
  paymentComment?: string | null;
  reimbursed?: boolean;
  paidByDriver?: boolean;
  totalAmount: string | number;
  liters?: string | number | null;
  pricePerLiter?: string | number | null;
  raw?: any;
  status?: ReceiptStatus;
  fuelType?: string | null;
  fuelGroup?: FuelGroup | null;
  hasGoods?: boolean;
  goodsAmount?: string | number | null;
  addressShort?: string | null;
  imagePath?: string | null;
  pdfPath?: string | null;
  qrRaw?: string | null;
  dataSource?: DataSource;
};

export type VehicleInput = {
  plateNumber?: string | null;
  name?: string | null;
};

export type DriverInput = {
  telegramUserId: string;
  fullName?: string;
};

export type CreateReceiptDto = {
  driver: DriverInput;
  vehicle?: VehicleInput;
  receipt: ReceiptInput;
  items: ReceiptItemInput[];
};

function toDecimal(v: string | number | null | undefined): Prisma.Decimal | null {
  if (v === null || v === undefined) return null;
  const num = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(num)) return null;
  return new Prisma.Decimal(num.toString());
}

function mapFuelGroup(ft?: string | null): FuelGroup | null {
  if (!ft) return null;
  const up = ft.toUpperCase();
  if (up === "AI92" || up === "AI95") return FuelGroup.BENZIN;
  if (up === "DIESEL") return FuelGroup.DIESEL;
  if (up === "GAS") return FuelGroup.GAS;
  return FuelGroup.OTHER;
}

function mapPayment(pm?: string | null): PaymentMethod | null {
  if (!pm) return null;
  const up = pm.toUpperCase();
  if (up === "CARD") return PaymentMethod.CARD;
  if (up === "CASH") return PaymentMethod.CASH;
  if (up === "QR") return PaymentMethod.QR;
  if (up === "SELF") return PaymentMethod.SELF;
  return null;
}

export async function createReceiptFromDto(prisma: PrismaClient, dto: CreateReceiptDto) {
  const driverPayload = dto.driver;
  const vehiclePayload = dto.vehicle ?? {};
  const receiptPayload = dto.receipt;
  const itemsPayload = dto.items ?? [];

  // При upsert обновляем fullName только если он передан явно и не пустой
  // Это предотвращает перезапись имени водителя при создании чека
  const updateData: any = {
    isActive: true,
    lastSeenAt: new Date(),
  };
  // Не обновляем имя автоматически, чтобы не затирать ручные правки на сайте.

  const driver = await prisma.driver.upsert({
    where: { telegramUserId: driverPayload.telegramUserId },
    update: updateData,
    create: {
      telegramUserId: driverPayload.telegramUserId,
      fullName: driverPayload.fullName && driverPayload.fullName.trim().length > 0 
        ? driverPayload.fullName.trim() 
        : driverPayload.telegramUserId,
      isActive: true,
      lastSeenAt: new Date(),
    },
  });

  const plate = vehiclePayload.plateNumber ?? null;
  const vname = vehiclePayload.name ?? null;

  const foundVehicle =
    (plate &&
      (await prisma.vehicle.findFirst({
        where: { plateNumber: plate },
      }))) ||
    (vname &&
      (await prisma.vehicle.findFirst({
        where: { name: vname },
      })));

  const vehicle = foundVehicle
    ? await prisma.vehicle.update({
        where: { id: foundVehicle.id },
        data: {
          plateNumber: plate ?? foundVehicle.plateNumber,
          name: vname ?? foundVehicle.name,
          isActive: true,
        },
      })
    : await prisma.vehicle.create({
        data: {
          name: vname ?? plate ?? "Unknown vehicle",
          plateNumber: plate,
          isActive: true,
        },
      });

  // dedup by qrRaw if provided
  const dedupQr = receiptPayload.qrRaw;
  let existing = null;
  if (dedupQr) {
    existing = await prisma.receipt.findFirst({
      where: { qrRaw: dedupQr },
    });
  }

  const receiptData = {
    driver: { connect: { id: driver.id } },
    vehicle: { connect: { id: vehicle.id } },
    receiptAt: receiptPayload.receiptAt ? new Date(receiptPayload.receiptAt) : new Date(),
    mileage: receiptPayload.mileage ?? null,
    stationName: receiptPayload.stationName,
    stationInn: receiptPayload.stationInn ?? null,
    paymentMethod: receiptPayload.paymentMethod ? mapPayment(receiptPayload.paymentMethod) : null,
    paymentComment: receiptPayload.paymentComment ?? null,
    reimbursed: receiptPayload.reimbursed ?? false,
    paidByDriver: receiptPayload.paidByDriver ?? false,
    totalAmount: toDecimal(receiptPayload.totalAmount) ?? new Prisma.Decimal("0"),
    liters: toDecimal(receiptPayload.liters),
    pricePerLiter: toDecimal(receiptPayload.pricePerLiter),
    fuelType: receiptPayload.fuelType
      ? ((receiptPayload.fuelType.toUpperCase() as FuelType) || FuelType.OTHER)
      : null,
    fuelGroup: receiptPayload.fuelGroup ?? mapFuelGroup(receiptPayload.fuelType),
    hasGoods: receiptPayload.hasGoods ?? false,
    goodsAmount: toDecimal(receiptPayload.goodsAmount),
    addressShort: receiptPayload.addressShort ?? null,
    imagePath: receiptPayload.imagePath ?? null,
    pdfPath: receiptPayload.pdfPath ?? null,
    qrRaw: receiptPayload.qrRaw ?? null,
    dataSource: receiptPayload.dataSource ?? DataSource.TELEGRAM,
    raw: receiptPayload.raw ?? { source: "api" },
    status: receiptPayload.status ?? "DONE",
  };

  let receipt;
  if (existing) {
    receipt = await prisma.receipt.update({
      where: { id: existing.id },
      data: receiptData,
    });
    await prisma.receiptItem.deleteMany({ where: { receiptId: existing.id } });
  } else {
    receipt = await prisma.receipt.create({
      data: receiptData,
    });
  }

  if (itemsPayload.length > 0) {
    await prisma.receiptItem.createMany({
      data: itemsPayload.map((it) => ({
        receiptId: receipt.id,
        name: it.name,
        quantity: toDecimal(it.quantity),
        unitPrice: toDecimal(it.unitPrice),
        amount: toDecimal(it.amount),
        isFuel: false,
        createdAt: new Date(),
      })),
    });
  }

  return {
    receipt,
    itemsCount: itemsPayload.length,
    driverId: driver.id,
    vehicleId: vehicle.id,
  };
}
