/** Current public edge-background rule: 32-step RGB buckets, multi-edge votes, 4-connected fill, RGB distance<62. No subject/AI detection. */
export function dominantBackgroundMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance = 62,
) {
  const mask = new Uint8Array(w * h);
  let left = w,
    right = -1,
    top = h,
    bottom = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] >= 24) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left) return mask;
  const bins = new Map<
    string,
    { n: number; r: number; g: number; b: number; sides: number }
  >();
  const vote = (x: number, y: number, side: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 24) return;
    const key = `${data[i] >> 5}-${data[i + 1] >> 5}-${data[i + 2] >> 5}`,
      v = bins.get(key) || { n: 0, r: 0, g: 0, b: 0, sides: 0 };
    v.n++;
    v.r += data[i];
    v.g += data[i + 1];
    v.b += data[i + 2];
    v.sides |= side;
    bins.set(key, v);
  };
  for (let x = left; x <= right; x++) {
    vote(x, top, 1);
    if (bottom !== top) vote(x, bottom, 2);
  }
  for (let y = top; y <= bottom; y++) {
    vote(left, y, 4);
    if (right !== left) vote(right, y, 8);
  }
  const bits = (n: number) => {
    let count = 0;
    while (n) {
      count += n & 1;
      n >>>= 1;
    }
    return count;
  };
  const ordered = [...bins.values()].sort(
      (a, b) => bits(b.sides) - bits(a.sides) || b.n - a.n,
    ),
    multi = ordered.filter((v) => bits(v.sides) >= 2),
    minimum = Math.max(
      2,
      Math.round(2 * (right - left + bottom - top + 2) * 0.012),
    );
  const colors = (multi.length ? multi : ordered.slice(0, 1))
    .filter((v) => v.n >= minimum)
    .slice(0, 5)
    .map((v) => [v.r / v.n, v.g / v.n, v.b / v.n]);
  if (!colors.length) return mask;
  const queue = new Int32Array(w * h);
  let end = 0;
  const add = (i: number) => {
    if (i < 0 || i >= mask.length || mask[i]) return;
    const p = i * 4;
    if (
      data[p + 3] < 24 ||
      !colors.some(
        (c) =>
          Math.hypot(data[p] - c[0], data[p + 1] - c[1], data[p + 2] - c[2]) <
          tolerance,
      )
    )
      return;
    mask[i] = 1;
    queue[end++] = i;
  };
  for (let x = left; x <= right; x++) {
    add(top * w + x);
    add(bottom * w + x);
  }
  for (let y = top; y <= bottom; y++) {
    add(y * w + left);
    add(y * w + right);
  }
  for (let at = 0; at < end; at++) {
    const i = queue[at],
      x = i % w,
      y = Math.floor(i / w);
    if (x > left) add(i - 1);
    if (x < right) add(i + 1);
    if (y > top) add(i - w);
    if (y < bottom) add(i + w);
  }
  return mask;
}
