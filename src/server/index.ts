import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { codecInventory } from "./inventory.js";
import { compressRoute } from "./http/compress-route.js";
import { applyNoStoreToHtml, harden, noStore, sendNoStoreHtml } from "./http/cache.js";
import { errorHandler, notFound } from "./http/errors.js";
import { accessLog } from "./http/logger.js";
import { securityHeaders } from "./http/security.js";
import { installShutdownHandlers } from "./http/shutdown.js";
import { upload } from "./http/upload.js";
import { resolveBuildVersion } from "./http/version.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);

harden(app);
app.use(securityHeaders);
app.use(accessLog);
app.use(express.json({ limit: "64kb" }));

app.use("/api", noStore);
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/inventory", async (_req, res, next) => {
  try {
    res.json(await codecInventory());
  } catch (error) {
    next(error);
  }
});

const clientDist =
  [path.resolve(__dirname, "../../client"), path.resolve(process.cwd(), "dist/client")].find((candidate) =>
    fs.existsSync(path.join(candidate, "index.html"))
  ) ?? path.resolve(process.cwd(), "dist/client");

const buildVersion = await resolveBuildVersion(clientDist);
app.get("/api/version", (_req, res) => res.json(buildVersion));

app.post("/api/compress", upload.array("images"), compressRoute);

// API 404s should look like API errors, not the SPA. Mount before the static
// fallthrough so unknown /api/* paths don't return index.html.
app.use("/api", notFound);

app.use(
  express.static(clientDist, {
    extensions: ["html"],
    etag: false,
    lastModified: false,
    setHeaders: applyNoStoreToHtml
  })
);
app.get(/.*/, (_req, res) => sendNoStoreHtml(res, path.join(clientDist, "index.html")));

app.use(errorHandler);

const server = app.listen(port, () => {
  const hash = buildVersion.bundleHash ?? "(no build)";
  console.log(`compress listening on http://localhost:${port}  bundle=${hash}`);
});

installShutdownHandlers(server);
