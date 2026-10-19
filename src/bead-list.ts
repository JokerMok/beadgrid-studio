import { PALETTE, usage, type Project } from "./model";
import {
  MATERIAL_CATALOG,
  PURCHASE_NOTICE,
  verifiedMaterial,
} from "./material-catalog";

export type BeadListSort = "code" | "quantity";
export const LIST_PAGE_SIZE = 40;
export function buildBeadList(
  project: Project,
  sort: BeadListSort = "code",
  reserve = 0,
) {
  if (![0, 5, 10, 20].includes(reserve)) throw Error("不支持的备用量比例");
  if (
    project.cells.length !== project.width * project.height ||
    project.cells.some(
      (c) => !Number.isInteger(c) || c < -1 || c >= PALETTE.length,
    )
  )
    throw Error("图纸包含无效色号，无法生成采购清单");
  const rows = usage(project.cells).map(([index, count]) => ({
    code: PALETTE[index].code,
    hex: PALETTE[index].hex,
    count,
    purchase: Math.ceil((count * (100 + reserve)) / 100),
  }));
  const codeCompare = (a: { code: string }, b: { code: string }) =>
    a.code.localeCompare(b.code, "en", { numeric: true });
  rows.sort(
    sort === "quantity"
      ? (a, b) => b.count - a.count || codeCompare(a, b)
      : codeCompare,
  );
  const material = verifiedMaterial(project.settings.materialSpec);
  return {
    name: project.name,
    width: project.width,
    height: project.height,
    paletteVersion: project.paletteVersion,
    catalogRevision: MATERIAL_CATALOG.revision,
    brand: MATERIAL_CATALOG.brand,
    catalog: MATERIAL_CATALOG.name,
    series: MATERIAL_CATALOG.series,
    sizeMm: material?.beadSizeMm,
    total: rows.reduce((s, r) => s + r.count, 0),
    purchaseTotal: rows.reduce((s, r) => s + r.purchase, 0),
    empty: project.cells.length - rows.reduce((s, r) => s + r.count, 0),
    colorCount: rows.length,
    reserve,
    rows,
  };
}
export type BeadList = ReturnType<typeof buildBeadList>;
export function listSpecification(list: BeadList) {
  return `${list.brand}／${list.catalog}；${list.series}；豆子尺寸：${list.sizeMm ? list.sizeMm + " mm" : "待选择"}`;
}
export function estimatedSize(width: number, height: number, sizeMm?: number) {
  return sizeMm
    ? `约 ${((width * sizeMm) / 10).toFixed(1)} × ${((height * sizeMm) / 10).toFixed(1)} cm（按每格${sizeMm}mm估算，未计板间隙及熨烫收缩）`
    : "尺寸待选择后估算";
}
export function listText(list: BeadList) {
  return [
    `用豆清单｜${list.name}`,
    `图纸：${list.width} × ${list.height} 格`,
    listSpecification(list),
    `使用${list.colorCount}色；实际需用${list.total}颗；空格${list.empty}（不计入用量）`,
    `作品尺寸：${estimatedSize(list.width, list.height, list.sizeMm)}`,
    list.reserve
      ? `备用量${list.reserve}%；每色建议采购=实际颗数×${1 + list.reserve / 100}，向上取整；建议合计${list.purchaseTotal}颗`
      : "未加备用量；以下为实际所需颗数",
    "",
    list.reserve
      ? "色号\t实际所需（颗）\t建议采购（颗）"
      : "色号\t实际所需（颗）",
    ...list.rows.map(
      (r) => `${r.code}\t${r.count}${list.reserve ? "\t" + r.purchase : ""}`,
    ),
    "",
    MATERIAL_CATALOG.verification,
    MATERIAL_CATALOG.screenNotice,
    `色卡数据版本：${list.paletteVersion}；色号核对版本：${list.catalogRevision}`,
    PURCHASE_NOTICE,
  ].join("\n");
}
// Quote every field and neutralize formula prefixes in user-authored titles.
const csvCell = (value: string | number) => {
  let text = String(value);
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))
    text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
};
export function listCsv(list: BeadList) {
  const header = [
    "作品名称",
    "图纸宽(格)",
    "图纸高(格)",
    "品牌/色号体系",
    "色卡名称",
    "系列",
    "豆子尺寸(mm)",
    "色号",
    "实际所需(颗)",
    "备用量(%)",
    "建议采购(颗)",
    "使用颜色数",
    "实际总用量(颗)",
    "建议采购合计(颗)",
    "空格数",
    "色卡数据版本",
    "色号核对版本",
    "色号核对说明",
    "颜色说明",
    "采购提示",
  ];
  const lines = list.rows.map((r) => [
    list.name,
    list.width,
    list.height,
    list.brand,
    list.catalog,
    list.series,
    list.sizeMm ?? "待选择",
    r.code,
    r.count,
    list.reserve,
    r.purchase,
    list.colorCount,
    list.total,
    list.purchaseTotal,
    list.empty,
    list.paletteVersion,
    list.catalogRevision,
    MATERIAL_CATALOG.verification,
    MATERIAL_CATALOG.screenNotice,
    PURCHASE_NOTICE,
  ]);
  return (
    "\ufeff" +
    [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n")
  );
}
export function listPages(list: BeadList) {
  return Array.from(
    { length: Math.ceil(list.rows.length / LIST_PAGE_SIZE) },
    (_, i) => ({
      page: i + 1,
      rows: list.rows.slice(i * LIST_PAGE_SIZE, (i + 1) * LIST_PAGE_SIZE),
    }),
  );
}
