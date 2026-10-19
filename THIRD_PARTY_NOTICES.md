# 数据来源与第三方说明

豆格工坊（BeadGrid Studio）的第三方依赖由`package-lock.json`固定，各依赖仍遵守其自身许可；本文件不替代相应许可。

`src/palette.json`保留早期星豆绘公开前端的221色RGB快照及原顺序，版本`xing-public-221-20261016-v1`。此标识用于旧作品兼容，不因本工程改名而变更。屏幕颜色未做实物校准，详细来源和适用采购规格见`COLOR_CATALOG.md`。

色号核对使用`maxcleme/beadcolors`的MARD CSV，固定提交`6e2692608970c7be7b20c419914404c92f5bc58b`。最小测试副本位于`tests/fixtures/material-catalog/`，同目录保留原MIT许可`LICENSE.beadcolors`。本工程没有以该CSV的RGB替换原221色色值。

`tests/fixtures/legacy-200x112.bead.json`仅保留兼容性测试所需的旧项目网格和参数，已移除嵌入原图、描摹底图及本机元信息。上传原始素材、原站打包脚本和历史逆向截图不在本仓库中。
