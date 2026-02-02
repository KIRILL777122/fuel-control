import fs from "fs";
import path from "path";

type ProviderResult = {
  ok: boolean;
  totalAmount?: number;
  receiptAt?: Date | null;
  items?: any[];
  stationName?: string | null;
  addressShort?: string | null;
  fuelType?: string | null;
  fuelGroup?: string | null;
  liters?: number | null;
  pricePerLiter?: number | null;
  pdfUrl?: string | null;
  raw?: any;
  note?: string;
};

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), "data", "logs");
try {
  fs.mkdirSync(logsDir, { recursive: true });
} catch (e) {
  // Directory might already exist
}

const logFile = path.join(logsDir, "receipts_proverkacheka.log");

function safeLog(level: string, requestId: string, data: any) {
  const timestamp = new Date().toISOString();
  const tokenLen = data.tokenLen || 0;
  const tokenLast4 = data.tokenLast4 || "N/A";
  const qrRawPreview = data.qrRawPreview || "";
  const code = data.code !== undefined ? data.code : "N/A";
  const message = data.message || "";
  
  const logLine = `${timestamp} [${level}] [${requestId}] type=${data.type} tokenLen=${tokenLen} tokenLast4=${tokenLast4} qrRawPreview="${qrRawPreview}" code=${code} message="${message}"\n`;
  
  try {
    fs.appendFileSync(logFile, logLine, "utf8");
  } catch (e) {
    console.error(`[receipt-recognition] Failed to write to log file: ${e}`);
  }
}

function normalizeTotal(total: any): number | undefined {
  if (total === null || total === undefined) return undefined;
  if (typeof total === "string" && total.trim() === "") return undefined;
  const num = typeof total === "number" ? total : Number(total);
  if (Number.isNaN(num)) return undefined;
  // API может возвращать копейки — считаем, что значения > 10000 могут быть в копейках
  if (num > 1000) return Math.round(num) / 100;
  return num;
}

function detectFuelType(name: string): { type: string | null; group: string | null } {
  const lower = name.toLowerCase();
  if (lower.includes("92") || lower.includes("аи-92") || lower.includes("ai-92")) {
    return { type: "AI92", group: "BENZIN" };
  }
  if (lower.includes("95") || lower.includes("аи-95") || lower.includes("ai-95")) {
    return { type: "AI95", group: "BENZIN" };
  }
  if (lower.includes("дт") || lower.includes("дизель") || lower.includes("diesel")) {
    return { type: "DIESEL", group: "DIESEL" };
  }
  if (lower.includes("газ") || lower.includes("lpg") || lower.includes("cng")) {
    return { type: "GAS", group: "GAS" };
  }
  return { type: null, group: null };
}

