import os from "node:os";
import sharp from "sharp";
import { APP_VERSION, HEIC_IMPORT_ENABLED } from "./config.js";
import { heifConvertPath, heifEncPath } from "./pipeline/heic.js";

export interface EnvironmentMetadata {
  app: { name: string; version: string };
  node: string;
  platform: string;
  arch: string;
  release: string;
  cpus: number;
  totalMemoryBytes: number;
  capturedAt: string;
}

export function environmentMetadata(): EnvironmentMetadata {
  return {
    app: { name: "compress", version: APP_VERSION },
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    capturedAt: new Date().toISOString()
  };
}

// Operator-facing snapshot returned from /api/inventory. Surfaces the codec
// versions sharp/libvips were built against, libheif tool availability, and
// the HEIC import toggle so health checks can confirm what's actually live.
export async function codecInventory(): Promise<Record<string, unknown>> {
  const [heifConvert, heifEnc] = await Promise.all([heifConvertPath(), heifEncPath()]);
  return {
    environment: environmentMetadata(),
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
    lcms: sharp.versions.lcms ?? null,
    mozjpegNative: sharp.versions.mozjpeg ?? null,
    webp: sharp.versions.webp ?? null,
    aom: sharp.versions.aom ?? null,
    heif: sharp.versions.heif ?? null,
    sharpFormats: {
      jpeg: !!sharp.format.jpeg?.output?.buffer,
      png: !!sharp.format.png?.output?.buffer,
      webp: !!sharp.format.webp?.output?.buffer,
      avif: !!sharp.format.avif?.output?.buffer || !!sharp.format.heif?.output?.alias?.includes("avif"),
      heifInput: !!sharp.format.heif?.input?.buffer
    },
    heicImportEnabled: HEIC_IMPORT_ENABLED,
    heifConvertAvailable: heifConvert !== null,
    heifEncAvailable: heifEnc !== null
  };
}
