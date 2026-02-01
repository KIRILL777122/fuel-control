import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const shifts = await prisma.shift.findMany();
  console.log(`Found ${shifts.length} shifts.`);
  const driverNames = new Set(shifts.map(s => s.driverName));
  const plateNumbers = new Set(shifts.map(s => s.plateNumber).filter(p => !!p));
  console.log(`Drivers: ${driverNames.size}, Vehicles: ${plateNumbers.size}`);
  for (const name of driverNames) {
    if (!name) continue;
    await prisma.driver.upsert({
      where: { telegramUserId: name },
      update: { fullName: name },
      create: { telegramUserId: name, fullName: name, isActive: true }
    });
  }
  for (const plate of plateNumbers) {
    if (!plate) continue;
    await prisma.vehicle.upsert({
      where: { plateNumber: plate },
      update: { name: plate },
      create: { plateNumber: plate, name: plate, isActive: true }
    });
  }
  console.log("Done.");
}
main().catch(console.error).finally(() => prisma.$disconnect());
