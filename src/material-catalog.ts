/** Code identity is verified separately from the original display RGB snapshot. */
export const MATERIAL_CATALOG = {
  id: "mard-221-standard",
  revision: "mard-221-codes-20261017-v1",
  brand: "MARD 色号体系",
  name: "MARD 标准221色",
  series: "标准色 A–H、M（不含特殊效果扩展色）",
  sizeMm: 2.6,
  verification:
    "221个色号已与公开数据仓库逐项核对；2.6mm规格有商家公开资料支持。未取得厂家认证色卡。",
  screenNotice:
    "屏幕颜色仅供参考，未做实物颜色校准；不同批次和光线下实物可能有差异。",
  sources: [
    {
      label: "色号数据仓库（固定版本）",
      url: "https://github.com/maxcleme/beadcolors/blob/6e2692608970c7be7b20c419914404c92f5bc58b/raw/mard.csv",
    },
    {
      label: "2.6mm标准221色规格说明",
      url: "https://mamepix.com/en/guide/mard",
    },
  ],
} as const;
export type MaterialSpec = {
  catalogId: typeof MATERIAL_CATALOG.id;
  revision: typeof MATERIAL_CATALOG.revision;
  beadSizeMm: 2.6;
};
export const supportedMaterial = (): MaterialSpec => ({
  catalogId: MATERIAL_CATALOG.id,
  revision: MATERIAL_CATALOG.revision,
  beadSizeMm: 2.6,
});
export function verifiedMaterial(value: unknown): MaterialSpec | undefined {
  const v = value as Partial<MaterialSpec> | null;
  return v?.catalogId === MATERIAL_CATALOG.id &&
    v.revision === MATERIAL_CATALOG.revision &&
    v.beadSizeMm === 2.6
    ? supportedMaterial()
    : undefined;
}
export const PURCHASE_NOTICE =
  "请购买与本清单品牌／色卡系列及尺寸一致的拼豆。商家库存及包装颗数不同，请按实际商品规格选购。";
export function materialSizeLabel(settings: { materialSpec?: MaterialSpec }) {
  return verifiedMaterial(settings.materialSpec)
    ? "2.6 mm 迷你豆"
    : "豆子规格待选择";
}
