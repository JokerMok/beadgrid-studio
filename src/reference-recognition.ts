import { nearest } from "./model";
export type SourceAlignment = {
  cell: number;
  originX: number;
  originY: number;
  columns: number;
  rows: number;
  boardX: number;
  boardY: number;
};
/** Ignore printed strokes/text at the perimeter. The dominant 5-bit bin controls the colour. */
export function chooseBlockColor(
  data: Uint8ClampedArray,
  offset = 0,
  stride = 7,
  skipCheckerboard = false,
) {
  const samples: number[][] = [],
    bins = new Map<number, { count: number; color: number[] }>();
  let bright = 0,
    low = 255,
    high = 0;
  for (let y = 1; y < 6; y++)
    for (let x = 1; x < 6; x++) {
      const i = offset + (y * stride + x) * 4;
      if (data[i + 3] < 24) continue;
      const c = Array.from(data.subarray(i, i + 4)),
        key = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3),
        bin = bins.get(key) || { count: 0, color: c };
      samples.push(c);
      bin.count++;
      bins.set(key, bin);
      if (
        Math.min(...c.slice(0, 3)) >= 185 &&
        Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3)) < 14
      ) {
        bright++;
        const v = (c[0] + c[1] + c[2]) / 3;
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
    }
  if (
    !samples.length ||
    (skipCheckerboard &&
      samples.length >= 8 &&
      bright / samples.length >= 0.92 &&
      low < 234 &&
      high > 242 &&
      high - low > 12)
  )
    return null;
  let dominant: { count: number; color: number[] } | undefined;
  for (const bin of bins.values())
    if (!dominant || bin.count > dominant.count) dominant = bin;
  const sum = [0, 0, 0, 0];
  let weight = 0;
  for (const c of samples) {
    if (
      Math.hypot(
        c[0] - dominant!.color[0],
        c[1] - dominant!.color[1],
        c[2] - dominant!.color[2],
      ) > 24
    )
      continue;
    const a = c[3] / 255;
    weight += a;
    c.forEach((v, i) => (sum[i] += v * a));
  }
  return sum.map((v) => Math.round(v / weight));
}
export function recognizeBlocks(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  skipCheckerboard = false,
) {
  const out = new Int16Array(width * height).fill(-1);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = chooseBlockColor(
        data,
        (y * 7 * width * 7 + x * 7) * 4,
        width * 7,
        skipCheckerboard,
      );
      if (c) out[y * width + x] = nearest(c[0], c[1], c[2]);
    }
  return out;
}
