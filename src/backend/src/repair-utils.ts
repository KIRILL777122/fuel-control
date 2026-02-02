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
  const [receiptMax] = await Promise.all([
    prisma.receipt.aggregate({
      where: { vehicleId, mileage: { not: null } },
      _max: { mileage: true },
    }),
  ]);

  const receiptValue = receiptMax._max.mileage ?? null;
  if (receiptValue === null) return null;
  return receiptValue;
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
