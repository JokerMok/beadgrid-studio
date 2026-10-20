import type { Settings } from "./model";
export const GRID_MIN = 16,
  GRID_MAX = 1000,
  DEFAULT_LONG_EDGE = 200;
const clamp = (value: number) =>
  Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(value)));
export function selectedRatio(
  dimensions: { w: number; h: number },
  settings: Pick<Settings, "fit" | "crop">,
) {
  const crop = settings.fit === "crop" ? settings.crop : { w: 1, h: 1 };
  return (dimensions.w * crop.w) / (dimensions.h * crop.h);
}
/** All density controls mean the longest side, for both orientations. */
export function gridFromLongEdge(edge: number, ratio: number) {
  const n = clamp(edge),
    r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return r >= 1
    ? { width: n, height: clamp(n / r) }
    : { width: clamp(n * r), height: n };
}
export function gridFromAxis(
  axis: "width" | "height",
  value: number,
  ratio: number,
) {
  if (!Number.isInteger(value) || value < GRID_MIN || value > GRID_MAX)
    return { [axis]: value } as Partial<Settings>;
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const edge =
    axis === "width" ? value * Math.max(1, 1 / r) : value * Math.max(1, r);
  return gridFromLongEdge(edge, r);
}
export function outputCoverage(sourceRatio: number, gridRatio: number) {
  // The retained fraction for explicitly chosen centered cover placement.
  return sourceRatio > gridRatio
    ? { w: gridRatio / sourceRatio, h: 1 }
    : { w: 1, h: sourceRatio / gridRatio };
}

/** Normalized source region that really survives the output bounds, including legacy zoom/pan. */
export function sourceOutputCoverage(s: Settings, sourceRatio: number) {
  const scale =
    (s.placement === "cover" ? Math.max : Math.min)(
      s.width / sourceRatio,
      s.height,
    ) * s.zoom;
  const w = sourceRatio * scale,
    h = scale;
  const dx = (s.width - w) / 2 + s.panX * s.width + s.alignX;
  const dy = (s.height - h) / 2 + s.panY * s.height + s.alignY;
  const unit = (n: number) => Math.max(0, Math.min(1, n));
  const x = unit(-dx / w),
    y = unit(-dy / h);
  return {
    x,
    y,
    w: Math.max(0, unit((s.width - dx) / w) - x),
    h: Math.max(0, unit((s.height - dy) / h) - y),
  };
}
