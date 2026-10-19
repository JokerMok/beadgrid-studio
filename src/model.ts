import colors from "./palette.json";
import legacyCodes from "./legacy-palette-codes.json";
import {
  supportedMaterial,
  verifiedMaterial,
  type MaterialSpec,
} from "./material-catalog";
export const PALETTE = colors;
export const PALETTE_VERSION = "xing-public-221-20261016-v1";
export const BRAND = {
  name: "豆格工坊",
  english: "BeadGrid Studio",
  subtitle: "本地创作工作台",
  accent: "#1fa889",
};
export type Tool =
  | "hand"
  | "brush"
  | "eraser"
  | "picker"
  | "fill"
  | "lasso"
  | "magic"
  | "rectangle";
export type View = "beads" | "original" | "iron";
export type Settings = {
  materialSpec?: MaterialSpec;
  sourceAlignment?: import("./reference-recognition").SourceAlignment;
  skipCheckerboard?: boolean;
  similar?: boolean;
  smallCleanup: boolean;
  beadSize: number;
  width: number;
  height: number;
  limit: number;
  fit: "contain" | "crop";
  crop: { x: number; y: number; w: number; h: number };
  zoom: number;
  panX: number;
  panY: number;
  removeLight: boolean;
  alpha: "keep" | "white";
  merge: number;
  edges: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  exposure: number;
  mode: "normal" | "simple" | "recognize";
  alignX: number;
  alignY: number;
  disabled: number[];
  allowed: number[];
};
export type GridOptions = {
  lines: boolean;
  codes: boolean;
  coordinates: boolean;
  color: string;
  majorColor?: string;
  blockColor?: string;
};
export type Reference = {
  url: string;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type Project = {
  id: string;
  name: string;
  width: number;
  height: number;
  cells: Int16Array;
  paletteVersion: typeof PALETTE_VERSION;
  settings: Settings;
  source?: string;
  sourceName?: string;
  view: View;
  grid: GridOptions;
  reference?: Reference;
  updatedAt: number;
};
export const defaults = (width = 52, height = 52): Settings => ({
  smallCleanup: false,
  beadSize: 2.6,
  materialSpec: supportedMaterial(),
  width,
  height,
  limit: 221,
  fit: "crop",
  crop: { x: 0, y: 0, w: 1, h: 1 },
  zoom: 1,
  panX: 0,
  panY: 0,
  removeLight: true,
  alpha: "keep",
  merge: 0,
  edges: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpen: 0,
  exposure: 0,
  mode: "normal",
  alignX: 0,
  alignY: 0,
  disabled: [],
  allowed: [],
});
export function blank(width = 52, height = 52): Project {
  return {
    id: crypto.randomUUID(),
    name: `自定义创作 ${width}×${height}`,
    width,
    height,
    cells: new Int16Array(width * height).fill(-1),
    paletteVersion: PALETTE_VERSION,
    settings: defaults(width, height),
    view: "beads",
    grid: { lines: true, codes: false, coordinates: true, color: "#a0c4bc" },
    updatedAt: Date.now(),
  };
}
export function usage(cells: ArrayLike<number>) {
  const counts = new Map<number, number>();
  for (let i = 0; i < cells.length; i++)
    if (cells[i] >= 0) counts.set(cells[i], (counts.get(cells[i]) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}
export function encodeRle(cells: ArrayLike<number>) {
  const out: number[] = [];
  for (let i = 0; i < cells.length; ) {
    const v = cells[i];
    let end = i + 1;
    while (end < cells.length && cells[end] === v) end++;
    out.push(v, end - i);
    i = end;
  }
  return out;
}
export function serialize(p: Project) {
  return {
    schemaVersion: 1,
    paletteVersion: p.paletteVersion,
    paletteCodes: PALETTE.map((c) => c.code),
    id: p.id,
    name: p.name,
    width: p.width,
    height: p.height,
    patternRle: encodeRle(p.cells),
    settings: p.settings,
    source: p.source,
    sourceName: p.sourceName,
    view: p.view,
    grid: p.grid,
    reference: p.reference,
    updatedAt: p.updatedAt,
  };
}
function dimension(n: unknown) {
  return Number.isInteger(n) && Number(n) >= 16 && Number(n) <= 1000;
}
export function deserialize(raw: unknown): Project {
  const v = raw as ReturnType<typeof serialize>;
  if (!v || v.schemaVersion !== 1 || v.paletteVersion !== PALETTE_VERSION)
    throw Error("不支持的项目或色卡版本，请使用本网站导出的 .bead.json 文件");
  // Legacy v1 indices belong to the frozen original order. New files carry
  // their own stable codes, so sorting a catalog can never recolor a project.
  const codes = v.paletteCodes === undefined ? legacyCodes : v.paletteCodes;
  const codeToIndex = new Map(PALETTE.map((c, i) => [c.code, i]));
  if (
    !Array.isArray(codes) ||
    codes.length !== PALETTE.length ||
    new Set(codes).size !== PALETTE.length ||
    codes.some((c) => !codeToIndex.has(c))
  )
    throw Error("项目色号映射无效，未导入以避免颜色错位");
  const indexMap = codes.map((c) => codeToIndex.get(c)!);
  if (
    !dimension(v.width) ||
    !dimension(v.height) ||
    !Array.isArray(v.patternRle) ||
    v.patternRle.length > 2e6 ||
    v.patternRle.length % 2
  )
    throw Error("项目尺寸或网格无效");
  const cells = new Int16Array(v.width * v.height);
  let cursor = 0;
  for (let i = 0; i < v.patternRle.length; i += 2) {
    const value = v.patternRle[i],
      count = v.patternRle[i + 1];
    if (
      !Number.isInteger(value) ||
      value < -1 ||
      value >= 221 ||
      !Number.isInteger(count) ||
      count < 1 ||
      cursor + count > cells.length
    )
      throw Error("项目网格数据损坏");
    cells.fill(value < 0 ? -1 : indexMap[value], cursor, cursor + count);
    cursor += count;
  }
  if (cursor !== cells.length) throw Error("项目网格长度不匹配");
  const def = defaults(v.width, v.height);
  const settings = { ...def, ...v.settings, width: v.width, height: v.height };
  // Numeric sizes in old files were generic UI choices, not catalog evidence.
  settings.materialSpec = verifiedMaterial(v.settings?.materialSpec);
  for (const key of [
    "limit",
    "zoom",
    "panX",
    "panY",
    "merge",
    "edges",
    "brightness",
    "contrast",
    "saturation",
    "sharpen",
    "exposure",
    "alignX",
    "alignY",
  ] as const)
    if (!Number.isFinite(settings[key])) settings[key] = def[key];
  if (![2.6, 5, 10].includes(settings.beadSize)) settings.beadSize = 5;
  settings.limit = Math.max(3, Math.min(221, Math.round(settings.limit)));
  settings.zoom = Math.max(1, Math.min(4, settings.zoom));
  for (const key of [
    "brightness",
    "contrast",
    "saturation",
    "exposure",
  ] as const)
    settings[key] = Math.max(-100, Math.min(100, settings[key]));
  for (const key of ["sharpen", "edges"] as const)
    settings[key] = Math.max(0, Math.min(100, settings[key]));
  settings.merge = Math.max(0, Math.min(1000, settings.merge));
  for (const key of ["panX", "panY"] as const)
    settings[key] = Math.max(-0.5, Math.min(0.5, settings[key]));
  for (const key of ["alignX", "alignY"] as const)
    settings[key] = Math.max(-1, Math.min(1, settings[key]));
  if (!["normal", "simple", "recognize"].includes(settings.mode))
    settings.mode = "normal";
  if (!["crop", "contain"].includes(settings.fit)) settings.fit = "contain";
  if (!["keep", "white"].includes(settings.alpha)) settings.alpha = "keep";
  for (const key of ["disabled", "allowed"] as const)
    settings[key] = Array.isArray(settings[key])
      ? settings[key]
          .filter((n) => Number.isInteger(n) && n >= 0 && n < 221)
          .map((n) => indexMap[n])
      : [];
  const crop = settings.crop;
  if (
    !crop ||
    typeof crop !== "object" ||
    Array.isArray(crop) ||
    ![crop.x, crop.y, crop.w, crop.h].every(Number.isFinite) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.w <= 0 ||
    crop.h <= 0 ||
    crop.x + crop.w > 1.001 ||
    crop.y + crop.h > 1.001
  )
    settings.crop = def.crop;
  const a = settings.sourceAlignment;
  if (a) {
    if (
      ![
        a.cell,
        a.originX,
        a.originY,
        a.columns,
        a.rows,
        a.boardX,
        a.boardY,
      ].every(Number.isFinite) ||
      a.cell <= 0 ||
      a.columns < 1 ||
      a.rows < 1 ||
      a.boardX < 0 ||
      a.boardY < 0
    )
      delete settings.sourceAlignment;
    else
      settings.sourceAlignment = {
        ...a,
        columns: Math.min(1000, Math.round(a.columns)),
        rows: Math.min(1000, Math.round(a.rows)),
        boardX: Math.min(v.width - 1, Math.round(a.boardX)),
        boardY: Math.min(v.height - 1, Math.round(a.boardY)),
      };
  }
  const dataImage = (s: unknown) =>
    typeof s === "string" &&
    /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(s) &&
    s.length <= 12e6
      ? s
      : undefined;
  let reference: Reference | undefined;
  if (
    v.reference &&
    dataImage(v.reference.url) &&
    [
      v.reference.opacity,
      v.reference.x,
      v.reference.y,
      v.reference.width,
      v.reference.height,
    ].every(Number.isFinite)
  )
    reference = {
      ...v.reference,
      x: Math.max(-2000, Math.min(2000, v.reference.x)),
      y: Math.max(-2000, Math.min(2000, v.reference.y)),
      opacity: Math.max(0, Math.min(1, v.reference.opacity)),
      width: Math.max(1, Math.min(2000, v.reference.width)),
      height: Math.max(1, Math.min(2000, v.reference.height)),
    };
  return {
    id: typeof v.id === "string" ? v.id : crypto.randomUUID(),
    name: String(v.name || "导入作品").slice(0, 120),
    width: v.width,
    height: v.height,
    cells,
    paletteVersion: PALETTE_VERSION,
    settings,
    source: dataImage(v.source),
    sourceName: String(v.sourceName || ""),
    view: ["beads", "original", "iron"].includes(v.view) ? v.view : "beads",
    grid: {
      lines: v.grid?.lines ?? true,
      codes: v.grid?.codes ?? false,
      coordinates: v.grid?.coordinates ?? true,
      color: /^#[0-9a-f]{6}$/i.test(v.grid?.color) ? v.grid.color : "#a0c4bc",
      majorColor: /^#[0-9a-f]{6}$/i.test(v.grid?.majorColor || "")
        ? v.grid.majorColor
        : "#29a88f",
      blockColor: /^#[0-9a-f]{6}$/i.test(v.grid?.blockColor || "")
        ? v.grid.blockColor
        : "#29a88f",
    },
    reference,
    updatedAt: Date.now(),
  };
}
export function transform(
  p: Project,
  kind: "rotate" | "flipX" | "flipY",
): Project {
  const w = kind === "rotate" ? p.height : p.width,
    h = kind === "rotate" ? p.width : p.height,
    cells = new Int16Array(w * h);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const nx =
        kind === "rotate"
          ? p.height - 1 - y
          : kind === "flipX"
            ? p.width - 1 - x
            : x;
      const ny =
        kind === "rotate" ? x : kind === "flipY" ? p.height - 1 - y : y;
      cells[ny * w + nx] = p.cells[y * p.width + x];
    }
  return {
    ...p,
    width: w,
    height: h,
    cells,
    settings: { ...p.settings, width: w, height: h },
    reference: undefined,
  };
}
export function connected(
  cells: Int16Array,
  w: number,
  h: number,
  index: number,
) {
  const found = new Set<number>();
  const value = cells[index];
  const queue = [index];
  found.add(index);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q],
      x = i % w,
      y = Math.floor(i / w);
    for (const n of [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      y > 0 ? i - w : -1,
      y < h - 1 ? i + w : -1,
    ])
      if (n >= 0 && !found.has(n) && cells[n] === value) {
        found.add(n);
        queue.push(n);
      }
  }
  return found;
}
export function cropProject(
  p: Project,
  rect: { x: number; y: number; w: number; h: number },
) {
  if (rect.w < 16 || rect.h < 16) throw Error("裁剪后的宽高至少为16格");
  const cells = new Int16Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++)
    cells.set(
      p.cells.subarray(
        (rect.y + y) * p.width + rect.x,
        (rect.y + y) * p.width + rect.x + rect.w,
      ),
      y * rect.w,
    );
  return {
    ...p,
    width: rect.w,
    height: rect.h,
    cells,
    settings: { ...p.settings, width: rect.w, height: rect.h },
    reference: undefined,
  };
}
export const rgb = PALETTE.map((p) => [
  parseInt(p.hex.slice(1, 3), 16),
  parseInt(p.hex.slice(3, 5), 16),
  parseInt(p.hex.slice(5, 7), 16),
]);
export function nearest(
  r: number,
  g: number,
  b: number,
  indices: number[] = PALETTE.map((_, i) => i),
) {
  let best = indices[0] ?? 0,
    dist = Infinity;
  for (const i of indices) {
    const c = rgb[i],
      d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}
export function remapDisabled(p: Project) {
  const allowed = PALETTE.map((_, i) => i).filter(
    (i) =>
      !p.settings.disabled.includes(i) &&
      (!p.settings.allowed.length || p.settings.allowed.includes(i)),
  );
  if (!allowed.length) throw Error("至少保留一种可用颜色");
  const cells = p.cells.slice();
  for (let i = 0; i < cells.length; i++)
    if (cells[i] >= 0 && !allowed.includes(cells[i]))
      cells[i] = nearest(
        ...(rgb[cells[i]] as [number, number, number]),
        allowed,
      );
  return { ...p, cells };
}
