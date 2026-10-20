# 腾讯云部署

目标：`ssh tencent-main`，项目独占 `/srv/apps/beadgrid-studio`。先读本机 `~/server-ops/tencent-main/SERVER.md`，并核对服务器 `/srv/ops/SERVER.md` 和项目 `PROJECT.md`。

正式入口：https://pindou.shizibandu.icu/，DNSPod A记录175.178.236.56、TTL600；Caddy自动HTTPS并将HTTP跳转到HTTPS。网站由服务器systemd和Caddy常驻运行，不依赖Mac或SSH隧道。

## 域名配置

腾讯云备案控制台已核对主域名状态正常、存在腾讯云接入；备案关联资源IP与部署IP不同，未修改备案信息。仅新增pindou解析，主域名、www及其他记录不变。系统与云端只新增IPv4 TCP80/443，API18871、内部Caddy18081、数据库和管理接口保持不公开。HTTPS证书和私钥由Caddy管理，未复制到仓库。

当前公开入口配置已合并进beadgrid-studio.caddy，后续正常部署不会退回仅SSH模式。域名启用脚本enable-domain.sh须在DNS/备案/云防火墙核对完成后在服务器运行；启用前备份配置和SQLite，失败恢复原站点及环境配置。

## 更新

在仓库根目录运行：

```sh
bash deploy/tencent/deploy.sh
# 或指定已经在 origin 上的完整提交 SHA：
bash deploy/tencent/deploy.sh <SHA>
```

脚本从 Git 配置检查 origin，未指定提交时查询远端默认分支，再 fetch 并固定准确 SHA。通过 `git archive` 取得干净源码，按该提交锁文件安装依赖、正式构建，只传输 dist、后端源码与依赖清单。工作树里的 v1.5 等未提交应用修改不会参与部署。部署脚本与 systemd/Caddy 模板属于运维配置，单独复制到 release 的 `ops/`。

服务器 GitHub 拉取不是必需条件。源码在本机取得，上传包及官方 Linux x64 Node v24.22.0 压缩包均校验 SHA256。Node 原始校验表：<https://nodejs.org/dist/v24.22.0/SHASUMS256.txt>。后端生产依赖在每个新 release 中按锁文件安装，不覆盖旧 release。

每次新建 `releases/<UTC时间>-<12位SHA>/`，`RELEASE.json` 和 `/deployment.json` 记录完整 SHA、源归档校验、应用版本与构建环境。候选健康通过后切换 current 并验证 Caddy；后续部署保留 previous。首次部署没有上一份历史版本。启用失败自动恢复旧代码/服务/站点配置，数据库不自动倒退。

若后端源码变化，脚本在启用前停止，要求审查数据库兼容性。确认没有不兼容迁移，或已单独完成迁移与恢复方案后才使用 `DB_CHANGE_REVIEWED=1 bash deploy/tencent/deploy.sh <SHA>`。这个开关不执行或撤销迁移。

更新后检查页面、上传生成、用豆清单下载及必要 API，核对 `/deployment.json`；更新服务器 `PROJECT.md`、`/srv/ops/SERVER.md`，并把后者同步回本机 `~/server-ops/tencent-main/SERVER.md`。首次实际部署结果见项目内 `DEPLOYED.md`。

## 访问与维护

```sh
bash deploy/tencent/access.sh start    # 仅内部诊断入口；正式访问使用HTTPS域名
bash deploy/tencent/access.sh status
bash deploy/tencent/access.sh stop     # 仅关闭本项目 SSH 隧道
ssh tencent-main 'sudo systemctl status beadgrid-studio --no-pager'
ssh tencent-main 'sudo journalctl -u beadgrid-studio -n 60 --no-pager'
```

Mac 18181 → SSH → 服务器 Caddy `127.0.0.1:18081` → API `127.0.0.1:18871`。静态文件由 Caddy 正式服务，不运行 Vite。前端 API 使用同源 `/api`，没有指向访问者 localhost 的跨站后端请求。生产Cookie已设置COOKIE_SECURE=1，使用Secure/HttpOnly/SameSite=Strict；账号操作使用正式HTTPS入口。旧HTTP隧道仅保留作诊断，不作为正式账号入口。

生产配置 `shared/config/app.env`（root 0600），SQLite `shared/data/studio.sqlite`（beadgrid 专用系统用户，目录0700）。本项目图片保存在浏览器或账号作品 JSON 内，当前没有服务器独立上传接口；预留 `shared/uploads`。不上传本机数据库、账号、.env 或私人作品。发布不会覆盖这些路径。

Caddy 覆盖 X-Forwarded-For，并移除 CF-Connecting-IP；后端只信任精确 loopback 代理，沿用来源检查和账号校验。公网直连Caddy时使用真实连接地址；伪造的客户端转发头会被Caddy覆盖。内部SSH诊断访问仍表现为loopback。

## 备份与回退

SQLite 通过在线 backup API 生成一致性备份并做 integrity_check，接入现有 `/etc/server-ops/backup.d/beadgrid-studio.sh`。更新已有项目之前另存一份一致性数据库备份及私有配置快照到 `shared/config/rollbacks/<release>/`。配置/业务日备份由既有 server-config-backup.timer 统一运行，仍受服务器容量预算约束；同机备份不能替代异机备份。

```sh
bash deploy/tencent/rollback.sh
```

回退脚本只在 previous 存在且后端相同的情况下切换代码，保留数据库；不同后端必须先单独核对迁移兼容性。手工数据库恢复前先停本项目服务、保存当前数据库及 WAL，恢复一致性备份后校验，再启动；不能把当前运行数据库文件直接覆盖。

禁止运行全局 prune、down -v、删除 shared 或停止其他项目。服务日志在 journald；访问日志 `/var/log/caddy/beadgrid-studio-access.log` 使用既有轮转规则。
