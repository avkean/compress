import type { RequestHandler, Response } from "express";

const NO_STORE = "no-store";

export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", NO_STORE);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
};

export function applyNoStoreToHtml(res: Response, filePath: string): void {
  if (filePath.endsWith("index.html") || filePath.endsWith(".html")) {
    res.setHeader("Cache-Control", NO_STORE);
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  } else {
    // Hashed asset filenames are immutable; the URL itself is the version.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}

export function sendNoStoreHtml(res: Response, filePath: string): void {
  res.setHeader("Cache-Control", NO_STORE);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(filePath);
}

// Express still emits a weak ETag on JSON bodies and a Last-Modified on
// sendFile by default. Disabling both at the app level guarantees that
// no-store actually means no-store.
export function harden(app: { set(key: string, value: unknown): void }): void {
  app.set("etag", false);
  app.set("x-powered-by", false);
}

