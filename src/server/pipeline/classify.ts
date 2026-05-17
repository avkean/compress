import sharp from "sharp";
import { UPLOAD_LIMITS } from "../config.js";
import { classifyRgba } from "../classifier.js";
import type { Classification } from "../classifier.js";

const THUMB_SIDE = 128;

// Classifying off a 128px thumb is ~30ms regardless of input resolution.
// On a 12MP photo, decoding the full RGBA buffer for classification alone
// would burn ~40ms and waste ~48MB of memory; the thumb gets us the same
// answer in a fraction of the work.
export async function classifyFromBuffer(buffer: Buffer): Promise<Classification> {
  const thumb = await sharp(buffer, {
    animated: false,
    limitInputPixels: UPLOAD_LIMITS.maxPixelsPerImage
  })
    .rotate()
    .resize(THUMB_SIDE, THUMB_SIDE, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return classifyRgba(thumb.data, thumb.info.width, thumb.info.height);
}
