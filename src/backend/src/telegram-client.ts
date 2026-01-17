import { TelegramFileInfo } from "./telegram-types";

const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const apiBase = `https://api.telegram.org/bot${token}`;
const fileBase = `https://api.telegram.org/file/bot${token}`;

if (!token) {
  console.warn("TELEGRAM_BOT_TOKEN not set");
}

async function tgFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`Telegram API error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function sendMessage(chatId: number | string, text: string, replyMarkup?: any) {
  if (!token) return;
  await tgFetch(`${apiBase}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
  });
}

export async function setWebhook(url: string, secretToken?: string) {
  if (!token) return { ok: false };
  return tgFetch(`${apiBase}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken }),
  });
}

// For callback handling (Telegram hits same webhook with callback_query)

export async function getFile(fileId: string): Promise<TelegramFileInfo> {
  return tgFetch(`${apiBase}/getFile?file_id=${fileId}`);
}

export async function downloadFile(filePath: string): Promise<Buffer> {
  const res = await fetch(`${fileBase}/${filePath}`);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}
