import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileTypeFromBuffer } from "file-type";
import pLimit from "p-limit";
import sharp from "sharp";
import { APP_VERSION, DEFAULT_PROFILE, HEIC_IMPORT_ENABLED, UPLOAD_LIMITS } from "../config.js";
import { sanitizeExtension, uniqueZipName } from "../sanitize.js";
import type { CompressionProfile, JobManifest, ManifestEntry } from "../../shared/types.js";
import {
  ANIMATED_EXTENSIONS,
  HEIC_EXTENSIONS,
  STATIC_IMAGE_EXTENSIONS,
  asArrayBuffer,
  formatFromExtOrMime,
  isLikelyAnimated
} from "./canonical.js";
import { classifyFromBuffer } from "./classify.js";
import { decideOutput, inputIsPhotographic, type EncodingDecision } from "./decide.js";
import { decodeHeicToPng, heifConvertPath, heifEncPath, HeicToolMissingError } from "./heic.js";
import { executeEncoding } from "./run.js";
import {
  byteDeltaPercent,
  materialSavings,
  type CompressionResult,
  type UploadedFileLike,
  type ZipPayload
} from "./types.js";

export type { CompressionResult, UploadedFileLike, ZipPayload } from "./types.js";

interface OneResult {
  entry: ManifestEntry;
  payloads: ZipPayload[];
}

export interface CompressionOptions {
  outputHeic?: boolean;
}

function errorPayload(
  input: UploadedFileLike,
  profile: CompressionProfile,
  usedNames: Set<string>,
  fields: { inputFormat: string; reason: string; warnings: string[]; message: string }
): OneResult {
  const outputName = uniqueZipName(usedNames, input.originalname, ".error.txt");
  const messageBytes = Buffer.byteLength(fields.message);
  return {
    entry: {
      originalName: input.originalname,
      outputName,
      status: "error",
      selectedProfile: profile,
      inputFormat: fields.inputFormat,
      outputFormat: "txt",
      inputBytes: input.size,
      outputBytes: messageBytes,
      byteDelta: input.size - messageBytes,
      byteDeltaPercent: byteDeltaPercent(input.size, messageBytes),
      imageClass: "unknown",
      reason: fields.reason,
      warnings: fields.warnings,
      colorConversion: "none",
      metadataStripped: false
    },
    payloads: [{ name: outputName, data: fields.message }]
  };
}

