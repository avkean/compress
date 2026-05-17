import type sharp from "sharp";
import type { CompressionProfile } from "../../shared/types.js";

export type OutputFormat = "jpg" | "png" | "webp" | "avif" | "heic";

export interface EncodingDecision {
  format: OutputFormat;
  extension: string;
  // Sharp options for the chosen format; the caller passes the right one into
  // `.jpeg() / .png() / .webp() / .avif()`. HEIC goes through libheif's
  // heif-enc tool (sharp can't write HEVC) — see pipeline/heic.ts.
  jpeg?: { quality: number; chromaSubsampling: "4:2:0" | "4:4:4" };
  png?: { compressionLevel: number; palette: boolean; effort: number };
  webp?: { quality: number; lossless: boolean; effort: number; alphaQuality: number };
  avif?: { quality: number; effort: number; chromaSubsampling: "4:4:4" | "4:2:0" };
  heic?: { quality: number; lossless: boolean };
  reason: string;
}

export interface InputProfileSummary {
  // Lower-cased extension or "" if unknown.
  ext: string;
  // The detected/declared mime, e.g. "image/jpeg". Lower-cased.
  mime: string;
  hasAlpha: boolean;
  // Optional, only populated when we actually classified — i.e. when the input
  // wasn't an obvious photo and we needed to decide between text-safe and
  // photo encodings.
  classification?: { uiTextLikely: boolean; sampledColors: number };
}

export interface DecisionPreferences {
  // User opt-in: HEIC sources stay HEIC instead of being re-encoded as JPEG.
  outputHeic?: boolean;
}

const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".heic", ".heif"]);
const PHOTO_MIMES = new Set(["image/jpeg", "image/heic", "image/heif"]);
const HEIC_EXTS = new Set([".heic", ".heif"]);
const HEIC_MIMES = new Set(["image/heic", "image/heif"]);

function isHeicSource(input: InputProfileSummary): boolean {
  return HEIC_EXTS.has(input.ext) || HEIC_MIMES.has(input.mime);
}

function heicDecision(quality: number, reason: string): EncodingDecision {
  return { format: "heic", extension: ".heic", heic: { quality, lossless: false }, reason };
}

// JPEG/HEIC inputs are overwhelmingly camera photos. Treating them as photo
// content without re-classifying matches what Squoosh does (just encode at
// the chosen quality) and avoids the 30ms thumbnail decode entirely.
export function inputIsPhotographic(summary: InputProfileSummary): boolean {
  if (summary.hasAlpha) return false;
  if (PHOTO_EXTS.has(summary.ext)) return true;
  if (PHOTO_MIMES.has(summary.mime)) return true;
  return false;
}

function jpegDecision(quality: number, sub: "4:2:0" | "4:4:4", reason: string): EncodingDecision {
  return { format: "jpg", extension: ".jpg", jpeg: { quality, chromaSubsampling: sub }, reason };
}

function pngDecision(palette: boolean, reason: string): EncodingDecision {
  return {
    format: "png",
    extension: ".png",
    png: { compressionLevel: 9, palette, effort: 7 },
    reason
  };
}

function webpDecision(opts: { quality?: number; lossless: boolean; reason: string }): EncodingDecision {
  return {
    format: "webp",
    extension: ".webp",
    webp: {
      quality: opts.quality ?? 78,
      lossless: opts.lossless,
      effort: opts.lossless ? 3 : 4,
      alphaQuality: 100
    },
    reason: opts.reason
  };
}

function avifDecision(quality: number, reason: string, sub: "4:4:4" | "4:2:0" = "4:2:0"): EncodingDecision {
  return {
    format: "avif",
    extension: ".avif",
    avif: { quality, effort: 3, chromaSubsampling: sub },
    reason
  };
}

export function decideOutput(
  metadata: sharp.Metadata,
  input: InputProfileSummary,
  profile: CompressionProfile,
  prefs: DecisionPreferences = {}
): EncodingDecision {
  const hasAlpha = input.hasAlpha || metadata.hasAlpha === true || metadata.channels === 4;
  const photographic = inputIsPhotographic({ ...input, hasAlpha });

  // Explicit user opt-in for HEIC: only applies when the source is HEIC.
  // We don't transmogrify random JPEGs into HEIC because that wouldn't
  // round-trip metadata (and is rarely what the user wants).
  if (prefs.outputHeic && isHeicSource(input)) {
    return heicDecision(60, "heic_source_kept_as_heic");
  }

  if (profile === "lossless-screenshots") {
    // Force pixel-perfect output. For obvious photos this is huge — flag it
    // in the reason so callers can see why.
    return pngDecision(!photographic, photographic ? "lossless_screenshots_on_photo" : "lossless_screenshots_profile");
  }

  if (hasAlpha) {
    if (profile === "smallest-modern" || profile === "widely-supported") {
      return webpDecision({ lossless: true, reason: "alpha_lossless_webp" });
    }
    return pngDecision(true, "alpha_lossless_png");
  }

  if (photographic) {
    if (profile === "smallest-modern") return avifDecision(50, "photo_avif_q50");
    if (profile === "widely-supported") return webpDecision({ quality: 78, lossless: false, reason: "photo_webp_q78" });
    return jpegDecision(75, "4:2:0", "photo_q75_baseline");
  }

  // Non-photographic input (typically PNG without alpha). Use the
  // classification we computed: text-heavy → 4:4:4 high-quality JPEG;
  // very-low-color content → palette PNG.
  const cls = input.classification;
  if (cls?.sampledColors !== undefined && cls.sampledColors <= 64) {
    return pngDecision(true, "low_color_palette_png");
  }
  if (cls?.uiTextLikely) {
    if (profile === "smallest-modern") return webpDecision({ lossless: true, reason: "ui_text_lossless_webp" });
    return jpegDecision(85, "4:4:4", "ui_text_444_q85");
  }
  // Default for unknown PNG-without-alpha: treat as photo. q78 because PNG
  // sources are often UI-adjacent screenshots that still want a small lift.
  if (profile === "smallest-modern") return avifDecision(50, "png_source_avif_q50");
  if (profile === "widely-supported") return webpDecision({ quality: 80, lossless: false, reason: "png_source_webp_q80" });
  return jpegDecision(78, "4:2:0", "png_source_q78");
}
