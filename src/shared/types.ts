export type CompressionProfile =
  | "maximum-compatible"
  | "widely-supported"
  | "smallest-modern"
  | "lossless-screenshots";

export type FileStatus = "compressed" | "kept-original" | "passed-through" | "error";

export type ImageClass = "alpha" | "animation" | "ui-text" | "photo" | "unknown";

export interface ManifestEntry {
  originalName: string;
  outputName: string;
  status: FileStatus;
  selectedProfile: CompressionProfile;
  inputFormat: string;
  outputFormat: string;
  inputBytes: number;
  outputBytes: number;
  byteDelta: number;
  byteDeltaPercent: number;
  width?: number;
  height?: number;
  imageClass: ImageClass;
  reason: string;
  warnings: string[];
  colorConversion: string;
  metadataStripped: boolean;
  candidates?: CandidateSummary[];
}

export interface CandidateSummary {
  name: string;
  format: string;
  bytes: number;
  passed: boolean;
  reason: string;
  metrics?: QualitySummary;
}

export interface QualitySummary {
  mse: number;
  p99LumaError: number;
  maxLumaError: number;
  edgeMeanLumaError: number;
  edgeChromaBleed: number;
  edgeDensity: number;
}

export interface JobManifest {
  generatedAt: string;
  appVersion: string;
  selectedProfile: CompressionProfile;
  totals: {
    files: number;
    inputBytes: number;
    outputBytes: number;
    byteDelta: number;
    byteDeltaPercent: number;
    compressed: number;
    keptOriginal: number;
    passedThrough: number;
    errors: number;
  };
  codecInventory: Record<string, string | boolean | null>;
  entries: ManifestEntry[];
  warnings: string[];
}