function extractReceipt(payload: any): ProviderResult {
  // proverkacheka API returns data in payload.data.json structure
  const dataJson = payload?.data?.json ?? payload?.json ?? null;
  const receipt =
    payload?.ticket?.document?.receipt ??
    payload?.data?.ticket?.document?.receipt ??
    dataJson ??  // Try data.json first
    payload?.receipt ??
    payload?.data?.receipt ??
    payload?.check ??
    payload?.data ??
    payload;

  // Extract totalSum from data.json (in kopecks) or receipt
  const totalAmount =
    normalizeTotal(dataJson?.totalSum) ??
    normalizeTotal(receipt?.totalSum) ??
    normalizeTotal(receipt?.total_sum) ??
    normalizeTotal(receipt?.total) ??
    normalizeTotal(payload?.total_sum);

  // Extract dateTime from data.json or receipt
  const dateRaw =
    dataJson?.dateTime ??
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

  // Extract items from data.json.items or receipt
  const items = dataJson?.items ?? receipt?.items ?? payload?.items ?? [];
  
  // Extract station name from data.json.user or receipt
  const stationName = 
    dataJson?.user ??
    receipt?.user ?? 
    receipt?.retailPlace ?? 
    receipt?.seller ?? 
    null;
    
  // Extract address from data.json.retailPlaceAddress or receipt
  const addressShort = 
    dataJson?.retailPlaceAddress ??
    receipt?.retailPlaceAddress ?? 
    receipt?.retailPlace ?? 
    receipt?.address ?? 
    null;

  // Extract fuel data from items
  let fuelType: string | null = null;
  let fuelGroup: string | null = null;
  let liters: number | null = null;
  let pricePerLiter: number | null = null;

  for (const item of items) {
    const itemName = (item.name || item.description || "").toLowerCase();
    const fuelDetected = detectFuelType(itemName);
    
    if (fuelDetected.type) {
      fuelType = fuelDetected.type;
      fuelGroup = fuelDetected.group;
      
      // Try to extract liters from quantity (proverkacheka returns quantity as number)
      const qty = item.quantity ?? item.amount ?? null;
      if (qty !== null && qty !== undefined) {
        const qtyNum = typeof qty === "number" ? qty : Number(qty);
        if (!Number.isNaN(qtyNum) && qtyNum > 0) {
          liters = qtyNum;
        }
      }
      
      // Try to extract price per liter (proverkacheka returns price in kopecks)
      const price = item.price ?? item.unitPrice ?? null;
      if (price !== null && price !== undefined) {
        const priceNum = typeof price === "number" ? price : Number(price);
        if (!Number.isNaN(priceNum) && priceNum > 0) {
          // Convert from kopecks to rubles if > 100
          pricePerLiter = priceNum > 100 ? priceNum / 100 : priceNum;
        }
      }
      
      // If we have amount (sum) and quantity, calculate price per liter
      // proverkacheka returns sum in kopecks
      if (!pricePerLiter && liters && liters > 0) {
        const amount = item.sum ?? item.amount ?? null;
        if (amount !== null && amount !== undefined) {
          const amountNum = typeof amount === "number" ? amount : Number(amount);
          if (!Number.isNaN(amountNum) && amountNum > 0) {
            // Convert from kopecks to rubles if > 1000
            const amountRubles = amountNum > 1000 ? amountNum / 100 : amountNum;
            pricePerLiter = amountRubles / liters;
          }
        }
      }
      
      break; // Use first fuel item found
    }
  }

  // Extract PDF URL if available (proverkacheka uses lowercase "pdfurl" in data object)
  const pdfUrl = 
    payload?.data?.pdfurl ??  // proverkacheka format
    payload?.pdfUrl ?? 
    payload?.pdf_url ?? 
    payload?.pdf ?? 
    null;

  return {
    ok: true,
    totalAmount,
    receiptAt,
    items,
    stationName,
    addressShort,
    fuelType,
    fuelGroup,
    liters,
    pricePerLiter,
    pdfUrl,
    raw: payload,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches receipt data from proverkacheka.com by qrRaw.
 * env:
 *  - RECEIPTS_API_KEY (required)
 *  - RECEIPTS_API_URL (optional, defaults to proverkacheka endpoint)
 *
 * Uses POST with form-urlencoded body containing:
 *  - token: RECEIPTS_API_KEY
 *  - qrraw: raw QR string
 */
export async function recognizeByQr(qrRaw: string): Promise<ProviderResult> {
  const token = process.env.RECEIPTS_API_KEY;
  if (!token) {
    return { ok: false, note: "RECEIPTS_API_KEY not set" };
  }

  const baseUrl = process.env.RECEIPTS_API_URL || "https://proverkacheka.com/api/v1/check/get";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const tokenLen = token.length;
  const tokenLast4 = token.length >= 4 ? token.slice(-4) : "N/A";
  const qrRawPreview = qrRaw.length > 20 ? qrRaw.substring(0, 20) + "..." : qrRaw;

  safeLog("INFO", requestId, {
    type: "qrraw",
    tokenLen,
    tokenLast4,
    qrRawPreview,
    url: baseUrl,
  });

  const formData = new URLSearchParams();
  formData.append("token", token);
  formData.append("qrraw", qrRaw);

  const delays = [2000, 5000, 10000];
  const maxRetries = delays.length;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: formData.toString(),
      });

      const text = await res.text().catch(() => "");
      let json: any = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { message: text };
      }

      const code = json?.code;
      const message = json?.data || json?.error || json?.message || text || "";

      safeLog(attempt > 0 ? "RETRY" : "INFO", requestId, {
        type: "qrraw",
        tokenLen,
        tokenLast4,
        qrRawPreview,
        code,
        message: typeof message === "string" ? message.substring(0, 100) : String(message),
        attempt: attempt + 1,
      });

      if (!res.ok && res.status !== 200) {
        const errorMsg = `provider http ${res.status}: ${message}`;
        if (res.status === 401 || res.status === 403 || code === 401 || code === 403 ||
            (typeof message === "string" && message.toLowerCase().includes("не авторизован"))) {
          safeLog("ERROR", requestId, {
            type: "qrraw",
            tokenLen,
            tokenLast4,
            qrRawPreview,
            code: code || res.status,
            message: "Неверный или не передан токен proverkacheka",
          });
          return { ok: false, note: "Неверный или не передан токен proverkacheka", raw: { code, message } };
        }
        return { ok: false, note: errorMsg, raw: json };
      }

      if (code === 1) {
        safeLog("SUCCESS", requestId, {
          type: "qrraw",
          tokenLen,
          tokenLast4,
          qrRawPreview,
          code: 1,
        });
        return extractReceipt(json);
      }

      if (code === 2 || code === 4) {
        if (attempt < maxRetries) {
          const delayMs = delays[attempt];
          safeLog("RETRY", requestId, {
            type: "qrraw",
            tokenLen,
            tokenLast4,
            qrRawPreview,
            code,
            message: `Retrying after ${delayMs}ms`,
            attempt: attempt + 1,
          });
          await delay(delayMs);
          continue;
        }
        return { ok: false, note: `provider timeout: check still pending after ${maxRetries} retries`, raw: json };
      }

      if (code === 401 || code === 403 ||
          (typeof message === "string" && message.toLowerCase().includes("не авторизован"))) {
        return { ok: false, note: "Неверный или не передан токен proverkacheka", raw: json };
      }

      const errorMsg = `provider error code=${code}: ${message}`;
      safeLog("ERROR", requestId, {
        type: "qrraw",
        tokenLen,
        tokenLast4,
        qrRawPreview,
        code,
        message: typeof message === "string" ? message.substring(0, 100) : String(message),
      });
      return { ok: false, note: errorMsg, raw: json };
    } catch (err: any) {
      const errorMsg = (err as Error).message || String(err);
      safeLog("ERROR", requestId, {
        type: "qrraw",
        tokenLen,
        tokenLast4,
        qrRawPreview,
        code: "EXCEPTION",
        message: errorMsg.substring(0, 100),
      });

      if (attempt === maxRetries) {
        return { ok: false, note: `provider error: ${errorMsg}` };
      }
      await delay(delays[attempt] || 2000);
    }
  }

  return { ok: false, note: "provider error: max retries exceeded" };
}

