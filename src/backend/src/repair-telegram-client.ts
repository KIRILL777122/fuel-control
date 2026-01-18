import { TelegramFileInfo } from "./telegram-types.js";

type TgResponse = {
  ok: boolean;
  description?: string;
  result?: any;
};

const token = process.env.REPAIR_BOT_TOKEN ?? "";
const apiBase = `https://api.telegram.org/bot${token}`;
const fileBase = `https://api.telegram.org/file/bot${token}`;

if (!token) {
  console.warn("REPAIR_BOT_TOKEN not set");
}

async function tgFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    let body: any;
    try {
      body = await res.text();
    } catch {
      body = "<no-body>";
    }
    const err = new Error(`Telegram API error ${res.status}: ${body}`);
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }
  return (await res.json()) as T;
}

export async function sendRepairMessage(chatId: number | string, text: string, replyMarkup?: any): Promise<TgResponse | undefined> {
  if (!token) return;
  return tgFetch<TgResponse>(`${apiBase}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup, parse_mode: "Markdown" }),
  });
}

export async function getRepairFile(fileId: string): Promise<TelegramFileInfo> {
  return tgFetch(`${apiBase}/getFile?file_id=${fileId}`);
}

export async function downloadRepairFile(filePath: string): Promise<Buffer> {
  const res = await fetch(`${fileBase}/${filePath}`);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}
