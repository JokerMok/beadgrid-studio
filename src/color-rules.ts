import { PALETTE, nearest, rgb, type Project } from "./model";
export type ColorRegionRule = { indices: number[]; colors: number[] };
export const colorAllowed = (p: Project, index: number, color: number) =>
  color < 0 ||
  (!p.settings.disabled.includes(color) &&
    !(p.colorRules || []).some(
      (r) => r.colors.includes(color) && r.indices.includes(index),
    ));
export function applyColorRules(p: Project): Project {
  if (!p.colorRules?.length) return p;
  const cells = p.cells.slice();
  const forbidden = new Map<number, Set<number>>();
  for (const rule of p.colorRules)
    for (const i of rule.indices) {
      if (i < 0 || i >= cells.length) continue;
      let set = forbidden.get(i);
      if (!set) {
        set = new Set(p.settings.disabled);
        forbidden.set(i, set);
      }
      rule.colors.forEach((c) => set!.add(c));
    }
  const cache = new Map<string, number>();
  for (const [i, set] of forbidden) {
    const c = cells[i];
    if (c < 0 || !set.has(c)) continue;
    const allowed = PALETTE.map((_, n) => n).filter(
      (n) =>
        !set.has(n) &&
        (!p.settings.allowed.length || p.settings.allowed.includes(n)),
    );
    if (!allowed.length) throw Error("禁色区域至少保留一种可用颜色");
    const key = c + ":" + allowed.join(",");
    let target = cache.get(key);
    if (target === undefined) {
      target = nearest(...(rgb[c] as [number, number, number]), allowed);
      cache.set(key, target);
    }
    cells[i] = target;
  }
  return { ...p, cells };
}
