# BeadGrid Studio 首次部署与域名接入记录（v1.4历史）

部署及域名启用日期：2026-10-20（北京时间）。应用版本 **1.4.0**，远端默认分支 **main**。

完整提交：`f7f97e77c592c449db6a6eb01220cf6cb10c2acc`。
仓库：<https://github.com/JokerMok/beadgrid-studio>。
发布：`20261020T012905Z-f7f97e77c592`。

本记录描述首次v1.4部署，当时未包含本机v1.5修改。后续实时运行版本以正式站点`/deployment.json`和服务器PROJECT.md为准，本页不作为当前提交SHA的唯一依据。
源码归档SHA256：`c0286ee8dcb825d5bf3952506e265c6be73c92b5ad5fffed67b897a4d123be34`。
Node Linux x64运行时v24.22.0，官方归档SHA256：`cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008`。

## 当前入口

正式入口：<https://pindou.shizibandu.icu/>。HTTP自动308跳转到HTTPS，Caddy签发并维护Let’s Encrypt证书（SAN=pindou.shizibandu.icu，本次签发到期2027-01-18）。Mac、SSH或Codex关闭不影响公网服务。

DNSPod仅新增pindou A记录175.178.236.56，TTL600，无AAAA；主域名、www等记录未修改。腾讯云备案控制台显示主域名及腾讯云接入状态正常；备案关联云资源IP与当前部署IP不同，未变更备案记录。系统与云端仅新增IPv4 TCP80/443，SSH原规则保留。

服务器：`tencent-main`；项目 `/srv/apps/beadgrid-studio/`。
Caddy `127.0.0.1:18081`；API `127.0.0.1:18871`；内部端口均未向公网监听；公网只开放Caddy80/443。既有ops-check及防火墙SSH规则保持原配置。

## 实际结果

本次域名回归：真实Chromium默认校验证书通过，HTTP跳转、SPA刷新、bamboo上传生成、CSV/清单PNG实际下载、草稿恢复、HTTPS注册登录、安全Cookie、账号保存/隔离、同源资源/Worker及来源校验通过，无页面错误。证据：`verification/tencent-domain/results.json`；原内部部署证据继续保留。

- 服务器入口页面、SPA刷新及准确提交版本
- 真实上传、Worker转换、用量守恒、CSV/清单图片实际下载及刷新恢复
- 注册、登录、账号作品保存、服务重启后数据持久化及账号隔离
- 同源API、跨站写入拒绝与认证校验
- 静态资源及Worker成功加载、无页面错误、无外部或错误localhost请求
- SQLite在线backup及独立内存库恢复后integrity_check通过；备份钩子已接入既有日备份任务。
- 专用测试账号、会话与作品按准确ID/账号清理，没有复制本机私人数据，也未清理其他账号的数据。
- systemd已启用，项目服务重启后账号作品和同步版本仍保留；未进行整机重启。

原始运行结果、实际下载及截图：`verification/tencent-deploy/`。页面请求仅来自18181同源入口。类型检查与构建使用此SHA的干净源码，未重复整站算法或无关全量回归。

首次部署没有历史previous。后续更新保留旧release并在启用失败时回退代码/配置；本次没有触发生产故障回退，也没有数据库迁移。SQLite备份仅在同一服务器，尚无异机备份。公网域名及HTTPS已完成，TCP80/443已放行。生产Cookie设置Secure/HttpOnly/SameSite=Strict，API同源。

## 更新

在本地仓库根目录执行 `bash deploy/tencent/deploy.sh`，默认部署远端默认分支最新提交；也可传入已存在于origin的完整SHA。详细步骤、数据边界及回退说明见[README.md](README.md)。不要在脏工作树直接打包源码，也不要把本机data/.env传到服务器。
