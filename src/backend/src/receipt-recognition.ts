type ProviderResult = {
  ok: boolean;
  totalAmount?: number;
  receiptAt?: Date | null;
  items?: any[];
  stationName?: string | null;
  raw?: any;
  note?: string;
};

function normalizeTotal(total: any): number | undefined {
  if (total === null || total === undefined) return undefined;
  if (typeof total === "string" && total.trim() === "") return undefined;
  const num = typeof total === "number" ? total : Number(total);
  if (Number.isNaN(num)) return undefined;
  // API может возвращать копейки — считаем, что значения > 10000 могут быть в копейках
  if (num > 1000) return Math.round(num) / 100;
  return num;
}

function extractReceipt(payload: any): ProviderResult {
  const receipt =
    payload?.ticket?.document?.receipt ??
    payload?.data?.ticket?.document?.receipt ??
    payload?.receipt ??
    payload?.data?.receipt ??
    payload?.check ??
    payload?.data ??
    payload;

  const totalAmount =
    normalizeTotal(receipt?.totalSum) ??
    normalizeTotal(receipt?.total_sum) ??
    normalizeTotal(receipt?.total) ??
    normalizeTotal(payload?.total_sum);

  const dateRaw =
    receipt?.dateTime ??
    receipt?.datetime ??
    receipt?.date ??
    receipt?.time ??
    payload?.created_at ??
    payload?.time;

  let receiptAt: Date | null = null;
  if (dateRaw) {
    const d = new Date(dateRaw);
    if (!Number.isNaN(d.getTime())) receiptAt = d;
  }

  const items = receipt?.items ?? payload?.items ?? [];
  const stationName = receipt?.user ?? receipt?.retailPlace ?? receipt?.seller ?? null;

  return {
    ok: true,
    totalAmount,
    receiptAt,
    items,
    stationName,
    raw: payload,
  };
}

/**
 * Fetches receipt data from proverkacheka.com by qrRaw.
 * env:
 *  - RECEIPTS_API_KEY (required)
 *  - RECEIPTS_API_URL (optional, defaults to proverkacheka endpoint)
 */
export async function recognizeByQr(qrRaw: string): Promise<ProviderResult> {
  const token = process.env.RECEIPTS_API_KEY;
  if (!token) return { ok: false, note: "RECEIPTS_API_KEY not set" };
  const baseUrl = process.env.RECEIPTS_API_URL || "https://proverkacheka.com/api/v1/check/get";
  const url = `${baseUrl}?token=${encodeURIComponent(token)}&qrraw=${encodeURIComponent(qrRaw)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, note: `provider http ${res.status}` };
    }
    const json = await res.json();
    // provider uses status or success flag; accept both
    const status = (json?.status || json?.success || "").toString().toLowerCase();
    if (status && status !== "ok" && status !== "success" && status !== "1" && status !== "true") {
      return { ok: false, note: `provider status=${json?.status ?? json?.success}` , raw: json };
    }
    return extractReceipt(json);
  } catch (err: any) {
    return { ok: false, note: `provider error ${(err as Error).message}` };
  }
}
