import type { RequestHandler } from "express";

// Minimal security-headers middleware. We don't pull helmet because the surface
// is tiny — one HTML page, hashed assets, a couple of JSON endpoints, and a
// streaming binary upload — and we want auditable, dependency-free policy.
//
// The CSP is strict by design: no inline scripts, no remote scripts, no
// frames. The hashed JS bundle is served same-origin so `'self'` is enough.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Vite still emits a single <style> for global CSS variables
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // HSTS is only meaningful over HTTPS; setting it unconditionally is safe
  // because browsers ignore the header on plain HTTP.
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
};
