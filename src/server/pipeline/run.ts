import sharp from "sharp";
import { UPLOAD_LIMITS } from "../config.js";
import { encodeHeic } from "./heic.js";
import type { EncodingDecision } from "./decide.js";

// One pipeline: sharp decodes → rotates → encodes natively in libvips
// without ever exposing the intermediate RGBA buffer to JS. This is the
// single biggest perf win: no separate decode pass, no candidate scoring
// round-trip, no JS pixel loops.
export async function executeEncoding(buffer: Buffer, decision: EncodingDecision): Promise<Buffer> {
  if (decision.format === "heic") {
    // sharp can't write HEVC; libheif's heif-enc only ingests image files,
    // so we render to a lossless PNG via sharp and hand the buffer over.
    const png = await sharp(buffer, {
      animated: false,
      limitInputPixels: UPLOAD_LIMITS.maxPixelsPerImage
    })
      .rotate()
      .png({ compressionLevel: 0 })
      .toBuffer();
    return encodeHeic(png, { quality: decision.heic!.quality, lossless: decision.heic!.lossless });
  }

  let pipeline = sharp(buffer, {
    animated: false,
    limitInputPixels: UPLOAD_LIMITS.maxPixelsPerImage
  }).rotate(); // honour EXIF orientation

  switch (decision.format) {
    case "jpg":
      // JPEG can't carry alpha; if the source has it, composite over white.
      pipeline = pipeline
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({
          quality: decision.jpeg!.quality,
          mozjpeg: true,
          progressive: true,
          optimiseCoding: true,
          optimiseScans: true,
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
