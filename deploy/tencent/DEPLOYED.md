# 拼豆v1.7公共账号上线

日期：2026-10-22（北京时间）。正式入口https://pindou.shizibandu.icu/，准确当前提交见正式`/deployment.json`与服务器current/RELEASE.json，服务器PROJECT.md记录同一SHA。首次账号切换提交c1404b11f0bd3d8785b86cb259c74c226a821a78；随后定向修正权限检查、旧缓存入口及加载反馈，使用同一Git提交干净构建发布。

旧拼豆数据已按授权清空新业务目录，无账号/作品/会员迁移。切换前一致SQLite备份和原目录：`/srv/apps/beadgrid-studio/shared/config/rollbacks/20261022T013056Z-c1404b11f0bd/`，包含business/beadgrid-studio/studio.sqlite、legacy-data、legacy-uploads及旧环境/服务/站点和old-release。旧库integrity_check=ok，旧作品1条；新库独立identities/sessions/login_attempts/works/export_jobs，无旧users/password或会员账本。保留v1.5旧代码和可用回退脚本，未实际回切生产。

公共中心配置前备份`/srv/backups/zhenyi-accounts/manual-2026-10-22T01-12-49-290Z-d7e808.tar.gz`；仅登记beadgrid应用/产品/功能及其私密键，源码仍237e220ffac3db134982a56b3b7997f13eaff4a1，未改其他真实产品。只有center按需重启。产品进程不持有中心数据库或管理员凭据，独立__Host-会话及用户UID关联。

真实公网专用A/B消费者验证注册、现有账号登录、回调/刷新、作品越权、身份切换；统一后台同一业务服务开通A会员、B次数并保留审计；以QA用户服务端真实3秒到期验证降级，无前端改时间。完整图纸、马赛克、色卡、物理拼板、分区、CSV/清单图片、项目文件实际下载解码。普通计次任务重复请求、取消、提交响应丢失和重复领取验证。后台未知确认响应与退出后恢复另由隔离测试验证，不在生产给全中心注入故障。

证据：verification/accounts-integration-20261022/中的browser-results.json、followup-results.json、final-results.json、截图和真实downloads；未纳入Git的私密浏览器会话/QA口令位于.local-public/account-integration，只用于验收。原本机4个旧业务数据目录已停相应服务、一致备份及归档，记录在.local-public/account-integration/legacy-local-data-20261022T013853Z/MANIFEST.json；旧项目Tunnel已停止，不影响其他项目Tunnel。

规则：本地编辑/备份不计次；studio/cloud access向所有正常登录消费者开放；export_member为独立会员免次access；否则export按每任务1次，初始免费0保持旧本机规则。会员和次数分别管理，不把其他产品会员或单个member布尔值当无限次数。后台“用户与权益”选拼豆，分别“开通会员”和“赠送额度（export）”，原因必填；兑换仍在中心tab=redeem。未接真实支付，邮件/短信外部配置沿中心现状。
