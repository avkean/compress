import type { ImageClass } from "../shared/types.js";

export interface Classification {
  imageClass: ImageClass;
  uiTextLikely: boolean;
  warnings: string[];
  stats: {
    hasAlpha: boolean;
    edgeDensity: number;
    flatColorDominance: number;
    sampledColors: number;
  };
}

function lumaAt(data: Buffer, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

export function classifyRgba(data: Buffer, width: number, height: number): Classification {
  const pixels = width * height;
  const stride = Math.max(1, Math.floor(Math.sqrt(pixels / 80_000)));
  const colors = new Map<number, number>();
  let sampled = 0;
  let alphaSamples = 0;
  let edgeSamples = 0;
  let edgeHits = 0;

  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const i = (y * width + x) * 4;
      sampled += 1;
      if (data[i + 3] < 250) alphaSamples += 1;

      const bucket =
        ((data[i] >> 5) << 6) |
        ((data[i + 1] >> 5) << 3) |
        (data[i + 2] >> 5);
      colors.set(bucket, (colors.get(bucket) ?? 0) + 1);

      const left = lumaAt(data, i - 4);
      const right = lumaAt(data, i + 4);
      const up = lumaAt(data, i - width * 4);
      const down = lumaAt(data, i + width * 4);
      const edge = Math.abs(right - left) + Math.abs(down - up);
      edgeSamples += 1;
      if (edge > 36) edgeHits += 1;
    }
  }

  const topColorCount = Math.max(...colors.values(), 0);
  const flatColorDominance = sampled ? topColorCount / sampled : 0;
  const edgeDensity = edgeSamples ? edgeHits / edgeSamples : 0;
  const hasAlpha = sampled ? alphaSamples / sampled > 0.002 : false;

  if (hasAlpha) {
    return {
      imageClass: "alpha",
      uiTextLikely: true,
      warnings: [],
      stats: { hasAlpha, edgeDensity, flatColorDominance, sampledColors: colors.size }
    };
  }

  // ui-text content has sharp edges AND substantial flat regions (the
  // background between glyphs / UI elements). Photos with fine detail or
  // sensor noise also have high edge density but lack flatness, so we
  // require both signals before flipping to the text-safe encoding path.
  const uiTextLikely =
    (flatColorDominance > 0.28 && colors.size < 180) ||
    (edgeDensity > 0.04 && flatColorDominance > 0.18) ||
    (edgeDensity > 0.12 && flatColorDominance > 0.08);

  return {
    imageClass: uiTextLikely ? "ui-text" : "photo",
    uiTextLikely,
    warnings: uiTextLikely ? ["ui_text_route_used"] : [],
    stats: { hasAlpha, edgeDensity, flatColorDominance, sampledColors: colors.size }
  };
}
