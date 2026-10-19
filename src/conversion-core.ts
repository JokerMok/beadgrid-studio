import { PALETTE, rgb, nearest, type Settings } from "./model";
export const lightness = (i: number) =>
  rgb[i][0] * 0.299 + rgb[i][1] * 0.587 + rgb[i][2] * 0.114;
export const paletteDistance = (a: number, b: number) =>
  Math.sqrt(
    (rgb[a][0] - rgb[b][0]) ** 2 * 0.3 +
      (rgb[a][1] - rgb[b][1]) ** 2 * 0.59 +
      (rgb[a][2] - rgb[b][2]) ** 2 * 0.11,
  );
/** Ordinary sampling uses rounded RGB bytes and alpha-weight/base-weight coverage. */
export function sampleCells(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  size: number,
) {
  const out = new Uint8ClampedArray(w * h * 4),
    center = Math.floor(size / 2),
    stride = w * size;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let R = 0,
        G = 0,
        B = 0,
        alphaWeight = 0,
        baseWeight = 0;
      for (let sy = 0; sy < size; sy++)
        for (let sx = 0; sx < size; sx++) {
          const p = ((y * size + sy) * stride + x * size + sx) * 4,
            a = pixels[p + 3];
          if (a < 12) continue;
          const base =
              1 +
              (sx === center && sy === center ? 5 : 0) +
              (Math.abs(sx - center) <= 1 && Math.abs(sy - center) <= 1
                ? 1
                : 0),
            weight = (base * a) / 255;
          R += pixels[p] * weight;
          G += pixels[p + 1] * weight;
          B += pixels[p + 2] * weight;
          alphaWeight += weight;
          baseWeight += base;
        }
      const i = (y * w + x) * 4;
      if (alphaWeight > 0) {
        out[i] = Math.round(R / alphaWeight);
        out[i + 1] = Math.round(G / alphaWeight);
        out[i + 2] = Math.round(B / alphaWeight);
        out[i + 3] = Math.min(
          255,
          Math.round((255 * alphaWeight) / Math.max(1, baseWeight)),
        );
      }
    }
  return out;
}
export function backgroundMask(
  samples: Uint8ClampedArray,
  w: number,
  h: number,
  enabled: boolean,
  threshold = 42,
) {
  const mask = new Uint8Array(w * h);
  if (!enabled) return mask;
  const corners = [0, w - 1, w * (h - 1), w * h - 1],
    avg = [0, 1, 2].map(
      (c) => corners.reduce((n, p) => n + samples[p * 4 + c], 0) / 4,
    ),
    distance = (i: number) =>
      Math.hypot(
        samples[i * 4] - avg[0],
        samples[i * 4 + 1] - avg[1],
        samples[i * 4 + 2] - avg[2],
      );
  if (!avg.every((c) => c >= 235) || !corners.every((i) => distance(i) < 48))
    return mask;
  const queue: number[] = [];
  const visit = (i: number) => {
    if (
      i < 0 ||
      i >= mask.length ||
      mask[i] ||
      samples[i * 4 + 3] < 24 ||
      distance(i) >= threshold
    )
      return;
    mask[i] = 1;
    queue.push(i);
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q],
      x = i % w,
      y = Math.floor(i / w);
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }
  return mask;
}
export function repairNoise(input: Int16Array, w: number, h: number) {
  let cells = input.slice();
  for (let pass = 0; pass < 2; pass++) {
    const out = cells.slice();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c < 0) continue;
      const x = i % w,
        y = Math.floor(i / w),
        ns: number[] = [];
      if (x > 0) ns.push(cells[i - 1]);
      if (x < w - 1) ns.push(cells[i + 1]);
      if (y > 0) ns.push(cells[i - w]);
      if (y < h - 1) ns.push(cells[i + w]);
      const votes = new Map<number, number>();
      for (const n of ns) if (n >= 0) votes.set(n, (votes.get(n) || 0) + 1);
      let winner = c,
        support = 0;
      for (const [n, count] of votes)
        if (count > support) {
          winner = n;
          support = count;
        }
      if (
        winner !== c &&
        support >= 3 &&
        !ns.includes(c) &&
        paletteDistance(c, winner) < 54
      ) {
        out[i] = winner;
        continue;
      }
      const horizontal =
          x > 0 && x < w - 1 && cells[i - 1] === cells[i + 1]
            ? cells[i - 1]
            : -1,
        vertical =
          y > 0 && y < h - 1 && cells[i - w] === cells[i + w]
            ? cells[i - w]
            : -1,
        line = horizontal >= 0 ? horizontal : vertical;
      if (
        line >= 0 &&
        line !== c &&
        lightness(line) < 88 &&
        lightness(c) > 145 &&
        paletteDistance(c, line) > 72
      )
        out[i] = line;
    }
    cells = out;
  }
  return cells;
}
export function mergeRare(input: Int16Array, w?: number, h?: number) {
  const counts = new Uint32Array(221);
  for (const c of input) if (c >= 0) counts[c]++;
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return input.slice();
  const threshold = Math.max(2, Math.round(Math.sqrt(total) / 10)),
    frequent = Array.from(counts, (count, index) => ({ count, index }))
      .filter((c) => c.count > threshold)
      .map((c) => c.index);
  if (!frequent.length)
    return w && h ? repairNoise(input, w, h) : input.slice();
  const mapping = new Map<number, number>();
  for (let c = 0; c < 221; c++)
    if (counts[c] > 0 && counts[c] <= threshold) {
      let winner = frequent[0],
        distance = Infinity;
      for (const n of frequent) {
        const d =
          (rgb[c][0] - rgb[n][0]) ** 2 * 0.3 +
          (rgb[c][1] - rgb[n][1]) ** 2 * 0.59 +
          (rgb[c][2] - rgb[n][2]) ** 2 * 0.11;
        if (d < distance) {
          distance = d;
          winner = n;
        }
      }
      mapping.set(c, winner);
    }
  const out = input.map((c) => mapping.get(c) ?? c);
  return w && h ? repairNoise(out, w, h) : out;
}
export function enhanceEdges(
  input: Int16Array,
  w: number,
  h: number,
  strength: number,
) {
  const m = Math.max(0, Math.min(100, Number(strength) || 0)) / 100;
  if (!m) return input.slice();
  let cells = input.slice(),
    black = 0;
  for (let i = 1; i < 221; i++) if (lightness(i) < lightness(black)) black = i;
  const radius = m >= 0.82 ? 2 : 1,
    passes = m >= 0.82 ? 1 : m >= 0.38 ? 2 : 1,
    distanceLimit = 30 + 70 * m,
    lightGap = 22 - 14 * m,
    darkLimit = 160 - 45 * m,
    candidateLimit = 24 + 12 * m,
    blackDistance = 58 + 130 * m,
    minSupport = m < 0.38 ? 3 : 2;
  for (let pass = 0; pass < passes; pass++) {
    const out = cells.slice();
    for (let i = 0; i < cells.length; i++) {
      const current = cells[i];
      if (current < 0) continue;
      const x = i % w,
        y = Math.floor(i / w);
      if (
        x > 0 &&
        x < w - 1 &&
        y > 0 &&
        y < h - 1 &&
        [cells[i - 1], cells[i + 1], cells[i - w], cells[i + w]].every(
          (c) => c === current,
        )
      )
        continue;
      const neighbors = new Map<
        number,
        { count: number; near: number; weight: number }
      >();
      let same = 0;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const c = cells[ny * w + nx];
          if (c < 0) continue;
          const near = Math.max(Math.abs(dx), Math.abs(dy)) === 1;
          let stats = neighbors.get(c);
          if (!stats) {
            stats = { count: 0, near: 0, weight: 0 };
            neighbors.set(c, stats);
          }
          stats.count++;
          stats.near += near ? 1 : 0;
          stats.weight += near ? 2 : 1;
          if (c === current) same++;
        }
      let candidate = -1,
        score = -1,
        stats: { count: number; near: number; weight: number } | undefined;
      for (const [c, s] of neighbors) {
        const l = lightness(c);
        if (c === current || l > lightness(current) + candidateLimit) continue;
        const next =
          s.weight +
          s.near * 1.5 +
          Math.max(0, lightness(current) - l) * 0.02 +
          (l <= darkLimit ? 1 : 0);
        if (
          next > score ||
          (next === score && (candidate < 0 || l < lightness(candidate)))
        ) {
          score = next;
          candidate = c;
          stats = s;
        }
      }
      if (candidate < 0 || !stats) continue;
      const boundary =
          stats.near >= 2 || (radius === 2 && stats.count >= 3 && same === 0),
        dominant =
          stats.count > same ||
          (m >= 0.82 && stats.near >= Math.max(2, same + 1)),
        nearColor = paletteDistance(current, candidate) <= distanceLimit,
        darkContour =
          lightness(candidate) <= darkLimit &&
          lightness(current) - lightness(candidate) >= lightGap,
        high =
          m >= 0.78 &&
          stats.near >= 2 &&
          paletteDistance(current, candidate) <= distanceLimit * 0.8,
        blackStats = neighbors.get(black),
        blackOverride =
          m >= 0.78 &&
          black !== current &&
          (blackStats?.near || 0) >= 1 &&
          (blackStats?.count || 0) >= 1 &&
          same <= 2 &&
          lightness(current) > lightness(black) + lightGap &&
          paletteDistance(current, black) <= blackDistance;
      if (blackOverride) out[i] = black;
      else if (
        stats.near + stats.count >=
          Math.max(2, minSupport - (m >= 0.82 ? 1 : 0)) &&
        boundary &&
        dominant &&
        nearColor &&
        (darkContour || high)
      )
        out[i] = candidate;
    }
    cells = out;
  }
  return cells;
}
export function simplify(input: Int16Array, w: number, h: number) {
  let cells = mergeRare(input);
  for (let pass = 0; pass < 2; pass++) {
    const out = cells.slice();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] < 0) continue;
      const x = i % w,
        y = Math.floor(i / w),
        votes = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const c = cells[ny * w + nx];
          if (c >= 0) votes.set(c, (votes.get(c) || 0) + 1);
        }
      let winner = cells[i],
        n = 0;
      for (const [c, count] of votes)
        if (count > n) {
          winner = c;
          n = count;
        }
      if (n >= 6 && winner !== cells[i]) out[i] = winner;
    }
    cells = out;
  }
  return mergeRare(cells);
}
export function matchSamples(
  samples: Uint8ClampedArray,
  w: number,
  h: number,
  s: Settings,
  progress: (n: number) => void = () => {},
) {
  const allowed = PALETTE.map((_, i) => i).filter(
    (i) =>
      !s.disabled.includes(i) && (!s.allowed.length || s.allowed.includes(i)),
  );
  if (!allowed.length) throw Error("没有可用色号");
  const mask = backgroundMask(samples, w, h, s.removeLight),
    initial = new Int16Array(w * h).fill(-1),
    counts = new Uint32Array(221);
  for (let i = 0; i < initial.length; i++) {
    const p = i * 4;
    if (samples[p + 3] >= 24 && !mask[i]) {
      initial[i] = nearest(samples[p], samples[p + 1], samples[p + 2], allowed);
      counts[initial[i]]++;
    }
    if (i % (w * 20) === 0)
      progress(35 + Math.round((i / initial.length) * 30));
  }
  const nearWhite = allowed
      .filter((i) => rgb[i].every((c) => c >= 245) && counts[i] > 0)
      .sort((a, b) => counts[b] - counts[a])[0],
    limit = Math.min(
      221,
      Math.max(
        3,
        Number(s.mode === "simple" ? Math.min(24, s.limit) : s.limit) || 0,
      ),
    ),
    chosen = allowed
      .filter((i) => counts[i] > 0)
      .sort((a, b) => counts[b] - counts[a])
      .slice(0, limit);
  if (nearWhite !== undefined && !chosen.includes(nearWhite)) {
    if (chosen.length >= limit) chosen.pop();
    chosen.push(nearWhite);
  }
  const cells = initial.map((c, i) =>
    c < 0
      ? -1
      : nearest(samples[i * 4], samples[i * 4 + 1], samples[i * 4 + 2], chosen),
  );
  return { cells, mask, initial, chosen, counts };
}
/** Adjust current palette colours; neutral controls return the exact input grid. */
export function adjustPattern(
  input: Int16Array,
  w: number,
  h: number,
  s: Settings,
) {
  if (
    ![s.brightness, s.contrast, s.saturation, s.sharpen, s.exposure].some(
      Boolean,
    )
  )
    return input.slice();
  const exposure = 2 ** (s.exposure / 100),
    c = s.contrast * 2.2,
    contrast = (259 * (c + 255)) / (255 * (259 - c)),
    clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const colors = Array.from(input, (index) => {
    if (index < 0) return null;
    const channels = rgb[index].map(
        (v) => contrast * (v * exposure + s.brightness * 1.275 - 128) + 128,
      ),
      gray = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return channels.map((v) =>
      clamp(gray + (v - gray) * (1 + s.saturation / 100)),
    );
  });
  return input.map((index, i) => {
    if (index < 0) return -1;
    let channels = colors[i]!;
    if (s.sharpen > 0) {
      const x = i % w,
        y = Math.floor(i / w),
        ns = [
          x > 0 ? i - 1 : -1,
          x < w - 1 ? i + 1 : -1,
          y > 0 ? i - w : -1,
          y < h - 1 ? i + w : -1,
        ]
          .filter((i) => i >= 0)
          .map((i) => colors[i])
          .filter((c): c is number[] => c !== null);
      if (ns.length)
        channels = channels.map((v, c) =>
          clamp(
            v +
              (((v - ns.reduce((n, p) => n + p[c], 0) / ns.length) *
                s.sharpen) /
                100) *
                1.2,
          ),
        );
    }
    return nearest(channels[0], channels[1], channels[2]);
  });
}
export function similarGroups(cells: Int16Array, threshold = 90) {
  const counts = new Uint32Array(221);
  for (const c of cells) if (c >= 0) counts[c]++;
  const ordered = Array.from(counts, (count, index) => ({ count, index }))
      .filter((c) => c.count)
      .sort((a, b) => b.count - a.count),
    seen = new Set<number>(),
    groups: { representative: number; indices: number[]; affected: number }[] =
      [],
    distance = Math.max(
      10,
      (100 - Math.max(0, Math.min(100, threshold || 90))) * 2.2,
    );
  for (const color of ordered) {
    if (seen.has(color.index)) continue;
    const list = [color];
    for (const other of ordered)
      if (
        other.index !== color.index &&
        !seen.has(other.index) &&
        paletteDistance(color.index, other.index) <= distance
      )
        list.push(other);
    if (list.length > 1) {
      list.forEach((c) => seen.add(c.index));
      groups.push({
        representative: list[0].index,
        indices: list.map((c) => c.index),
        affected: list.reduce((n, c) => n + c.count, 0),
      });
    }
  }
  return groups;
}
export function mergeSimilar(
  cells: Int16Array,
  groups: ReturnType<typeof similarGroups>,
) {
  const map = new Map<number, number>();
  for (const g of groups)
    for (const i of g.indices) map.set(i, g.representative);
  return cells.map((i) => map.get(i) ?? i);
}
