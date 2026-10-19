# 豆格工坊 · BeadGrid Studio

本地拼豆制图、编辑、图纸导出与用豆采购清单工作台，当前版本1.3.0。采用 React / TypeScript / Vite，配套 Node.js + SQLite 账号服务。转换、编辑和导出均在浏览器本地执行。

仓库：[JokerMok/beadgrid-studio](https://github.com/JokerMok/beadgrid-studio)。本工程此前以“星豆绘独立本地工作台”开发，交互与算法来源仍在差异说明及色卡来源中保留，不请求原站接口、不连接原站账号或会员系统。改名保留IndexedDB名称、色卡版本和项目文件格式，既有作品可继续打开。

## 启动

需要 Node.js 22.13 以上，推荐 Node.js 24 LTS。macOS 可双击 `start-local.command`；终端启动：

```sh
npm ci
npm run build
PORT=4173 npm start
```

打开 **http://127.0.0.1:4173/**。服务需要保持运行。不要直接双击 `dist/index.html`，模块与账号接口需要 HTTP 服务。

从旧版页面升级可打开 **http://127.0.0.1:4173/?v=1.3.0**，确保加载新构建。

开发：`npm run dev`，前端 http://127.0.0.1:5173/ ，账号服务 http://127.0.0.1:8787/ 。开发入口会将 `/api` 代理至配套服务。修改后端后重启开发进程。

临时公网外测：`npm run public:start`；查看 `npm run public:status`，停止 `npm run public:stop`，重新创建 `npm run public:restart`。优先复用4173正确生产服务，最新地址及日志在 `.local-public/`。只管理本项目登记的进程，不修改其他Tunnel。详见 [PUBLIC_PREVIEW.md](PUBLIC_PREVIEW.md)。

## v1.3界面

采用用户指定的深色与淡紫规范，设计变量和组件职责见[DESIGN.md](DESIGN.md)。上传、清单、导出、颜色、作品、登录和高级工具共用主题；打印图纸与采购清单图片仍保持适合打印的白底。未改色卡、转换算法、项目格式或账号数据模型。

作品菜单提供保存、我的作品、新建、项目导入导出和重新生成；左栏“扩展”提供原有识别、底图、替色、禁色及高级处理；底部“画布操作”提供变换、裁剪、网格、坐标和色号。AI入口保留禁用状态，更多工具仍显示待开发。

2026-10-19本地集中回归：1488×1056与1440×1024桌面、390×844手机模拟及820×1180平板模拟检查通过。真实图片上传、连续画笔、橡皮、撤销重做、缩放后落笔、保存刷新、清单CSV/图片及图纸PNG实际下载通过；应用主题未改变画布RGB和白底导出。上一轮作品ID、同步版本和排序浏览器回归再次通过。截图与下载证据保存在本地`verification/dark-ui/`；未做实体手机验收，未收到本轮设计图附件，不能声称逐像素对照完成。

## 已有能力

- 深色工作台：80px单行顶栏、72px分组工具栏、真实Canvas画布、底部统计与缩放、316px属性／色卡面板；手机和平板使用属性抽屉。深色主题与淡紫强调色覆盖所有业务弹窗。
- PNG / JPEG / WebP 点击与拖放导入；自由框选裁剪、完整置入、等比缩放、位置与透明区域设置，裁剪八把手、选框与视图移动。16～1000格独立宽高，52 / 78 / 104 / 120预设。
- 明确版本的221色色卡；格内加权采样、RGB最近色、按频次减色、浅色边缘连通清理；公开规则的杂色合并、边缘强化与小图处理。HTML图片构图后交给Worker采样匹配，可取消。
- 手型、缩放、1/2/3/5格画笔、连续笔画、橡皮、吸管、四邻接填充、套索、矩形选区、魔法选取、选区填色与清除；单色替换、自选色卡、禁色重映射。
- 旋转、双向翻转、画布内八把手裁剪、含选区的撤销重做、网格与颜色、坐标、格内色号、原图 / 拼豆图 / 熨烫 / 专注视图。
- 描摹底图及透明度、位置、大小；亮度、对比度、饱和度、锐化、曝光；格内主色识别、原图网格校准、轮廓选区窗口与简化图模式。
- IndexedDB 自动草稿、本地作品列表、带完整网格及参数的 `.bead.json` 导入导出；独立账号注册、登录、退出和服务端作品保存。
- 图纸PNG、纯马赛克PNG、色卡PNG和用量CSV、镜像、52 / 78 / 104格分板套装。所有结果取自同一项目快照。
- 用豆采购清单：品牌／色卡系列、2.6mm规格、当前网格逐色数量，按色号或数量排序；复制全文、中文Excel CSV、每页40色的清单PNG（多页ZIP）。可另加5%／10%／20%备用量，实际用量与建议采购量分列。
- 平板与手机布局，右侧设置切换为抽屉；触摸平移与双指缩放。AI生图保持禁用，“更多”保持待开发状态。

## 数据与算法

运行态网格为 `Int16Array`，-1为空格，0～220为固定色卡索引。项目文件继续采用版本1及RLE网格，并保存尺寸、色卡版本、原图、构图、处理参数、参考底图与显示设置。v1.2新增 `paletteCodes` 稳定色号映射、`settings.materialSpec` 采购规格；旧文件无映射时按 `legacy-palette-codes.json` 冻结顺序迁移。导入时将网格、自选与禁用索引按色号映射，不允许未知或重复色号。既有色值及数组顺序未变。

色卡版本：`xing-public-221-20261016-v1`。`src/palette.json` 保留原顺序，A1为 `#f9f4ca`，不得以另一份同名221色色卡替换。当前原站主脚本在2026-10-17补取，色卡SHA-256：`8082638aab88bb9c8fe0f4cb8dabea976e3191db49d23728f76818aa072038c9`。此数据是公开前端色值快照，未做实物校色。

本地草稿每650ms写入一次。新建、重新生成或打开其他作品前，当前作品先保存到本地列表。撤销历史最多50步，同时限制为32MB网格数据。多标签同时编辑时，自动草稿以最后写入为准；重要作品请保存命名副本或导出项目文件。

上传新素材并生成成功后创建新作品ID，原作品单独保留；当前作品调整参数后重新生成沿用原ID，取消或失败不替换作品。列表读取保留原更新时间，缺失或无效日期按未知时间（0）排序；仅打开作品不修改日期。

图片输入限制32MB、8000万像素，原始data URL不超过1000万字符。保存原文件字节，不先缩到2400px或转成WebP；超过存储上限明确拒绝，避免同输入在转换前已经变成另一张图。

普通路径的近白保留阈值为245，浅色背景四角判定仍为235；采样RGB取整并写入Uint8ClampedArray，alpha按有效基础权重计算。默认转换与图纸调节分开。`src/conversion-core.ts` 是可单独核对的算法模块；`prepare-image.ts` 使用HTML图片解码，避免ImageBitmap重采样路径改变结果。Worker负责采样、匹配、减色和后处理。

## 用豆清单与采购规格（v1.2）

从顶部“用豆清单”或调色板下方进入。清单只统计当前编辑后的有效格子，透明和空格不计入；每色实际用量之和等于总用豆颗数。备用量按每色分别乘以比例后向上取整，不修改实际用量或图纸。

当前仅提供 **MARD标准221色号体系／标准A–H、M系列／2.6mm迷你豆**。221个色号与固定版本公开仓库逐项对应，尺寸有商家公开资料支持；没有取得厂家认证色卡，不将屏幕RGB作为实物校准。来源、固定commit、文件哈希和未确认信息见 [COLOR_CATALOG.md](COLOR_CATALOG.md)。不提供不同品牌的近似色号替代。

旧作品中的 `beadSize: 5` 等数值只是此前通用尺寸设置，不能证明适用系列。导入、恢复后会显示“规格待选择”，用户选择2.6mm后才开放清单复制与下载；不会静默补成已确认规格。旧数值在选择前保留，新规格独立保存。作品尺寸按网格宽高×每格2.6mm估算，明确未计板间隙与熨烫收缩。

CSV为UTF-8 BOM、CRLF、完整引号转义，含作品、规格、每色色号、实际颗数、备用量比例、建议采购量、汇总、版本和采购提示。图片每页1240×1900px、至多40色；多页ZIP附逐页PNG、完整文字和清单数据。逐页绘制编码，提供进度、取消及失败提示。当前全空图纸不提供采购下载。

本轮未增加商家搜索、商品链接推荐、询价、配豆短码、购物车、支付或新后台能力；清单全部在本地生成。

## 导出与内存

确认窗口预告最终像素尺寸。普通图纸按56px起始格宽、自增到至少4K的公开排版规则，包含格内色号、四边坐标、图例、颜色名称和用量。独立色卡按用量排序，另附CSV。完整图纸始终生成单张PNG；物理板整体和部分导出由用户明确选择。

高清PNG使用横向不超过8192px的小片、纵向至多64行且约100万像素的条带绘制，并增量压缩；不创建整幅高清Canvas。完整圆角色卡先绘制小卡片，避免条带边界裁断路径带来抗锯齿差异。生成有进度、取消和错误反馈，完成后点击“下载文件”。

52 / 78 / 104分板将原图居中放入完整板区，不拉伸；红线标记实体板界。分区保留全图坐标，留白和空格不计豆数，多区打包ZIP。单次导出压缩数据限制128MB、最多400分区，触及限制明确报错，不会自动将完整图纸改成分区。

本机已实际下载500×279、114色的28268×17549单张PNG（39,860,321字节），并以流式解码验证；百万格导出取消后网格不变。此样本结果不代表所有设备的大图速度。

## 账号与部署

- SQLite默认位置 `data/studio.sqlite`，含用户、会话和作品。账号作品在此配套服务器保存；本地作品属于当前浏览器，二者独立。
- 密码使用随机盐和scrypt，服务端保存哈希；会话只保存token哈希，Cookie设置HttpOnly / SameSite=Strict，7天有效。所有作品读取、更新、删除均限定当前用户，写入校验网格。每账号最多50个作品。
- 服务端拒绝跨来源写入，并限制认证请求频率。更新作品带服务端版本戳，冲突返回409，用户可重新打开或另存副本。
- 已知同步版本与服务来源、账号ID及作品ID一起保存在本机草稿/作品快照中，不包含在导出的`.bead.json`中。刷新后恢复匹配版本；不同窗口各自保留已知版本，不在保存前获取新版本覆盖。旧草稿或导入文件缺少同步版本时，服务端返回428，需重新打开账号作品或另存副本；真正的版本不一致仍返回409。
- 可复制 `.env.example` 为 `.env`。本机默认只监听127.0.0.1。需要局域网或部署时设置 `HOST=0.0.0.0`。HTTPS反向代理须保留Host；部署时设 `COOKIE_SECURE=1`，需要时设置精确的 `ALLOWED_ORIGINS`。
- 部署完整应用需要Node服务与持久化磁盘，仅上传 `dist/` 到静态托管无法提供账号接口。Docker示例：`docker build -t beadgrid-studio .`，再运行 `docker run -p 8787:8787 -v beadgrid-data:/app/data beadgrid-studio`。Docker配置已提供，未在本轮实际部署。
- 备份数据库应在停服后复制整个 `data/`，或使用SQLite在线备份工具；不要只复制正在写入的主库文件而遗漏WAL。
- 本次未包含会员支付、销售、邮件服务、密码找回或公网部署。

### 可信代理与认证限流

默认`TRUSTED_PROXIES`为空，按直连地址限流，忽略伪造的转发头。Cloudflare Tunnel在同机运行时配置`TRUSTED_PROXIES=127.0.0.1/32,::1/128`及`CLIENT_IP_HEADER=cf-connecting-ip`，仅来自这些实际socket地址且携带合法单一CF-Connecting-IP的请求按访客IP计数；缺失或非法头回退到直连地址，不采用X-Forwarded-For绕过。登录与注册共享同一访客每10分钟60次额度。

必须保持源服务仅监听127.0.0.1，并把本机其他进程视为此信任边界内。若代理来自容器或其他机器，填写实际代理的精确IP/CIDR，并由防火墙限制源站访问，不要信任全部地址、任意跳数或整个私网。其他反向代理可设置`CLIENT_IP_HEADER=x-forwarded-for`；代理须清理或正确追加转发链，Express从最近的非可信跳确定客户端。原Host/Origin校验、Cookie和作品所有权校验保留。

`public:start`自建服务时会配置本机cloudflared边界；复用的既有服务不会被在线改配置，启用修复需按上述配置重启服务。本轮未重启或重新部署公网Tunnel。规则依据：[Express可信代理](https://expressjs.com/en/guide/behind-proxies/)、[Cloudflare请求头](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip)。

## 源码入口

| 文件 | 职责 |
| --- | --- |
| `src/App.tsx` | 工作台、命令、历史与对话框协调 |
| `src/model.ts` | 网格、项目版本、RLE校验、变换与用量 |
| `src/prepare-image.ts`、`conversion-core.ts`、`convert.worker.ts` | 原图构图、普通采样/匹配和Worker调度 |
| `src/small-pattern.ts`、`reference-detection.ts`、`reference-recognition.ts` | 小图、轮廓、网格检测及格内主色识别 |
| `src/export-layout.ts`、`export.worker.ts` | 公开排版规则、PNG条带编码、色卡与分板 |
| `src/bead-list.ts`、`bead-list-images.ts`、`components/BeadListDialog.tsx` | 用豆清单统计、文字/CSV、分页图片及手机界面 |
| `src/material-catalog.ts`、`components/MaterialSettings.tsx` | 色卡来源版本、已核对组合及独立规格选择 |
| `src/components/CanvasEditor.tsx` | 画布渲染、指针编辑、选区与视图 |
| `src/components/ImportDialog.tsx` | 导入、裁剪与构图预览 |
| `src/storage.ts` | IndexedDB、图片解码和文件下载 |
| `server/index.mjs` | 独立认证、SQLite与作品接口 |

界面和导出图纸的品牌文字在 `src/model.ts` 的 `BRAND`；浏览器标题在 `index.html`。Logo为可替换的图标组件，主题在 `src/styles.css` 的根变量；工作台布局在`src/workbench.css`，专用弹窗布局在`src/editor-dialogs.css`，采购界面在`src/bead-list.css`。默认示例为《原神》雷电将军，采用本地内置角色立绘与现有算法转换的208×192格、64色色卡图纸；仅在无草稿时显示，不替换已有作品。未整体引入开源候选项目，也未复制原站打包脚本或样式作为运行工程。数据来源与第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

仓库不提交本机数据库、账号会话、`.env`、Tunnel记录、运行日志、上传原图、历史截图或构建缓存；`dist/`通过构建生成。单元测试所需的最小色卡数据和去掉原图的旧项目网格保存在`tests/fixtures/`，`npm test`不依赖本机归档。

## 验证与对照

4项数据与代理修复的定向回归（临时数据库、独立浏览器；不更新当前公网构建）：

```sh
npm run check
npm run build -- --outDir .local-public/review-build
node --import tsx --test tests/core.test.ts tests/bead-list.test.ts tests/cloud-sync.test.ts tests/server-regressions.test.ts
TEST_BUILD_DIR=.local-public/review-build node scripts/review-fixes-regression.mjs
```

浏览器脚本会创建并清理独立临时服务和数据，不连接现有用户数据库。生成取消/失败使用浏览器侧故障注入；代理检查通过本地临时服务模拟可信/不可信连接，不表示已重新部署真实Tunnel。

```sh
npm test
npx playwright install chromium
npm run test:browser
TEST_URL=http://127.0.0.1:4173 node scripts/large-export-regression.mjs
TEST_URL=http://127.0.0.1:4173 node scripts/final-affected-regression.mjs
```

`npm run test:browser`使用临时服务、数据库和独立浏览器检查作品与账号保存闭环；默认测试dist，可用TEST_BUILD_DIR指定隔离构建。其余v1.1浏览器脚本为历史开发记录，依赖旧布局，不能代表v1.3验收。部分历史脚本及`npm run test:parity`需要原开发目录的`verification/`逆向快照、上传素材或截图。这些本地归档未提交到GitHub，单独克隆仓库不含历史对照证据。需要使用时提供自己的素材并恢复对应归档；常规启动、构建及`npm test`无需归档。运行应用本身不加载逆向脚本。

v1.2清单验证见 `verification/bead-list-20261017/results.json`、真实下载成品及桌面/手机截图。独立解码bamboo旧文件得到96色、22400颗；上传透明图后320有效格、704空格；替色、擦除、裁剪、撤销重做和项目导入/刷新已实际操作。页面、原生粘贴核对的文字、CSV和PNG共享清单数据一致，10%备用建议24692颗。类型/构建与有关数据测试通过；未做实体手机、所有浏览器或实物采购验收。

此前v1.1证据在 `verification/v1.1-reference/`、`v1.1-comparison/` 和 `v1.1-regression/`。同视口、同素材和同参数的真实原站/本地截图与算法逐格对照分开记录，不能互相替代。旧版生成中原站截图已废止为完整画布对照依据。详细验证边界见 `verification/README.md`；仍未修复的差异见 `DIFFERENCES.md`。