function timeoutPayload(input: UploadedFileLike, profile: CompressionProfile, usedNames: Set<string>): OneResult {
  return errorPayload(input, profile, usedNames, {
    inputFormat: "unknown",
    reason: "hard_timeout",
    warnings: ["hard_image_budget_exceeded", "input_not_logged"],
    message: `Processing timed out after ${UPLOAD_LIMITS.hardImageBudgetMs}ms.`
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback()), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function passthroughEntry(
  input: UploadedFileLike,
  profile: CompressionProfile,
  usedNames: Set<string>,
  metadata: sharp.Metadata,
  inputFormat: string,
  detectedExt: string
): OneResult {
  const outputExt = detectedExt || sanitizeExtension(input.originalname) || ".bin";
  const outputName = uniqueZipName(usedNames, input.originalname, outputExt);
  return {
    entry: {
      originalName: input.originalname,
      outputName,
      status: "passed-through",
      selectedProfile: profile,
      inputFormat,
      outputFormat: outputExt.replace(".", "") || inputFormat,
      inputBytes: input.size,
      outputBytes: input.size,
      byteDelta: 0,
      byteDeltaPercent: 0,
      width: metadata.width,
      height: metadata.height,
      imageClass: "animation",
      reason: "animation_or_multipage_passthrough_v1",
      warnings: ["animation_optimization_not_in_v1"],
      colorConversion: "none",
      metadataStripped: false
    },
    payloads: [{ name: outputName, data: input.buffer }]
  };
}

interface EncodingSummary {
  selected: { name: string; extension: string; format: EncodingDecision["format"]; data: Buffer };
  decision: EncodingDecision;
  keptOriginal: boolean;
  reason: string;
}

// Empirical bytes-per-pixel target for our q75 4:2:0 mozjpeg output on real
// photo content. If the input JPEG is already at or below this density it
// almost never benefits from a re-encode — we'd burn ~400ms to discover the
// material-savings gate already keeps the original.
const JPEG_TARGET_BPP = 0.11;

async function decideAndEncode(
  input: UploadedFileLike,
  decodeBuffer: Buffer,
  detectedExt: string,
  profile: CompressionProfile,
  options: CompressionOptions,
  metadata: sharp.Metadata
): Promise<EncodingSummary & {
  metadata: sharp.Metadata;
  classification: { imageClass: string; uiTextLikely: boolean; warnings: string[] };
}> {
  const ext = detectedExt.toLowerCase();
  const mime = input.mimetype.toLowerCase();
  const hasAlpha = Boolean(metadata.hasAlpha) || metadata.channels === 4;

  // Photographic inputs (JPEG/HEIC without alpha) skip the thumbnail
  // classification entirely. Saves ~30ms and prevents real camera photos
  // being misrouted to text-safe high-quality 4:4:4.
  const photographic = inputIsPhotographic({ ext, mime, hasAlpha });
  let imageClass: string = photographic ? "photo" : hasAlpha ? "alpha" : "unknown";
  let uiTextLikely = false;
  let classificationWarnings: string[] = [];
  let sampledColors: number | undefined;
  if (!photographic) {
    const classification = await classifyFromBuffer(decodeBuffer);
    imageClass = classification.imageClass;
    uiTextLikely = classification.uiTextLikely;
    classificationWarnings = classification.warnings;
    sampledColors = classification.stats.sampledColors;
  }

  const decision = decideOutput(
    metadata,
    {
      ext,
      mime,
      hasAlpha,
      classification: photographic ? undefined : { uiTextLikely, sampledColors: sampledColors ?? 0 }
    },
    profile,
    { outputHeic: options.outputHeic === true }
  );

  const sourceExt = sanitizeExtension(input.originalname).toLowerCase();
  const sourceIsAlreadyTargetFormat = sourceExt.replace(".", "") === decision.format;
  const sourceWasJpeg = (sourceExt === ".jpg" || sourceExt === ".jpeg") && decision.format === "jpg";

  // Short-circuit: when a JPEG is already encoded at or below the target
  // bytes-per-pixel we'd produce, the encode is guaranteed not to win the
  // 3% material-savings gate and just burns ~400ms. Return the original
  // before paying that cost.
  const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
  if (sourceWasJpeg && pixels > 0 && input.buffer.length / pixels <= JPEG_TARGET_BPP) {
    return {
      metadata,
      classification: { imageClass, uiTextLikely, warnings: classificationWarnings },
      selected: { name: "original-jpeg", extension: sourceExt, format: decision.format, data: input.buffer },
      decision,
      keptOriginal: true,
      reason: "input_already_below_target_bpp"
    };
  }

  const output = await executeEncoding(decodeBuffer, decision, metadata);

  // Keep the original when the re-encode didn't actually win.
  const canKeepInsteadOfEncoding =
    (sourceIsAlreadyTargetFormat || sourceWasJpeg) && input.buffer.length <= output.length;

  if (canKeepInsteadOfEncoding) {
    return {
      metadata,
      classification: { imageClass, uiTextLikely, warnings: classificationWarnings },
      selected: {
        name: sourceWasJpeg ? "original-jpeg" : "original",
        extension: sourceExt || decision.extension,
        format: decision.format,
        data: input.buffer
      },
      decision,
      keptOriginal: true,
      reason: "original_smaller_than_re_encode"
    };
  }

  if (!materialSavings(input.buffer.length, output.length) && (sourceIsAlreadyTargetFormat || sourceWasJpeg)) {
    return {
      metadata,
      classification: { imageClass, uiTextLikely, warnings: classificationWarnings },
      selected: { name: "original", extension: sourceExt || decision.extension, format: decision.format, data: input.buffer },
      decision,
      keptOriginal: true,
      reason: "no_material_savings_over_original"
    };
  }

  return {
    metadata,
    classification: { imageClass, uiTextLikely, warnings: classificationWarnings },
    selected: {
      name: decision.format === "jpg"
        ? `sharp-mozjpeg-${decision.jpeg!.chromaSubsampling.replace(/:/g, "")}-q${decision.jpeg!.quality}`
        : `${decision.format}-${decision.reason}`,
      extension: decision.extension,
      format: decision.format,
      data: output
    },
    decision,
    keptOriginal: false,
    reason: decision.reason
  };
}

async function processOne(
  input: UploadedFileLike,
  profile: CompressionProfile,
  usedNames: Set<string>,
  options: CompressionOptions
): Promise<OneResult> {
  const started = performance.now();
  const detected = await fileTypeFromBuffer(asArrayBuffer(input.buffer));
  const detectedExt = detected?.ext ? `.${detected.ext}` : sanitizeExtension(input.originalname);
  const inputFormat = formatFromExtOrMime(input.originalname, input.mimetype, detected?.ext);

  if (HEIC_EXTENSIONS.has(detectedExt) && !HEIC_IMPORT_ENABLED) {
    return errorPayload(input, profile, usedNames, {
      inputFormat,
      reason: "heic_import_disabled",
      warnings: ["heic_disabled_by_env"],
      message: "HEIC/HEIF import was disabled via HEIC_IMPORT=0."
    });
  }

  if (!STATIC_IMAGE_EXTENSIONS.has(detectedExt) && !ANIMATED_EXTENSIONS.has(detectedExt)) {
    return errorPayload(input, profile, usedNames, {
      inputFormat,
      reason: "unsupported_format",
      warnings: [],
      message: `Unsupported input format: ${inputFormat}`
    });
  }

  try {
    // HEIC requires libheif's heif-convert; everything else goes straight into sharp.
    let decodeBuffer: Buffer;
    const heicWarnings: string[] = [];
    if (HEIC_EXTENSIONS.has(detectedExt)) {
      try {
        decodeBuffer = await decodeHeicToPng(input.buffer);
        heicWarnings.push("heic_decoded_with_libheif");
      } catch (error) {
        if (error instanceof HeicToolMissingError) {
          return errorPayload(input, profile, usedNames, {
            inputFormat,
            reason: "heic_tool_missing",
            warnings: ["heif_convert_not_installed"],
            message: "Install libheif (e.g. `brew install libheif`) to decode HEIC/HEIF inputs."
          });
        }
        throw error;
      }
    } else {
      decodeBuffer = input.buffer;
    }

    // ONE metadata call per request. With `animated: true` it reports
    // `pages` for multi-frame inputs (so we can passthrough animation) and
    // hasAlpha / channels / orientation for the primary frame — all the
    // downstream paths need. Saves a redundant header read.
    const metadata = await sharp(decodeBuffer, {
      animated: true,
      limitInputPixels: UPLOAD_LIMITS.maxPixelsPerImage
    }).metadata();

    if (!HEIC_EXTENSIONS.has(detectedExt) && isLikelyAnimated(metadata, detectedExt)) {
      return passthroughEntry(input, profile, usedNames, metadata, inputFormat, detectedExt);
    }

    const result = await decideAndEncode(input, decodeBuffer, detectedExt, profile, options, metadata);
    const { selected, decision, keptOriginal, reason, classification } = result;
    const outputName = uniqueZipName(usedNames, input.originalname, selected.extension);
    const outputBytes = selected.data.length;
    const duration = Math.round(performance.now() - started);

    return {
      entry: {
        originalName: input.originalname,
        outputName,
        status: keptOriginal ? "kept-original" : "compressed",
        selectedProfile: profile,
        inputFormat,
        outputFormat: selected.extension.replace(".", ""),
        inputBytes: input.size,
        outputBytes,
        byteDelta: input.size - outputBytes,
        byteDeltaPercent: byteDeltaPercent(input.size, outputBytes),
        width: metadata.width,
        height: metadata.height,
        imageClass: classification.imageClass as ManifestEntry["imageClass"],
        reason,
        warnings: [
          ...classification.warnings,
          ...heicWarnings,
          ...(keptOriginal ? ["original_retained"] : [`decision:${decision.reason}`]),
          metadata.icc ? "icc_present_passed_to_encoder" : "no_icc_profile",
          `processed_ms:${duration}`
        ],
        colorConversion: keptOriginal ? "none" : "single_pipeline_native_libvips",
        metadataStripped: !keptOriginal
      },
      payloads: [{ name: outputName, data: selected.data }]
    };
  } catch (error) {
    if (error instanceof HeicToolMissingError) {
      return errorPayload(input, profile, usedNames, {
        inputFormat,
        reason: "heic_tool_missing",
        warnings: [`${error.message.replace("_not_installed", "")}_not_installed`],
        message: "HEIC output requires libheif's heif-enc (`brew install libheif`)."
      });
    }
    return errorPayload(input, profile, usedNames, {
      inputFormat,
      reason: "processing_error",
      warnings: ["input_not_logged"],
      message: error instanceof Error ? error.message : "Unknown processing error"
    });
  }
}

function buildReadme(manifest: JobManifest): string {
  const savings = manifest.totals.byteDeltaPercent.toFixed(1);
  return [
    "Compatible Image Compressor",
    "",
    `Profile: ${manifest.selectedProfile}`,
    `Files: ${manifest.totals.files}`,
    `Compressed: ${manifest.totals.compressed}`,
    `Kept original: ${manifest.totals.keptOriginal}`,
    `Passed through: ${manifest.totals.passedThrough}`,
    `Errors: ${manifest.totals.errors}`,
    `Total input: ${manifest.totals.inputBytes} bytes`,
    `Total output: ${manifest.totals.outputBytes} bytes`,
    `Savings: ${manifest.totals.byteDelta} bytes (${savings}%)`,
    "",
    "manifest.json contains per-file details, warnings, and the chosen encoding decision."
  ].join("\n");
}

async function buildCodecInventory(): Promise<Record<string, string | boolean | null>> {
  const [heifConvert, heifEnc] = await Promise.all([heifConvertPath(), heifEncPath()]);
  return {
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
    lcms: sharp.versions.lcms ?? null,
    heif: sharp.versions.heif ?? null,
    webp: sharp.versions.webp ?? null,
    aom: sharp.versions.aom ?? null,
    mozjpegNative: sharp.versions.mozjpeg ?? null,
    sharpHeifInput: Boolean(sharp.format.heif?.input?.buffer),
    sharpAvifInput: Boolean(sharp.format.avif?.input?.buffer),
    sharpJxlInput: Boolean(sharp.format.jxl?.input?.buffer),
    heicImportEnabled: HEIC_IMPORT_ENABLED,
    heifConvertAvailable: heifConvert !== null,
    heifEncAvailable: heifEnc !== null
  };
}

function validateBatch(files: UploadedFileLike[]): void {
  if (files.length > UPLOAD_LIMITS.maxFiles) {
    throw new Error(`Too many files. Maximum is ${UPLOAD_LIMITS.maxFiles}.`);
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > UPLOAD_LIMITS.maxBatchBytes) {
    throw new Error(`Batch exceeds ${UPLOAD_LIMITS.maxBatchBytes} byte limit.`);
  }
  for (const file of files) {
    if (file.size > UPLOAD_LIMITS.maxFileBytes) {
      throw new Error(`${file.originalname} exceeds ${UPLOAD_LIMITS.maxFileBytes} byte limit.`);
    }
  }
}

export async function compressBatch(
  files: UploadedFileLike[],
  selectedProfile: CompressionProfile = DEFAULT_PROFILE,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  validateBatch(files);

  const totalInputBytes = files.reduce((sum, file) => sum + file.size, 0);
  const usedNames = new Set<string>();
  // Sharp uses libuv's threadpool, so we can run many in flight; cap so a
  // single big batch can't starve concurrent users.
  const concurrency = Math.max(2, Math.min(8, os.cpus().length));
  const limit = pLimit(concurrency);

  const results = await Promise.all(
    files.map((file) =>
      limit(() =>
        withTimeout(
          processOne(file, selectedProfile, usedNames, options),
          UPLOAD_LIMITS.hardImageBudgetMs,
          () => timeoutPayload(file, selectedProfile, usedNames)
        )
      )
    )
  );

  const entries = results.map((result) => result.entry);
  const imagePayloads = results.flatMap((result) => result.payloads);
  const outputBytes = entries.reduce((sum, entry) => sum + entry.outputBytes, 0);

  const manifest: JobManifest = {
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    selectedProfile,
    totals: {
      files: files.length,
      inputBytes: totalInputBytes,
      outputBytes,
      byteDelta: totalInputBytes - outputBytes,
      byteDeltaPercent: byteDeltaPercent(totalInputBytes, outputBytes),
      compressed: entries.filter((entry) => entry.status === "compressed").length,
      keptOriginal: entries.filter((entry) => entry.status === "kept-original").length,
      passedThrough: entries.filter((entry) => entry.status === "passed-through").length,
      errors: entries.filter((entry) => entry.status === "error").length
    },
    codecInventory: await buildCodecInventory(),
    entries,
    warnings: [
      "Images were uploaded to the server for processing.",
      "Single-pipeline native encoder; release-grade quality gates live in the benchmark harness."
    ]
  };

  const manifestName = uniqueZipName(usedNames, "manifest", ".json");
  const readmeName = uniqueZipName(usedNames, "README", ".txt");
  return {
    manifest,
    files: [
      ...imagePayloads,
      { name: manifestName, data: JSON.stringify(manifest, null, 2) },
      { name: readmeName, data: buildReadme(manifest) }
    ]
  };
}
