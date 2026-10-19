# 临时公网外测

本项目使用Cloudflare Quick Tunnel将当前生产服务 `http://127.0.0.1:4173` 暴露为临时HTTPS地址。当前版本1.2.0。最新地址保存在 `.local-public/URL.txt`，进程及日志路径保存在 `.local-public/runtime.json`。

首次外测复用既有服务。2026-10-19重启时原服务已不在监听，现已由管理脚本重新启动本地服务和Tunnel；当前PID与地址以runtime.json为准，不改变其他项目的Tunnel、Cloudflare配置或Vite Host规则。4173由Express同时提供dist页面、静态资源和`/api`，浏览器API使用同源路径；不是Vite预览服务，因此无需增加allowedHosts。

## 启动、查看及停止

在本项目根目录执行：

```sh
npm run public:start
npm run public:status
npm run public:stop
npm run public:restart
```

- `public:start`：检查端口进程所属目录和当前构建，复用正确服务；没有服务时启动本项目生产服务。复用仍正常的本项目Tunnel，不重复创建。已安装的cloudflared直接使用。
- `public:status`：显示最新公网地址、版本、PID、进程存活、本地首页/API状态、日志路径。
- `public:stop`：只停止runtime记录且PID、启动时间、完整命令和工作目录均一致的本项目自建进程。复用的服务会保留；**当前10月19日启动的服务和Tunnel均为本项目自建，停止会关闭两者**。不会按进程名批量结束其他Tunnel或Node进程。
- `public:restart`：先停止本项目管理的进程再启动，最新地址以命令输出或URL.txt为准。Quick Tunnel重新创建后域名可能变化。

若修改网站源码，先 `npm run build`，再刷新访问；本次服务直接读取dist。不要同时另开相同4173端口服务。

## 日志与持续运行

- `.local-public/logs/tunnel-*.log`：本项目每次Tunnel启动和连接日志。
- `.local-public/runtime.json`：本地服务/Tunnel的PID、启动时间、命令、工作目录、创建归属和最新地址。
- `.local-public/service-observations.log`：本项目复用服务的核对及启停记录。首次复用的服务stdout原为管道；当前脚本自建服务的完整stdout/stderr记录为`logs/server-*.log`。
- `.local-public/http-check.log`、`verification/public-tunnel-20261017/`：首次外测HTTP检查及当时部分完成的浏览器记录。
- `verification/public-tunnel-20261018/`：授权独立测试浏览器后完成的公网交互结果、截图及实际下载文件。

Tunnel以独立会话后台运行，关闭本轮聊天不会主动停止。电脑休眠、断网、服务或Tunnel停止后，临时链接可能不可用；恢复或重新创建Tunnel时地址可能变化。此方式用于临时检查，不是持续在线的正式部署。规则依据：[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。

## 访问与账号

上传图片、转换、编辑、本地保存、用豆清单、CSV及清单图片均无需登录，不准备或公开私人账号。图片在访问者浏览器中处理。本地IndexedDB草稿按域名隔离，因此公网地址不会自动出现127.0.0.1下的本地作品；可上传图片或导入`.bead.json`继续检查。独立账号/云作品仍有原有鉴权，匿名访问作品API应为401。

公网链接可交给ChatGPT检查，但不同ChatGPT环境能否执行JavaScript、操作画布或下载文件取决于其浏览工具，不能把它只读取首页HTML当作交互测试完成。

## 本次检查结果与边界

2026-10-17：HTTPS首页、全部JS/CSS及两个Worker与本地dist逐字节相同。公开`/api/health`、`/api/me`及同源POST正常；匿名作品API为401，错误Origin为403，未放松来源校验。真实浏览器已打开公网工作台并选入竹林JPEG、显示原图预览。

2026-10-18：用户明确允许独立Playwright浏览器后，在1440×1000视口、全新浏览器存储中直接访问公网HTTPS地址，完成竹林人物JPEG上传、200×112完整置入、221最大颜色数、去浅色边缘、无杂色合并及边缘强化的生成流程。实际结果96色、22,400颗、0空格；与此前样本独立RLE解码逐格比较，色号差异为0。

实际下载了可编辑项目文件、含UTF-8 BOM的CSV及三页清单图片ZIP；页面逐色数量、CSV、ZIP清单数据和当前图纸一致。三张PNG均实际解码通过，尺寸1240×1900，末页目检无截断。保存、刷新和再次导出后的网格、稳定色号映射、作品名及规格一致。公网页面发出的11个HTTP请求均为同一公网域名，包含转换Worker与`/api`；无localhost请求、失败请求、HTTP错误或浏览器脚本/控制台错误。无需登录。

最新证据见 `verification/public-tunnel-20261018/results.json`、同目录截图和downloads。可在本项目目录运行 `TEST_IMAGE=/path/to/bamboo-source.jpg node scripts/check-public-browser.mjs` 复核当前runtime记录的公网地址。此次验证为临时公网桌面核心闭环，不是持续在线部署、实体手机或实物采购验收；此前的部分完成记录保留，不替代本次结果。
