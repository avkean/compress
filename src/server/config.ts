import type { CompressionProfile } from "../shared/types.js";

export const APP_VERSION = "0.1.0";

export const UPLOAD_LIMITS = {
  maxFiles: 80,
  maxFileBytes: 32 * 1024 * 1024,
  maxBatchBytes: 256 * 1024 * 1024,
  maxPixelsPerImage: 32_000_000,
  defaultImageBudgetMs: 20_000,
  hardImageBudgetMs: 60_000
};

export const ZIP_THRESHOLDS = {
  minRelativeSavings: 0.03,
  minAbsoluteSavings: 1024
};

export const DEFAULT_PROFILE: CompressionProfile = "maximum-compatible";

// HEIC input is on by default; we shell out to `heif-convert` from libheif
// to decode (libvips ships without HEVC). If the binary is missing we surface
// a clear error per upload rather than dropping HEIC support silently.
export const HEIC_IMPORT_ENABLED = process.env.HEIC_IMPORT !== "0";

export const SQUOOSH_MOZJPEG_DEFAULTS = {
  quality: 75,
  baseline: false,
  arithmetic: false,
  progressive: true,
  optimize_coding: true,
  smoothing: 0,
  color_space: 3,
  quant_table: 3,
  trellis_multipass: false,
  trellis_opt_zero: false,
  trellis_opt_table: false,
  trellis_loops: 1,
  auto_subsample: true,
  chroma_subsample: 2,
  separate_chroma_quality: false,
  chroma_quality: 75
} as const;
