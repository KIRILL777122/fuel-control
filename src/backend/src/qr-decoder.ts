import fs from "fs";
import path from "path";
import Jimp from "jimp";
import jsQR from "jsqr";

/**
 * Attempts to decode QR code from image at the given path.
 * Supports common formats (jpg, png) via Jimp.
 */
export async function decodeQrFromImage(imagePath?: string | null): Promise<string | null> {
  if (!imagePath) return null;
  const absPath = path.resolve(imagePath);
  const exists = fs.existsSync(absPath);
  if (!exists) return null;

  try {
    const img = await Jimp.read(absPath);
    const { data, width, height } = img.bitmap;
    const code = jsQR(new Uint8ClampedArray(data), width, height);
    return code?.data ?? null;
  } catch (err) {
    console.error("[qr-decode] failed", err);
    return null;
  }
}
