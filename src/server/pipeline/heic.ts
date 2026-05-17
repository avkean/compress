import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let heifEncResolved: string | null | undefined;
let heifConvertResolved: string | null | undefined;

async function resolveBinary(command: string): Promise<string | null> {
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"]) {
    const candidate = path.join(dir, command);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next path
    }
  }
  return null;
}

export async function heifEncPath(): Promise<string | null> {
  if (heifEncResolved === undefined) heifEncResolved = await resolveBinary("heif-enc");
  return heifEncResolved;
}

export async function heifConvertPath(): Promise<string | null> {
  if (heifConvertResolved === undefined) heifConvertResolved = await resolveBinary("heif-convert");
  return heifConvertResolved;
}

export class HeicToolMissingError extends Error {
  constructor(binary: string) {
    super(`${binary}_not_installed`);
    this.name = "HeicToolMissingError";
  }
}

// libvips ships without an HEVC decoder, so HEIC input always goes through
// libheif's `heif-convert`. We render to PNG (lossless) and hand the buffer
// back for sharp to consume.
export async function decodeHeicToPng(input: Buffer): Promise<Buffer> {
  const binary = await heifConvertPath();
  if (!binary) throw new HeicToolMissingError("heif-convert");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "compress-heic-"));
  const source = path.join(dir, "input.heic");
  const output = path.join(dir, "output.png");
  try {
    await fs.writeFile(source, input);
    await execFileAsync(binary, [source, output], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface HeicEncodeOptions {
  quality: number; // 0-100
  lossless?: boolean;
}

// HEIC output goes through libheif's `heif-enc` with the x265 HEVC encoder
// (the default). sharp can write HEIF but only with the AV1 codec compiled
// in, which produces AVIF — not a real `.heic` file. We feed heif-enc a PNG
// because it accepts JPEG/PNG/Y4M/YUV input and PNG is lossless.
export async function encodeHeic(pngInput: Buffer, options: HeicEncodeOptions): Promise<Buffer> {
  const binary = await heifEncPath();
  if (!binary) throw new HeicToolMissingError("heif-enc");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "compress-heic-out-"));
  const sourcePath = path.join(dir, "input.png");
  const outPath = path.join(dir, "output.heic");
  try {
    await fs.writeFile(sourcePath, pngInput);
    const args: string[] = [];
    if (options.lossless) args.push("--lossless");
    else args.push("--quality", String(Math.max(0, Math.min(100, Math.round(options.quality)))));
    args.push("-o", outPath, sourcePath);
    await execFileAsync(binary, args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
