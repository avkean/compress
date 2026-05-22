import os from "node:os";
import sharp from "sharp";

// libvips runs every operation on libuv's thread pool. Sharp's default
// concurrency is `os.cpus().length`, which is right, but we set it
// explicitly so it's auditable here. The cache helps for repeated work on
// the same buffer (rare in our request shape, but harmless).
let initialised = false;
export function initSharp(): void {
  if (initialised) return;
  initialised = true;
  sharp.concurrency(Math.max(1, os.cpus().length));
  sharp.cache({ memory: 200, items: 100, files: 0 });
  // SIMD is on by default on supported platforms; explicit for visibility.
  sharp.simd(true);
}
