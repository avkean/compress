import multer from "multer";
import { UPLOAD_LIMITS } from "../config.js";

const ACCEPTED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/gif",
  "image/tiff",
  "image/bmp",
  "image/jxl",
  // Some browsers omit a mime for HEIC/HEIF; we accept octet-stream and let
  // the pipeline's file-type sniffer reject unknown formats authoritatively.
  "application/octet-stream",
  ""
]);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: UPLOAD_LIMITS.maxFiles,
    fileSize: UPLOAD_LIMITS.maxFileBytes,
    fields: 8,
    parts: UPLOAD_LIMITS.maxFiles + 8,
    fieldNameSize: 64,
    fieldSize: 64 * 1024
  },
  fileFilter(_req, file, callback) {
    const mime = (file.mimetype ?? "").toLowerCase();
    if (ACCEPTED_MIMES.has(mime) || mime.startsWith("image/")) {
      callback(null, true);
      return;
    }
    callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  }
});
