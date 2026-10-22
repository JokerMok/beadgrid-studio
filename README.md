# 豆格工坊 · BeadGrid Studio

React / TypeScript / Vite 拼豆工作台，Node.js / SQLite保存本产品作品、会话和任务。v1.7使用已上线的臻一公共账号中心；保留本机v1.6的全部制图引擎、深色紫色UI、雷电将军原图、固定221色卡与项目文件兼容。不保存本地密码，不运行第二套会员账本。

- 产品：https://pindou.shizibandu.icu/
- 公共个人中心：https://accounts.shizibandu.icu/?product=beadgrid
- 唯一运营后台：https://accounts.shizibandu.icu/admin
- 可信issuer：https://identity.accounts.shizibandu.icu

## 运行与配置

Node.js ≥22.13。`npm ci`、`npm run build`，然后通过服务端私密环境文件启动 `npm start`。必须配置 `.env.example` 中八项账号参数，缺失时拒绝启动，不回退旧账号。生产使用独立系统用户、回环监听和Caddy HTTPS，详见 [部署](deploy/tencent/README.md) 与 [账号接入](docs/accounts-integration.md)。开发前端 `npm run dev`；本机账号测试使用隔离OIDC/权益测试服务，不复用生产中心数据库或管理员凭据。

本轮制图能力：原图保留与裁剪、完整放入/填满、真实Worker预览、长边/精确网格/比例联动、网格编辑与撤销重做、生成基准保存恢复、普通/手搓双候选、马赛克、8种熨烫、底图识别/网格校准、全图/区域禁色、独立图纸调节，以及图纸/镜像/色卡/分板/项目/采购清单导出。输出网格与物理分板分开，暗色UI不改变图纸颜色。屏幕RGB不是实物校色，规格来源见COLOR_CATALOG.md。

## 账号与权益

登录/注册跳转公共认证，精确回调 `/auth/callback/beadgrid`。标准 `openid-client` 完成授权码、一次性state/nonce、PKCE S256、RS256签名、issuer/audience/时效校验。access token只存后端，使用中心identity取得UID，本产品只保存可信UID关联和自己的作品。生产Cookie `__Host-beadgrid_session`，Secure/HttpOnly/SameSite=Lax，无Domain。

本产品账号菜单提供当前账号、拼豆会员期限、剩余/预占次数、我的作品、会员兑换、账号安全、切换账号、本产品退出和全局退出。改密、找回、邀请码等由公共中心的实际能力提供，产品不再维护本地密码、兑换或管理员接口。未配置的邮件能力由中心如实提示。运营后台需要中心现有管理员；没有拼豆默认管理员密码。

| 功能 | 中心标识 | 正式规则 |
|---|---|---|
| 浏览器转换/裁剪/编辑、项目备份 | 本地能力 | 免费，保留离线计算；不能声称防止用户改JS绕过 |
| 登录后配色/清单 | studio / access | 普通登录账号可用，不要求会员 |
| 账号作品 | cloud / access | 普通登录账号可用，所有权按可信会话隔离 |
| 会员免次导出 | export_member / access | 显式中心权限，需要本产品有效会员；每次交付重新校验 |
| 普通图纸导出 | export / quota | 无免次权限时每个任务预占1次；免费初始额度维持原本机0，不新设赠送 |

会员字段本身不授予无限次数；只有中心显式允许export_member时走免次路径，否则仍检查export次数。别的产品会员不会授予拼豆权限。中心可按业务调整/停用功能。会员开通与次数赠送是两个独立后台操作，无支付接入。后台“业务产品/功能规则”中可见上述定义，“用户与权益”选择拼豆后分别开通会员天数、赠送export次数；填写原因。兑换入口使用已核对的 `?product=beadgrid&tab=redeem`。

## 任务与数据

计次导出由服务端保管文件并控制领取。后端先保存稳定业务号，再预占；浏览器生成后上传暂存，确认账目后提供下载。网络超时/5xx/不完整响应标记pending_recovery；先查询原预占，确认响应丢失不当作失败。30秒恢复任务在用户退出/令牌失效后仍用受限产品恢复接口核实；确认前取消、确认后服务端核实文件缺失才返还。浏览器报告“失败”不能直接退款。既有完整产物重复领取不再计次。中心预占5分钟，不提供无限续租；无法核实时保留待恢复状态。

`.bead.json`仍为schema1、固定paletteCodes和RLE网格。原图、确认生成基准、候选与区域规则保留；导出不包含同步凭据。新素材新ID，参数重新生成原ID，手改覆盖前提醒并留副本。清空切换到真实拼豆视图，空图默认拦截，空白模板单独选择。

本轮获授权清空旧拼豆数据，不迁移旧账号/作品/会员。切换前一致备份SQLite、配置、原业务目录；旧数据保存在私密回退快照，不进入新业务表。浏览器采用新缓存命名空间；首次打开新版本将旧xing-local-v1隔离备份到 `beadgrid-quarantined-legacy-backup-v1` 后删除旧库，清理本产品旧标记，不触及其他产品存储。隔离备份不作为草稿/作品来源，旧窗口阻塞删除时新版本也不会读取旧库。不同账号的当前草稿分区，中心异常保留编辑内容，不自动上传前个账号作品。

## 验证

```sh
npm run check
npm run build:local
npm run test:accounts
node --import tsx --test tests/product-flow.test.ts tests/cloud-sync.test.ts tests/import-grid.test.ts tests/bead-list.test.ts tests/core.test.ts
```

OIDC/权益测试使用临时数据，涵盖签名/nonce/一次回调、用户隔离、并发同号、超时未知、服务重启与退出后恢复、重复下载及取消幂等。公网回归脚本使用私密指定的两个专用消费者，绝不修改其他真实产品。历史v1.6本地密码测试脚本仅为旧证据，不能用于v1.7。实际部署SHA与结果见deploy/tencent/DEPLOYED.md；详细公开规则及边界见DIFFERENCES.md。
