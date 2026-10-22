# 公共账号正式接入

依据：zhenyi-account-center `237e220ffac3db134982a56b3b7997f13eaff4a1` 的 production-integration/api/integration.md及examples/product-client.ts；正式机与远端文档一致。生产issuer固定，OIDC应用zhenyi-beadgrid、组织consumers，授权码+PKCE S256、RS256、JWT-Standard，唯一精确回调https://pindou.shizibandu.icu/auth/callback/beadgrid。

中心仅新增beadgrid机器登记及专属环境键CASDOOR_BEADGRID_CLIENT_ID、CASDOOR_BEADGRID_CLIENT_SECRET、BEADGRID_SERVICE_KEY；产品只获得该三项和公开URL，不获得中心app.env、管理员凭据或数据库权限。register-accounts.mjs是root运维登记工具，不能由产品进程调用；使用中心官方API和同一后台业务服务保存规则/审计，不运行setup/npm start。配置前调用现有backup，修改受中心operation.lock保护。正式中心仅重启center，无身份/数据库停机迁移。

本地旧密码模块已移除；旧登录/注册/改密/找回/兑换/管理接口明确410。新SQLite user_version=3：identities仅UID/issuer/subject/显示名关联，sessions存token hash与后端access token，login_attempts一次性登录尝试；works和export_jobs都是本产品数据，无会员账本。旧含users表数据库拒绝自动迁移；授权清理通过切换前备份及精确目录替换完成。

详细功能映射见README。保持原本机普通免费0次、会员免次规则，但免次是独立access配置，不从member布尔值推断。中心api拒绝时不退回旧账号或默认会员。中心不可用保留图纸与本地草稿，敏感API返回可重试错误。

计次任务持久化：initiating → reserved → staged(intent=deliver) → ready；中心结果未知pending_recovery。request_key按当前身份限定，business_id后端UUID全局唯一。重复HTTP/上传、同号参数不一致、跨用户下载、完成后取消不会重复扣/退。文件写入临时路径后原子改名，记录哈希，再确认；确认前失败取消，确认后服务端检测文件缺失/校验失败返还。后台恢复仅定位现有任务，不支持新预占或任意UID；未知结果不发文件、不确定退款。已退出用户不阻塞恢复。最长预占依据中心5分钟，过期任务需明确重新生成。

浏览器算法公开，受控API保护服务交付，不声称保护用户自行编写的离线导出。采购CSV/清单和项目备份继续本地生成，不被擅自纳入计次。重启恢复与网络故障使用隔离服务验证；公网不会注入任意真实故障或修改其他产品权益。

Caddy只将拼豆/auth/*及/admin转给同源后端，不接受任意返回地址。拼豆/auth/*跳过访问日志；中心仅对/api/v1/products/beadgrid/\*跳过访问日志，避免X-User-Token自定义头进入日志；中心账目审计继续保留。生产环境、数据库与文件不在静态目录。产品凭据不进入VITE变量、Git、命令参数或日志。
