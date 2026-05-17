import type { RequestHandler } from "express";

// Minimal access log: method, path, status, duration, content-length.
// Never logs request bodies, query strings, headers, IPs, or cookies — none
// of that helps the operator and image bytes must never end up in logs.
export const accessLog: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  // Snapshot at request entry — sub-routers mutate `req.url`/`req.path` as
  // middleware mounts unwrap, and we want the path the user actually hit.
  const method = req.method;
  const fullPath = (req.originalUrl || req.url || "").split("?")[0] || "/";
  const path = fullPath.length > 80 ? `${fullPath.slice(0, 77)}…` : fullPath;
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
    const len = res.getHeader("Content-Length") ?? "-";
    // eslint-disable-next-line no-console
    console.log(`${method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms ${len}b`);
  });
  next();
};
