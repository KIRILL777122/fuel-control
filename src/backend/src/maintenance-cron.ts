import { PrismaClient } from "@prisma/client";
import { sendRepairMessage } from "./repair-telegram-client.js";

const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

function formatKm(value: number) {
  return `${value} км`;
}

function formatDays(value: number) {
  return `${value} дн.`;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startMaintenanceCron(prisma: PrismaClient) {
  if (!adminChatId) return;
  let lastRunDate: Date | null = null;

  const run = async () => {
    const now = new Date();
    if (lastRunDate && isSameDay(lastRunDate, now)) return;
    if (now.getHours() !== 9) return;
    lastRunDate = now;

    const items = await prisma.maintenanceItem.findMany({
      where: { isActive: true },
      include: { vehicle: true },
    });

    const messages: string[] = [];

    for (const item of items) {
      const lastNotifiedAt = item.lastNotifiedAt;
      if (lastNotifiedAt && isSameDay(lastNotifiedAt, now)) {
        continue;
      }

      const currentOdometer = item.vehicle.currentOdometerKm ?? item.lastDoneOdometerKm ?? 0;
      const lines: string[] = [];

      if (item.intervalKm && item.lastDoneOdometerKm !== null) {
        const dueAt = item.lastDoneOdometerKm + item.intervalKm;
        const remaining = dueAt - currentOdometer;
        if (remaining <= 0) {
          lines.push(`Просрочено по пробегу на ${formatKm(Math.abs(remaining))}`);
        } else if (remaining <= item.notifyBeforeKm) {
          lines.push(`Скоро по пробегу: осталось ${formatKm(remaining)}`);
        }
      }

      if (item.intervalDays && item.lastDoneAt) {
        const dueAt = new Date(item.lastDoneAt);
        dueAt.setDate(dueAt.getDate() + item.intervalDays);
        const diffDays = Math.ceil((dueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) {
          lines.push(`Просрочено по дате на ${formatDays(Math.abs(diffDays))}`);
        } else if (diffDays <= item.notifyBeforeDays) {
          lines.push(`Скоро по дате: осталось ${formatDays(diffDays)}`);
        }
      }

      if (lines.length) {
        messages.push(`• ${item.vehicle.plateNumber} — ${item.name}\n${lines.join("\n")}`);
        await prisma.maintenanceItem.update({
          where: { id: item.id },
          data: { lastNotifiedAt: now },
        });
      }
    }

    if (messages.length) {
      const text = `🛠 ТО и регламент\n\n${messages.join("\n\n")}`;
      await sendRepairMessage(adminChatId, text);
    }
  };

  setInterval(() => {
    run().catch(() => undefined);
  }, 10 * 60 * 1000);
}

export async function runMaintenanceOnce(prisma: PrismaClient) {
  const now = new Date();
  const items = await prisma.maintenanceItem.findMany({
    where: { isActive: true },
    include: { vehicle: true },
  });

  const messages: string[] = [];

  for (const item of items) {
    const currentOdometer = item.vehicle.currentOdometerKm ?? item.lastDoneOdometerKm ?? 0;
    const lines: string[] = [];

    if (item.intervalKm && item.lastDoneOdometerKm !== null) {
      const dueAt = item.lastDoneOdometerKm + item.intervalKm;
      const remaining = dueAt - currentOdometer;
      if (remaining <= 0) {
        lines.push(`Просрочено по пробегу на ${formatKm(Math.abs(remaining))}`);
      } else if (remaining <= item.notifyBeforeKm) {
        lines.push(`Скоро по пробегу: осталось ${formatKm(remaining)}`);
      }
    }

    if (item.intervalDays && item.lastDoneAt) {
      const dueAt = new Date(item.lastDoneAt);
      dueAt.setDate(dueAt.getDate() + item.intervalDays);
      const diffDays = Math.ceil((dueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) {
        lines.push(`Просрочено по дате на ${formatDays(Math.abs(diffDays))}`);
      } else if (diffDays <= item.notifyBeforeDays) {
        lines.push(`Скоро по дате: осталось ${formatDays(diffDays)}`);
      }
    }

    if (lines.length) {
      messages.push(`• ${item.vehicle.plateNumber} — ${item.name}\n${lines.join("\n")}`);
    }
  }

  if (!messages.length) return "Нет уведомлений";
  const text = `🛠 ТО и регламент\n\n${messages.join("\n\n")}`;
  await sendRepairMessage(adminChatId || "", text);
  return text;
}
