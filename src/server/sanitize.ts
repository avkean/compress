import path from "node:path";

const SAFE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".tif",
  ".tiff",
  ".bmp",
  ".heic",
  ".heif",
  ".jxl"
]);

export function sanitizeBaseName(originalName: string): string {
  const parsed = path.parse(originalName.replaceAll("\\", "/"));
  const base = parsed.name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);

  return base || "image";
}

export function sanitizeExtension(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return SAFE_EXTENSIONS.has(ext) ? ext : "";
}

export function uniqueZipName(
  usedNames: Set<string>,
  originalName: string,
  outputExtension: string
): string {
  const base = sanitizeBaseName(originalName);
  const ext = outputExtension.startsWith(".") ? outputExtension : `.${outputExtension}`;
  let candidate = `${base}${ext}`;
  let index = 2;

  while (usedNames.has(candidate)) {
    candidate = `${base}-${index}${ext}`;
    index += 1;
  }

  usedNames.add(candidate);
  return candidate;
}
