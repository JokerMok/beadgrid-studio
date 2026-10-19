// Detect source coordinates only. Analysis never replaces or resizes the source file.
import type { SourceAlignment } from "./reference-recognition";
type GridGuess = {
  kind: string;
  cell: number | null;
  alignment: SourceAlignment | null;
  confidence: number;
  method: string;
};
const median = (a: number[]) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
function profiles({ data, width, height }: ImageData, vertical: boolean) {
  const length = vertical ? width : height,
    other = vertical ? height : width,
    step = Math.max(1, Math.floor(other / 600));
  const edge = new Float64Array(length),
    teal = new Float64Array(length),
    gray = new Float64Array(length);
  for (let p = 0; p < length; p++) {
    let count = 0;
    for (let k = 0; k < other; k += step) {
      const at = (vertical ? k * width + p : p * width + k) * 4,
        r = data[at],
        g = data[at + 1],
        b = data[at + 2];
      count++;
      if (data[at + 3] < 160) continue;
      if (g > r + 14 && g > b * 0.88 && g < 248) teal[p]++;
      if (
        Math.min(r, g, b) > 190 &&
        Math.max(r, g, b) < 249 &&
        Math.max(r, g, b) - Math.min(r, g, b) < 10
      )
        gray[p]++;
      if (p) {
        const prev = at - (vertical ? 1 : width) * 4;
        if (data[prev + 3] >= 160)
          edge[p] += Math.max(
            0,
            Math.abs(r - data[prev]) +
              Math.abs(g - data[prev + 1]) +
              Math.abs(b - data[prev + 2]) -
              60,
          );
      }
    }
    teal[p] /= count;
    gray[p] /= count;
    edge[p] /= count;
  }
  return { edge, teal, gray };
}
function majorLines(profile: Float64Array) {
  const threshold = Math.max(0.48, Math.max(...profile) * 0.55),
    centers: number[] = [];
  for (let p = 0; p < profile.length; ) {
    if (profile[p] < threshold) {
      p++;
      continue;
    }
    let weighted = 0,
      total = 0;
    while (p < profile.length && profile[p] >= threshold) {
      weighted += p * profile[p];
      total += profile[p++];
    }
    centers.push(weighted / total);
  }
  if (centers.length < 4) return null;
  const gap = median(centers.slice(1).map((p, i) => p - centers[i]));
  if (gap < 10) return null;
  const points = centers.map((p) => [Math.round((p - centers[0]) / gap), p]);
  const good = points.filter(
    ([i, p]) => Math.abs(p - centers[0] - i * gap) < Math.max(2, gap * 0.06),
  );
  if (good.length < 4 || good.length < centers.length * 0.85) return null;
  const mx = good.reduce((s, [i]) => s + i, 0) / good.length,
    my = good.reduce((s, [, p]) => s + p, 0) / good.length;
  let numerator = 0,
    denominator = 0;
  for (const [i, p] of good) {
    numerator += (i - mx) * (p - my);
    denominator += (i - mx) ** 2;
  }
  const pitch = numerator / denominator,
    first = my - pitch * mx;
  return {
    pitch,
    first,
    last: good.at(-1)![1],
    confidence: good.length / centers.length,
  };
}
function sustainedBounds(gray: Float64Array, pitch: number) {
  let first: number | null = null,
    last: number | null = null;
  for (let p = 0; p < gray.length; ) {
    if (gray[p] < 0.06) {
      p++;
      continue;
    }
    const start = p;
    while (p < gray.length && gray[p] >= 0.06) p++;
    if (p - start >= Math.max(3, pitch * 0.32)) {
      if (first === null) first = start;
      last = p;
    }
  }
  return first !== null ? { first, last } : null;
}
function printedGrid(
  x: ReturnType<typeof profiles>,
  y: ReturnType<typeof profiles>,
  width: number,
  height: number,
): GridGuess | null {
  const a = majorLines(x.teal),
    b = majorLines(y.teal);
  if (
    !a ||
    !b ||
    Math.abs(a.pitch - b.pitch) / Math.max(a.pitch, b.pitch) > 0.025
  )
    return null;
  const cell = (a.pitch + b.pitch) / 10;
  const axis = (
    lines: NonNullable<ReturnType<typeof majorLines>>,
    gray: Float64Array,
    length: number,
  ) => {
    const bounds = sustainedBounds(gray, cell);
    const start = bounds?.first ?? Math.max(0, lines.first - lines.pitch);
    const origin =
      lines.first + Math.round((start - lines.first) / cell) * cell;
    const end = bounds?.last ?? length;
    // Include a last cell cropped by the source image, but not a coordinate-label band.
    const count =
      end >= length - 2
        ? Math.ceil((end - origin) / cell - 0.08)
        : Math.round((end - origin) / cell);
    return { origin, count };
  };
  const ax = axis(a, x.gray, width),
    ay = axis(b, y.gray, height);
  if (ax.count < 8 || ay.count < 8) return null;
  return {
    kind: "numbered",
    cell,
    alignment: {
      cell,
      originX: ax.origin,
      originY: ay.origin,
      columns: ax.count,
      rows: ay.count,
      boardX: 0,
      boardY: 0,
    },
    confidence: Math.min(a.confidence, b.confidence),
    method: "printed-five-cell-lines",
  };
}
function frequency(profile: Float64Array, cell: number) {
  let re = 0,
    im = 0,
    total = 0;
  const angle = (2 * Math.PI) / cell;
  // Recurrence avoids a trigonometric call for every pixel and candidate pitch.
  const cr = Math.cos(angle),
    ci = Math.sin(angle);
  let r = 1,
    i = 0;
  for (let p = 0; p < profile.length; p++) {
    const v = profile[p];
    re += v * r;
    im += v * i;
    total += v;
    const next = r * cr - i * ci;
    i = i * cr + r * ci;
    r = next;
  }
  // A difference at index p compares centers p-.5 and p+.5: its boundary is p.
  return {
    cell,
    score: total ? Math.hypot(re, im) / total : 0,
    phase:
      ((((Math.atan2(im, re) * cell) / (2 * Math.PI)) % cell) + cell) % cell,
  };
}
function pixelPitch(profile: Float64Array) {
  let best = { cell: 0, score: 0, phase: 0 };
  const max = Math.min(128, profile.length / 12);
  for (let cell = 3; cell <= max; cell += 0.025) {
    const candidate = frequency(profile, cell);
    if (
      candidate.score > best.score + 1e-7 ||
      (Math.abs(candidate.score - best.score) < 1e-7 &&
        candidate.cell > best.cell)
    )
      best = candidate;
  }
  if (best.score < 0.35) return null;
  const coarse = best.cell;
  for (
    let cell = Math.max(3, coarse - 0.03);
    cell <= coarse + 0.03;
    cell += 0.0005
  ) {
    const candidate = frequency(profile, cell);
    if (candidate.score > best.score) best = candidate;
  }
  return best;
}
export function detectReferenceGrid(pixels: ImageData): GridGuess {
  const { width, height } = pixels;
  if (width <= 128 && height <= 128)
    return {
      kind: "pixel",
      cell: 1,
      alignment: {
        cell: 1,
        originX: 0,
        originY: 0,
        columns: width,
        rows: height,
        boardX: 0,
        boardY: 0,
      },
      confidence: 1,
      method: "native-pixels",
    };
  const x = profiles(pixels, true),
    y = profiles(pixels, false),
    printed = printedGrid(x, y, width, height);
  if (printed) return printed;
  const a = pixelPitch(x.edge),
    b = pixelPitch(y.edge);
  if (!a || !b || Math.abs(a.cell - b.cell) / Math.max(a.cell, b.cell) > 0.015)
    return {
      kind: "original",
      cell: null,
      alignment: null,
      confidence: 0,
      method: "manual",
    };
  const cell = (a.cell + b.cell) / 2,
    px = frequency(x.edge, cell),
    py = frequency(y.edge, cell);
  if (Math.min(px.score, py.score) < 0.55)
    return {
      kind: "original",
      cell: null,
      alignment: null,
      confidence: 0,
      method: "manual",
    };
  const origin = (phase: number) => (phase < cell * 0.1 ? 0 : phase - cell);
  const ox = origin(px.phase),
    oy = origin(py.phase);
  return {
    kind: "pixel",
    cell,
    alignment: {
      cell,
      originX: ox,
      originY: oy,
      columns: Math.ceil((width - ox) / cell - 0.08),
      rows: Math.ceil((height - oy) / cell - 0.08),
      boardX: 0,
      boardY: 0,
    },
    confidence: Math.min(px.score, py.score),
    method: "repeated-pixel-edges",
  };
}

export async function analyseGrid(image: HTMLImageElement): Promise<GridGuess> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const iw = image.naturalWidth,
    ih = image.naturalHeight,
    scale = Math.min(1, 2048 / Math.max(iw, ih));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(iw * scale));
  canvas.height = Math.max(1, Math.round(ih * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法读取原图进行网格校正");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  let result;
  // Only the analysis surface is bounded; display always uses the untouched source.
  try {
    result = detectReferenceGrid(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
    );
  } finally {
    canvas.width = canvas.height = 1;
  }
  if (result.alignment) {
    const sx = iw / Math.round(iw * scale),
      sy = ih / Math.round(ih * scale);
    result = {
      ...result,
      cell: result.cell! * sx,
      alignment: {
        ...result.alignment,
        cell: result.alignment.cell * sx,
        originX: result.alignment.originX * sx,
        originY: result.alignment.originY * sy,
      },
    };
  }
  return result;
}
