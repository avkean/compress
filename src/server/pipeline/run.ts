import sharp from "sharp";
import { UPLOAD_LIMITS } from "../config.js";
import { encodeHeic } from "./heic.js";
import type { EncodingDecision } from "./decide.js";

interface MetaHints {
  hasAlpha?: boolean;
  orientation?: number;
}

// Squoosh-equivalent mozjpeg settings. Both `optimiseScans` and
// `optimiseCoding` default to true when `mozjpeg: true`; we keep them on
// because flipping `optimiseScans` saves ~30% encode time but enlarges the
// output by ~3% — a real "compression quality" regression we won't take.
const JPEG_OPTS = {
  mozjpeg: true,
  progressive: true,
  optimiseCoding: true,
  optimiseScans: true
} as const;

function needsRotate(meta?: MetaHints): boolean {
  const o = meta?.orientation;
  // EXIF orientation 1 (or absent) means upright; libvips skips the op but
  // the call still adds parsing overhead. Cheaper to skip entirely.
  return o !== undefined && o > 1;
}

// One pipeline: sharp decodes → optionally rotates → encodes natively in
// libvips without ever exposing the intermediate RGBA buffer to JS. This is
// the single biggest perf win over a tournament-style candidate runner.
export async function executeEncoding(
  buffer: Buffer,
  decision: EncodingDecision,
  meta?: MetaHints
): Promise<Buffer> {
  if (decision.format === "heic") {
    // sharp can't write HEVC; libheif's heif-enc only ingests image files,
    // so we render to a lossless PNG via sharp and hand the buffer over.
    let png = sharp(buffer, {
      animated: false,
      limitInputPixels: UPLOAD_LIMITS.maxPixelsPerImage
    });
    if (needsRotate(meta)) png = png.rotate();
    const pngBuf = await png.png({ compressionLevel: 0 }).toBuffer();
    return encodeHeic(pngBuf, { quality: decision.heic!.quality, lossless: decision.heic!.lossless });
  }

  let pipeline = sharp(buffer, {
    animated: false,
    limitInputPixels: UPLOAD_LIMITS.maxPixelsPerImage
  });
  if (needsRotate(meta)) pipeline = pipeline.rotate();

  switch (decision.format) {
    case "jpg":
      // JPEG can't carry alpha; only composite over white if the source
      // actually has alpha — otherwise flatten is a no-op surcharge.
      if (meta?.hasAlpha) {
        pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
      }
      pipeline = pipeline.jpeg({
        ...JPEG_OPTS,
        quality: decision.jpeg!.quality,
        chromaSubsampling: decision.jpeg!.chromaSubsampling
      });
      break;
    case "png":
      pipeline = pipeline.png({
        compressionLevel: decision.png!.compressionLevel,
        palette: decision.png!.palette,
        effort: decision.png!.effort,
        adaptiveFiltering: !decision.png!.palette
      });
      break;
    case "webp":
      pipeline = pipeline.webp({
        quality: decision.webp!.quality,
        lossless: decision.webp!.lossless,
        effort: decision.webp!.effort,
        alphaQuality: decision.webp!.alphaQuality
      });
      break;
    case "avif":
      pipeline = pipeline.avif({
        quality: decision.avif!.quality,
        effort: decision.avif!.effort,
        chromaSubsampling: decision.avif!.chromaSubsampling
      });
      break;
  }

  return pipeline.toBuffer();
}
