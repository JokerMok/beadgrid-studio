import { PALETTE, rgb, nearest } from "./model";
const table = rgb.map((channels) => {
  const [r, g, b] = channels.map((v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }),
    xyz = [
      (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047,
      r * 0.2126729 + g * 0.7151522 + b * 0.072175,
      (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883,
    ].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
  return {
    light: channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114,
    lab: [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])],
  };
});
const delta = (a: number, b: number) =>
  Math.hypot(...table[a].lab.map((v, i) => v - table[b].lab[i]));
function neighbors(index: number, w: number, h: number, diagonal = false) {
  const x = index % w,
    y = Math.floor(index / w),
    out: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (
        (dx || dy) &&
        (diagonal || Math.abs(dx) + Math.abs(dy) === 1) &&
        x + dx >= 0 &&
        x + dx < w &&
        y + dy >= 0 &&
        y + dy < h
      )
        out.push(index + dy * w + dx);
  return out;
}
export function sampleSmallCells(
  data: Uint8ClampedArray,
  w: number,
  h: number,
) {
  const size = 7,
    stride = w * size,
    out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const offset = (y * size * stride + x * size) * 4,
        samples: { rgb: number[]; alpha: number; weight: number }[] = [],
        bins = new Map<number, { weight: number; rgb: number[] }>();
      for (let sy = 0; sy < size; sy++)
        for (let sx = 0; sx < size; sx++) {
          const p = offset + (sy * stride + sx) * 4,
            alpha = data[p + 3];
          if (alpha < 24) continue;
          const color = [data[p], data[p + 1], data[p + 2]],
            weight =
              ((Math.abs(sx - 3) <= 1 && Math.abs(sy - 3) <= 1 ? 2 : 1) *
                alpha) /
              255,
            key =
              ((color[0] >> 4) << 8) | ((color[1] >> 4) << 4) | (color[2] >> 4),
            bin = bins.get(key) || { weight: 0, rgb: color };
          bin.weight += weight;
          bins.set(key, bin);
          samples.push({ rgb: color, alpha, weight });
        }
      if (!samples.length) continue;
      let best: { weight: number; rgb: number[] } | undefined;
      for (const bin of bins.values())
        if (!best || bin.weight > best.weight) best = bin;
      const sums = [0, 0, 0, 0];
      let weight = 0;
      for (const sample of samples) {
        if (Math.hypot(...sample.rgb.map((v, i) => v - best!.rgb[i])) > 25)
          continue;
        weight += sample.weight;
        sample.rgb.forEach((v, i) => (sums[i] += v * sample.weight));
        sums[3] += sample.alpha * sample.weight;
      }
      out.set(
        sums.map((v) => Math.round(v / weight)),
        (y * w + x) * 4,
      );
    }
  return out;
}
export function outlineMask(
  pattern: Int16Array,
  w: number,
  h: number,
  darkThreshold = 100,
) {
  const dark = new Uint8Array(pattern.length),
    outside = new Uint8Array(pattern.length),
    barrier = new Uint8Array(pattern.length),
    mask = new Uint8Array(pattern.length);
  pattern.forEach((c, i) => {
    if (c >= 0 && table[c].light <= darkThreshold) dark[i] = 1;
  });
  barrier.set(dark);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if ((dark[i - 1] && dark[i + 1]) || (dark[i - w] && dark[i + w]))
        barrier[i] = 1;
    }
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const prototypes = [
      ...new Set(
        border
          .filter((i) => pattern[i] >= 0 && !dark[i])
          .map((i) => pattern[i]),
      ),
    ],
    background = new Set<number>();
  for (let c = 0; c < 221; c++)
    if (
      table[c].light > darkThreshold &&
      prototypes.some((p) => delta(p, c) < 20)
    )
      background.add(c);
  const queue: number[] = [];
  const visit = (i: number) => {
    if (outside[i] || barrier[i]) return;
    if (pattern[i] >= 0 && !background.has(pattern[i])) return;
    outside[i] = 1;
    queue.push(i);
  };
  border.forEach(visit);
  for (let q = 0; q < queue.length; q++)
    for (const i of neighbors(queue[q], w, h)) visit(i);
  for (let i = 0; i < mask.length; i++)
    if (dark[i]) {
      const x = i % w,
        y = Math.floor(i / w);
      if (
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        neighbors(i, w, h, true).some((n) => outside[n])
      )
        mask[i] = 1;
    }
  return mask;
}
export function cleanSmallPattern(pattern: Int16Array, w: number, h: number) {
  if (Math.max(w, h) > 104) return pattern.slice();
  const counts = new Uint32Array(221);
  pattern.forEach((c) => {
    if (c >= 0) counts[c]++;
  });
  const ordered = Array.from(counts, (count, index) => ({ count, index }))
      .filter((x) => x.count)
      .sort((a, b) => b.count - a.count || a.index - b.index),
    representatives: number[] = [],
    mapping = new Map<number, number>();
  for (const { index, count } of ordered) {
    let candidate = -1,
      distance = Infinity;
    for (const other of representatives) {
      const d = delta(index, other),
        limit = count < Math.max(5, pattern.length * 0.003) ? 10 : 6.5;
      if (
        d < limit &&
        Math.abs(table[index].lab[0] - table[other].lab[0]) < 9 &&
        d < distance
      ) {
        candidate = other;
        distance = d;
      }
    }
    if (candidate < 0) {
      candidate = index;
      representatives.push(index);
    }
    mapping.set(index, candidate);
  }
  let result = pattern.map((c) => (c < 0 ? -1 : mapping.get(c)!));
  for (let pass = 0; pass < 2; pass++) {
    const out = result.slice();
    for (let i = 0; i < result.length; i++) {
      const c = result[i];
      if (c < 0) continue;
      const near = neighbors(i, w, h, true),
        same = near.filter((n) => result[n] === c).length;
      if (same > 1) continue;
      const votes = new Map<number, number>();
      for (const n of near) {
        const color = result[n];
        if (color >= 0) votes.set(color, (votes.get(color) || 0) + 1);
      }
      const winner = [...votes].sort((a, b) => b[1] - a[1])[0];
      if (
        winner &&
        winner[0] !== c &&
        winner[1] >= 4 &&
        delta(c, winner[0]) < 13
      )
        out[i] = winner[0];
    }
    result = out;
  }
  const black = PALETTE.findIndex((c) => c.code === "H7");
  if (black >= 0 && counts[black] > 0) {
    const mask = outlineMask(result, w, h, 75),
      indices = Array.from(mask, (_, i) => i).filter((i) => mask[i]);
    if (
      indices.length &&
      indices.filter((i) => table[result[i]].light < 28).length /
        indices.length >
        0.3
    )
      for (const i of indices)
        if (table[result[i]].light < 60) result[i] = black;
  }
  return result;
}
/** Already-aligned mosaic recognition samples the middle half of each cell. */
export function sampleMosaic(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  size: number,
) {
  const out = new Int16Array(w * h).fill(-1),
    stride = w * size,
    start = Math.max(1, Math.floor(size * 0.25)),
    end = Math.max(start + 1, Math.ceil(size * 0.75));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let R = 0,
        G = 0,
        B = 0,
        A = 0,
        n = 0;
      for (let sy = start; sy < end; sy++)
        for (let sx = start; sx < end; sx++) {
          const p = ((y * size + sy) * stride + x * size + sx) * 4,
            a = data[p + 3];
          if (a < 24) continue;
          R += data[p] * a;
          G += data[p + 1] * a;
          B += data[p + 2] * a;
          A += a;
          n++;
        }
      if (n && A >= 1)
        out[y * w + x] = nearest(
          Math.round(R / A),
          Math.round(G / A),
          Math.round(B / A),
        );
    }
  return out;
}
