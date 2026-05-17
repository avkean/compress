import type { RequestHandler } from "express";
import { createRequire } from "node:module";
import { compressBatch } from "../pipeline/index.js";

interface ZipArchiveInstance {
  on(event: "error", listener: (error: Error) => void): void;
  pipe(destination: NodeJS.WritableStream): void;
  append(source: Buffer | string, data: { name: string }): void;
  finalize(): Promise<void>;
}
type ZipArchiveCtor = new (options: { zlib: { level: number } }) => ZipArchiveInstance;

// `archiver` is a CommonJS module; the named-class API isn't exported via the
// ESM interop layer, so we go through createRequire to pull `ZipArchive`.
const requireFromHere = createRequire(import.meta.url);
const { ZipArchive } = requireFromHere("archiver") as { ZipArchive: ZipArchiveCtor };
import { DEFAULT_PROFILE } from "../config.js";
import type { CompressionProfile } from "../../shared/types.js";
import { contentDisposition, encodeRfc5987, mimeForExtension } from "./filenames.js";

const VALID_PROFILES: CompressionProfile[] = [
  "maximum-compatible",
  "widely-supported",
  "smallest-modern",
  "lossless-screenshots"
];

function parseProfile(value: unknown): CompressionProfile {
  return VALID_PROFILES.includes(value as CompressionProfile) ? (value as CompressionProfile) : DEFAULT_PROFILE;
}

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1" || value === "on";
  return false;
}

export const compressRoute: RequestHandler = async (req, res, next) => {
  try {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (!files.length) {
      res.status(400).json({ error: "Upload at least one image." });
      return;
    }

    const profile = parseProfile(req.body.profile);
    const outputHeic = parseBool(req.body.outputHeic);
    const result = await compressBatch(files, profile, { outputHeic });

    res.setHeader("X-Compressed-Files", String(result.manifest.totals.compressed));
    res.setHeader("X-Kept-Original-Files", String(result.manifest.totals.keptOriginal));
    res.setHeader("X-Error-Files", String(result.manifest.totals.errors));
    res.setHeader("X-Input-Bytes", String(result.manifest.totals.inputBytes));
    res.setHeader("X-Output-Bytes", String(result.manifest.totals.outputBytes));

    if (files.length === 1 && result.manifest.entries.length === 1) {
      const entry = result.manifest.entries[0];
      const payload = result.files.find((file) => file.name === entry.outputName);
      const body = payload && Buffer.isBuffer(payload.data)
        ? payload.data
        : Buffer.from(String(payload?.data ?? ""));
      res.setHeader("Content-Type", mimeForExtension(entry.outputFormat));
      res.setHeader("Content-Length", String(body.length));
      res.setHeader("Content-Disposition", contentDisposition(entry.outputName));
      res.setHeader("X-Output-Filename", encodeRfc5987(entry.outputName));
      res.setHeader("X-Output-Status", entry.status);
      res.setHeader("X-Output-Reason", entry.reason);
      res.setHeader("X-Mode", "single");
      res.status(200).end(body);
      return;
    }

    const archive = new ZipArchive({ zlib: { level: 0 } });
    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="compressed-images.zip"`);
    res.setHeader("X-Output-Filename", "compressed-images.zip");
    res.setHeader("X-Mode", "zip");

    archive.on("error", next);
    archive.pipe(res);
    for (const file of result.files) archive.append(file.data, { name: file.name });
    await archive.finalize();
  } catch (error) {
    next(error);
  }
};
