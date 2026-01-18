import { PrismaClient } from "@prisma/client";
import { runMaintenanceOnce } from "../maintenance-cron.js";

const prisma = new PrismaClient();

async function main() {
  const result = await runMaintenanceOnce(prisma);
  console.log(result);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
