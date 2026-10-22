import { useEffect, useState, useRef } from "react";
import Dialog from "./Dialog";
import { api } from "../api";
import { accountLabel, type AccountUser } from "../account";
type Props = {
  user: AccountUser | null;
  onUser: (u: AccountUser | null) => Promise<void>;
  onClose: () => void;
  onWorks: () => void;
};
export default function AccountDialog({
  user,
  onUser,
  onClose,
  onWorks,
}: Props) {
  const [info, setInfo] = useState<any>(null),
    [policy, setPolicy] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const currentUser = useRef(user);
  currentUser.current = user;
  const u = info?.user?.id === user?.id ? info?.user : user;
  async function load() {
    const owner = currentUser.current?.id;
    setError("");
    const p = await api("/policy");
    if (owner !== currentUser.current?.id) return;
    setPolicy(p);
    if (user) {
      const a = await api("/account");
      if (a.user.id !== user.id)
        throw Error("登录身份已改变，请重新打开账号模块");
      if (owner !== currentUser.current?.id) return;
      setInfo(a);
      await onUser(a.user);
    }
  }
  useEffect(() => {
    setInfo(null);
    setLoading(true);
    let alive = true;
    load()
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={u ? "拼豆账号与权益" : "使用公共账号登录"} onClose={onClose}>
      <div className="account-flow" aria-busy={busy || loading}>
        {loading && <p role="status">正在读取公共账号权益与任务…</p>}
        {error && (
          <p className="error" role="alert">
            {error}{" "}
            <button disabled={busy} onClick={() => run(load)}>
              重试读取
            </button>
          </p>
        )}
        {!u ? (
          <>
            <p>
              使用臻一公共账号。已有公共账号可直接登录，新用户在统一认证页注册。
            </p>
            <p className="hint">
              本地裁剪、转换、编辑和项目备份可继续使用。登录后的作品与任务按账号隔离。
            </p>
            <a className="primary button-link" href="/auth/login">
              登录／注册公共账号
            </a>
          </>
        ) : (
          <>
            <div className="account-summary">
              <h3>
                {u.username} · {accountLabel(u)}
              </h3>
              <p>
                统一UID：<span className="micro">{u.uid}</span>
              </p>
              <p>
                拼豆会员到期：
                {u.memberUntil
                  ? new Date(u.memberUntil).toLocaleString()
                  : "未开通"}
              </p>
              <p>
                导出剩余次数：<b>{u.freeCredits}</b> 次 · 预占{" "}
                <b>{u.heldCredits || 0}</b> 次
              </p>
              <p>
                {u.exportAccess
                  ? "中心已允许“会员免次导出”权限。"
                  : "当前按“图纸导出次数”计次，每个任务1次。会员状态与次数单独读取。"}
              </p>
            </div>
            <div className="account-links">
              <button onClick={onWorks}>我的作品</button>
              <a href={policy?.redeemUrl}>会员／兑换</a>
              <a href={policy?.securityUrl}>账号与安全</a>
            </div>
            <div className="account-links">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("/logout", { method: "POST" });
                    setInfo(null);
                    await onUser(null);
                    onClose();
                  })
                }
              >
                退出当前拼豆
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("/logout", { method: "POST" });
                    setInfo(null);
                    await onUser(null);
                    location.assign("/auth/login?switch=1");
                  })
                }
              >
                切换公共账号
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (!confirm("退出公共账号的全部产品会话？")) return;
                    await api("/logout-all", { method: "POST" });
                    setInfo(null);
                    await onUser(null);
                    onClose();
                  })
                }
              >
                退出全部产品
              </button>
            </div>
            <details open>
              <summary>最近导出与任务恢复</summary>
              {loading ? (
                <p className="muted">正在读取任务…</p>
              ) : info?.jobs?.length ? (
                info.jobs.map((j: any) => (
                  <div key={j.id} className="account-job">
                    <p>
                      {j.filename || j.kind} ·{" "}
                      {(
                        {
                          ready: "文件可下载",
                          reserved: "生成中／待提交",
                          pending_recovery: "结果未知，正在恢复",
                          cancelled: "已取消",
                          expired: "预占已到期",
                          refunded: "已返还",
                          rejected: "权益拒绝",
                          initiating: "核对中",
                        } as Record<string, string>
                      )[j.status] || j.status}
                    </p>
                    <p className="micro">{j.requestId}</p>
                    {j.status === "ready" ? (
                      <>
                        <a href={"/api/exports/" + j.id + "/download"} download>
                          再次下载
                        </a>{" "}
                        ·{" "}
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={"/api/exports/" + j.id + "/download?preview=1"}
                        >
                          备用文件
                        </a>
                      </>
                    ) : ["reserved", "initiating", "pending_recovery"].includes(
                        j.status,
                      ) ? (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api("/exports/" + j.id);
                              await load();
                            })
                          }
                        >
                          查询原任务
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api("/exports/" + j.id + "/cancel", {
                                method: "POST",
                                body: JSON.stringify({ expectedUserId: u.id }),
                              });
                              await load();
                            })
                          }
                        >
                          取消未提交任务
                        </button>
                      </>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="muted">暂无导出任务</p>
              )}
            </details>
          </>
        )}
        <p className="micro">
          账号、会员和次数由公共中心管理。拼豆不保存密码或维护另一套会员账本。中心暂不可用时，当前编辑内容保留，受控功能需稍后重试。
        </p>
      </div>
    </Dialog>
  );
}
