import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // prepare base unique identifiers
  const telegramUserId = "1000000001";
  const vehicleName = "Газель 3302 #3";
  const stationName = "АЗС Тестовая";

  const driver = await prisma.driver.upsert({
    where: { telegramUserId },
    update: { fullName: "Тестовый водитель", isActive: true },
    create: {
      telegramUserId,
      fullName: "Тестовый водитель",
      isActive: true,
    },
  });

  const existingVehicle = await prisma.vehicle.findFirst({
    where: { name: vehicleName },
  });
  const vehicle = existingVehicle
    ? await prisma.vehicle.update({
        where: { id: existingVehicle.id },
        data: { isActive: true, plateNumber: "А777АА77" },
      })
    : await prisma.vehicle.create({
        data: {
          name: vehicleName,
          plateNumber: "А777АА77",
          isActive: true,
        },
      });

  // remove previous seed receipts (idempotent)
  await prisma.receipt.deleteMany({
    where: {
      stationName,
      paymentMethod: "CARD",
      driverId: driver.id,
      vehicleId: vehicle.id,
    },
  });

  const receipt = await prisma.receipt.create({
    data: {
      driver: { connect: { id: driver.id } },
      vehicle: { connect: { id: vehicle.id } },
      receiptAt: new Date(),
      mileage: 120000,
      stationName,
      stationInn: "7707083893",
      paymentMethod: "CARD",
      paymentComment: "Тестовый чек",
      reimbursed: false,
      paidByDriver: false,
      fuelType: "AI95",
      fuelGroup: "BENZIN",
      hasGoods: false,
      dataSource: "MANUAL",
      status: "DONE",
      totalAmount: new Prisma.Decimal("2500.50"),
      liters: new Prisma.Decimal("50.000"),
      pricePerLiter: new Prisma.Decimal("50.010"),
      raw: { source: "seed" },
    },
  });

  await prisma.receiptItem.create({
    data: {
      receipt: { connect: { id: receipt.id } },
      name: "ДТ",
      quantity: new Prisma.Decimal("50.000"),
      unitPrice: new Prisma.Decimal("50.010"),
      amount: new Prisma.Decimal("2500.50"),
      isFuel: true,
    },
  });

  const counts = await Promise.all([
    prisma.driver.count(),
    prisma.vehicle.count(),
    prisma.receipt.count(),
    prisma.receiptItem.count(),
  ]);

  console.log({
    drivers: counts[0],
    vehicles: counts[1],
    receipts: counts[2],
    items: counts[3],
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());

