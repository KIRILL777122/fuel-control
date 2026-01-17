import { PrismaClient, Prisma, ReceiptStatus } from "@prisma/client";
import { decodeQrFromImage } from "./qr-decoder";
import { recognizeByQr } from "./receipt-recognition";

const INTERVAL_MS = Number(process.env.PENDING_WORKER_INTERVAL_MS ?? 15000);
const BATCH_SIZE = Number(process.env.PENDING_WORKER_BATCH ?? 2);
const MAX_ATTEMPTS = Number(process.env.PENDING_WORKER_MAX_ATTEMPTS ?? 3);
const PROVIDER_TIMEOUT_MS = Number(process.env.PENDING_WORKER_TIMEOUT_MS ?? 15000);

async function recognizeWithTimeout(qrRaw: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await recognizeByQr(qrRaw, { signal: controller.signal as any });
  } finally {
    clearTimeout(timer);
  }
}

export function startPendingWorker(prisma: PrismaClient) {
  async function tick() {
    try {
      const pending = await prisma.receipt.findMany({
        where: { status: ReceiptStatus.PENDING },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
      });

      for (const r of pending) {
        let qrRaw = (r.raw as any)?.qrRaw || r.qrRaw;
        const attempts = Number((r.raw as any)?.workerAttempts ?? 0);

        // попытка декодировать из изображения, если qrRaw отсутствует
        if (!qrRaw && r.imagePath) {
          qrRaw = await decodeQrFromImage(r.imagePath);
          if (qrRaw) {
            await prisma.receipt.update({
              where: { id: r.id },
              data: { qrRaw, raw: { ...(r.raw as any), workerNote: "qr decoded from image", workerAttempts: attempts } },
            });
          }
        }

        if (!qrRaw) {
          await prisma.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.FAILED,
              raw: { ...(r.raw as any), workerNote: "no qrRaw after decode, mark FAILED", workerAttempts: attempts + 1 },
            },
          });
          continue;
        }

        if (attempts >= MAX_ATTEMPTS) {
          await prisma.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.FAILED,
              raw: { ...(r.raw as any), workerNote: `max attempts ${MAX_ATTEMPTS} reached`, workerAttempts: attempts },
            },
          });
          continue;
        }

        const provider = await recognizeWithTimeout(qrRaw);
        if (!provider.ok) {
          await prisma.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.PENDING,
              raw: {
                ...(r.raw as any),
                workerNote: provider.note || "provider failed",
                providerResponse: provider.raw,
                workerAttempts: attempts + 1,
              },
            },
          });
          continue;
        }

        const totalAmount =
          provider.totalAmount !== undefined
            ? new Prisma.Decimal(provider.totalAmount.toString())
            : r.totalAmount;
        const receiptAt = provider.receiptAt ?? r.receiptAt ?? new Date();
        const stationName = provider.stationName ?? r.stationName;

        await prisma.$transaction(async (tx) => {
          await tx.receipt.update({
            where: { id: r.id },
            data: {
              status: ReceiptStatus.DONE,
              receiptAt,
              totalAmount,
              stationName,
              qrRaw,
              raw: { ...(r.raw as any), provider: provider.raw, workerNote: provider.note ?? "provider ok", workerAttempts: attempts + 1 },
            },
          });

          if (provider.items && provider.items.length > 0) {
            await tx.receiptItem.deleteMany({ where: { receiptId: r.id } });
            const itemsData = provider.items.map((it: any) => ({
              receiptId: r.id,
              name: it.name || it.description || "item",
              quantity:
                it.quantity !== undefined && it.quantity !== null
                  ? new Prisma.Decimal(it.quantity.toString())
                  : null,
              unitPrice:
                it.price !== undefined && it.price !== null
                  ? new Prisma.Decimal(it.price.toString())
                  : it.unitPrice !== undefined && it.unitPrice !== null
                    ? new Prisma.Decimal(it.unitPrice.toString())
                    : null,
              amount:
                it.sum !== undefined && it.sum !== null
                  ? new Prisma.Decimal(it.sum.toString())
                  : it.amount !== undefined && it.amount !== null
                    ? new Prisma.Decimal(it.amount.toString())
                    : null,
              isFuel: false,
              createdAt: new Date(),
            }));
            if (itemsData.length > 0) {
              await tx.receiptItem.createMany({ data: itemsData });
            }
          }
        });
      }
    } catch (e) {
      console.error("[worker] error", e);
    } finally {
      setTimeout(tick, INTERVAL_MS);
    }
  }

  setTimeout(tick, INTERVAL_MS);
}
