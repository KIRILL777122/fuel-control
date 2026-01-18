import { PrismaClient } from "@prisma/client";

export const REPAIR_CATEGORIES: Record<string, string> = {
  ENGINE: "Двигатель",
  COOLING: "Охлаждение",
  FUEL: "Топливо",
  ELECTRICAL: "Электрика",
  TRANSMISSION: "Трансмиссия",
  SUSPENSION: "Подвеска",
  BRAKES: "Тормоза",
  STEERING: "Рулевое",
  BODY: "Кузов",
  TIRES: "Шины/колёса",
  OTHER: "Прочее",
};

export async function getLastKnownOdometer(prisma: PrismaClient, vehicleId: string) {
  const [receiptMax, repairMax] = await Promise.all([
    prisma.receipt.aggregate({
      where: { vehicleId, mileage: { not: null } },
      _max: { mileage: true },
    }),
    prisma.repairEvent.aggregate({
      where: { vehicleId },
      _max: { odometerKm: true },
    }),
  ]);

  const receiptValue = receiptMax._max.mileage ?? null;
  const repairValue = repairMax._max.odometerKm ?? null;
  if (receiptValue === null && repairValue === null) return null;
  if (receiptValue === null) return repairValue;
  if (repairValue === null) return receiptValue;
  return Math.max(receiptValue, repairValue);
}

export async function refreshVehicleOdometer(prisma: PrismaClient, vehicleId: string) {
  const lastKnown = await getLastKnownOdometer(prisma, vehicleId);
  if (lastKnown === null) return null;
  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { currentOdometerKm: lastKnown },
  });
  return lastKnown;
}
