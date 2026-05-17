import { ZIP_THRESHOLDS } from "../config.js";
import type { JobManifest } from "../../shared/types.js";

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ZipPayload {
  name: string;
  data: Buffer | string;
}

export interface CompressionResult {
  manifest: JobManifest;
  files: ZipPayload[];
}

export function byteDeltaPercent(inputBytes: number, outputBytes: number): number {
  return inputBytes ? ((inputBytes - outputBytes) / inputBytes) * 100 : 0;
}

export function materialSavings(referenceBytes: number, candidateBytes: number): boolean {
  const absolute = referenceBytes - candidateBytes;
  return (
    absolute >= ZIP_THRESHOLDS.minAbsoluteSavings &&
    absolute / Math.max(referenceBytes, 1) >= ZIP_THRESHOLDS.minRelativeSavings
  );
}
