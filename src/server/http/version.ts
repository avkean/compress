import fs from "node:fs/promises";
import path from "node:path";
import { APP_VERSION } from "../config.js";

export interface BuildVersion {
  appVersion: string;
  bundleHash: string | null;
  startedAt: string;
  clientDist: string;
}

const startedAt = new Date().toISOString();

export async function resolveBuildVersion(clientDist: string): Promise<BuildVersion> {
  let bundleHash: string | null = null;
  try {
    const html = await fs.readFile(path.join(clientDist, "index.html"), "utf8");
    const match = /assets\/index-([A-Za-z0-9_-]+)\.js/.exec(html);
    bundleHash = match?.[1] ?? null;
  } catch {
    // No build present yet — version endpoint will report a null hash.
  }
  return { appVersion: APP_VERSION, bundleHash, startedAt, clientDist };
}
