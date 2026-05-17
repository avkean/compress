import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";

const PRODUCTION = process.env.NODE_ENV === "production";

// Multer's MulterError surfaces as the only "expected" upload failure mode
// (file too large, too many files, etc.) — translate it to a clean 4xx.
// Anything else becomes a generic 500 with no stack leak in production.
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof multer.MulterError) {
    const detail = MULTER_DETAILS[error.code] ?? "Upload rejected.";
    res.status(413).json({ error: detail });
    return;
  }

  const safeMessage = PRODUCTION
    ? "Server error."
    : error instanceof Error
      ? error.message
      : "Unknown server error.";
  if (!PRODUCTION) console.error("error:", error);
  res.status(500).json({ error: safeMessage });
};

const MULTER_DETAILS: Record<string, string> = {
  LIMIT_FILE_SIZE: "One of the files is over the per-file size limit.",
  LIMIT_FILE_COUNT: "Too many files in this upload.",
  LIMIT_UNEXPECTED_FILE: "Unexpected upload field.",
  LIMIT_PART_COUNT: "Too many parts in the multipart body.",
  LIMIT_FIELD_KEY: "Form field name too long.",
  LIMIT_FIELD_VALUE: "Form field value too large.",
  LIMIT_FIELD_COUNT: "Too many form fields."
};

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found." });
};
