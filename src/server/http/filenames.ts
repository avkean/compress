const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  jxl: "image/jxl",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  txt: "text/plain; charset=utf-8"
};

export function mimeForExtension(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}

export function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29");
}

function asciiFallback(value: string): string {
  return value.replaceAll(/[^\x20-\x7E]/g, "_").replaceAll('"', "_");
}

export function contentDisposition(filename: string): string {
  return `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