/**
 * Fetches receipt data from proverkacheka.com by qrfile (image).
 */
export async function recognizeByFile(imagePath: string): Promise<ProviderResult> {
  const token = process.env.RECEIPTS_API_KEY;
  if (!token) {
    return { ok: false, note: "RECEIPTS_API_KEY not set" };
  }

  const baseUrl = process.env.RECEIPTS_API_URL || "https://proverkacheka.com/api/v1/check/get";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.promises.readFile(imagePath);
  } catch {
    return { ok: false, note: "failed to read image file" };
  }

  safeLog("INFO", requestId, {
    type: "qrfile",
    tokenLen: token.length,
    tokenLast4: token.length >= 4 ? token.slice(-4) : "N/A",
    qrRawPreview: path.basename(imagePath),
    url: baseUrl,
  });

  const formData = new FormData();
  formData.append("token", token);
  formData.append("qrfile", new Blob([new Uint8Array(fileBuffer)]), path.basename(imagePath));

  const delays = [2000, 5000, 10000];
  const maxRetries = delays.length;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        body: formData,
        headers: { "Accept": "application/json" },
      });

      const text = await res.text().catch(() => "");
      let json: any = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { message: text };
      }

      const code = json?.code;
      const message = json?.data || json?.error || json?.message || text || "";

      safeLog(attempt > 0 ? "RETRY" : "INFO", requestId, {
        type: "qrfile",
        tokenLen: token.length,
        tokenLast4: token.length >= 4 ? token.slice(-4) : "N/A",
        qrRawPreview: path.basename(imagePath),
        code,
        message: typeof message === "string" ? message.substring(0, 100) : String(message),
        attempt: attempt + 1,
      });

      if (!res.ok && res.status !== 200) {
        const errorMsg = `provider http ${res.status}: ${message}`;
        if (res.status === 401 || res.status === 403 || code === 401 || code === 403 ||
            (typeof message === "string" && message.toLowerCase().includes("не авторизован"))) {
          safeLog("ERROR", requestId, {
            type: "qrfile",
            tokenLen: token.length,
            tokenLast4: token.length >= 4 ? token.slice(-4) : "N/A",
            qrRawPreview: path.basename(imagePath),
            code: code || res.status,
            message: "Неверный или не передан токен proverkacheka",
          });
          return { ok: false, note: "Неверный или не передан токен proverkacheka", raw: { code, message } };
        }
        return { ok: false, note: errorMsg, raw: json };
      }

      if (code === 1) {
        safeLog("SUCCESS", requestId, {
          type: "qrfile",
          tokenLen: token.length,
          tokenLast4: token.length >= 4 ? token.slice(-4) : "N/A",
          qrRawPreview: path.basename(imagePath),
          code: 1,
        });
        return extractReceipt(json);
      }

      if (code === 2 || code === 4) {
        if (attempt < maxRetries) {
          const delayMs = delays[attempt];
          safeLog("RETRY", requestId, {
            type: "qrfile",
            tokenLen: token.length,
            tokenLast4: token.length >= 4 ? token.slice(-4) : "N/A",
            qrRawPreview: path.basename(imagePath),
            code,
            message: `Retrying after ${delayMs}ms`,
            attempt: attempt + 1,
          });
          await delay(delayMs);
          continue;
        }
        return { ok: false, note: `provider timeout: check still pending after ${maxRetries} retries`, raw: json };
      }

      if (code === 401 || code === 403 ||
          (typeof message === "string" && message.toLowerCase().includes("не авторизован"))) {
        return { ok: false, note: "Неверный или не передан токен proverkacheka", raw: json };
      }

      return { ok: false, note: "provider failed", raw: json };
    } catch (e: any) {
      if (attempt < maxRetries) {
        await delay(delays[attempt]);
        continue;
      }
      return { ok: false, note: e?.message ?? "provider error" };
    }
  }

  return { ok: false, note: "provider failed" };
}
