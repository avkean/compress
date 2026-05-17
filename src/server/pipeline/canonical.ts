import type sharp from "sharp";
import { sanitizeExtension } from "../sanitize.js";

export const STATIC_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
  ".avif",
  ".heic",
  ".heif",
  ".jxl"
]);

export const ANIMATED_EXTENSIONS = new Set([".gif"]);
export const HEIC_EXTENSIONS = new Set([".heic", ".heif"]);

export function isLikelyAnimated(metadata: sharp.Metadata, ext: string): boolean {
  return ANIMATED_EXTENSIONS.has(ext) || Boolean(metadata.pages && metadata.pages > 1);
}

export function formatFromExtOrMime(originalName: string, mime: string, detected?: string): string {
  if (detected) return detected;
  const ext = sanitizeExtension(originalName).replace(".", "");
  if (ext) return ext;
  return mime.split("/").at(-1) || "unknown";
}

export function asArrayBuffer(buffer: Buffer): ArrayBuffer {
  return new Uint8Array(buffer).buffer;
}
