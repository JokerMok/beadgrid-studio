# 221色色号来源与采购规格

核对日期：2026-10-17。运行时不访问下述站点；链接只作为来源说明。

## 保留的显示数据

- 文件：`src/palette.json`，原星豆绘公开前端221色快照，版本 `xing-public-221-20261016-v1`。
- SHA-256：`8082638aab88bb9c8fe0f4cb8dabea976e3191db49d23728f76818aa072038c9`。
- 本轮未改变色号、RGB或原数组顺序。颜色名称是软件内说明，不作为商品名称。
- 数字RGB只用于屏幕预览和原有转换算法；没有光谱、光源、测量仪器或批次校准记录，不能视为实物精确颜色。

## 色号对应关系

逐项对照 [maxcleme/beadcolors 的原始Mard数据](https://github.com/maxcleme/beadcolors/blob/6e2692608970c7be7b20c419914404c92f5bc58b/raw/mard.csv)。固定commit为 `6e2692608970c7be7b20c419914404c92f5bc58b`（该文件提交记录日期2026-08-17）；CSV SHA-256为 `108a0118bc209e4a74fbfc2433c20a3b8ac6e8b91be0bbd412a1636ee05fb12b`。仓库是独立社区数据源，MIT许可，不是厂家认证机构。

该版本含291个色号。本工程221个色号全部存在于其中，标准子集为A1–A26、B1–B32、C1–C29、D1–D26、E1–E24、F1–F25、G1–G21、H1–H23、M1–M15，无缺失、无自造商品色号。原站RGB与该仓库219项不同、2项相同；本轮只核对色号身份，没有用仓库RGB替换原站色值，也没有由近似RGB推导跨品牌对应。

核对产物：`verification/material-catalog/verification.json`、`mard-6e269260.csv`。采购规格版本为 `mard-221-codes-20261017-v1`，与显示色值版本分别记录。

## 支持的尺寸与证据边界

当前支持“MARD色号体系／标准221色／2.6mm迷你豆”。依据为商家对自身产品和图纸体系的公开描述：

- [mamepix的MARD说明](https://mamepix.com/en/guide/mard)列出标准221色及其图纸、套装、单色豆采用的编码规则；其[主页说明](https://mamepix.com/en)明确对应MARD 2.6mm。
- [Yaya's Creative Studio的221色套装规格](https://yayascreativestudio.com/en/products/coffret-integral-perles-a-repasser-2-6-mm-221-couleurs-mard-boites)明确写出MARD 221、2.6mm直径。此处仅用作系列与尺寸存在的第一方商品资料，不推荐该商家，也不将页面的Artkal兼容描述转换成跨品牌同色号。

**已核对**：标准221色代码集合；有商家公开资料支持的MARD编码2.6mm组合。**仍未核实**：厂家原始认证色卡的发布主体及版本、物理样本、染料批次、屏幕颜色精度，以及该221色完整系列的5mm/10mm组合。未取得这些证据前，不把5mm/10mm列为支持组合。其他网页自行使用“官方”字样，不作为厂家身份证明。

作品实物大小仅按格数×2.6mm估算；实际还受底板针距、板间隙及熨烫收缩影响，界面及文字清单均说明估算依据。

## 旧文件迁移

旧 `.bead.json` 使用schemaVersion 1和固定色卡数组索引。该版本原始索引顺序冻结在 `src/legacy-palette-codes.json`；新文件增加 `paletteCodes`，读取时通过稳定色号恢复网格、自选和禁色索引。未知、缺失或重复映射直接拒绝导入，不猜测颜色。

旧文件无 `settings.materialSpec` 时显示“规格待选择”，保留原尺寸数值但不把它解释为已确认采购规格。用户选择支持组合后保存独立规格，继续使用原有RLE、色值版本及网格；再次导入和刷新保持一致。
