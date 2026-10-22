import express from "express";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import { installAccounts } from "./accounts.mjs";
import { installExports } from "./exports.mjs";
const envFile =
  process.env.ENV_FILE === "none" ? null : process.env.ENV_FILE || ".env";
if (envFile && fs.existsSync(envFile)) process.loadEnvFile(envFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(dataDir, "studio.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
);
if (
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    )
    .get()
)
  throw Error(
    "Legacy beadgrid database found. Back up and switch to a new, empty product data directory; no automatic migration.",
  );
const app = express();
const trustedProxies = (process.env.TRUSTED_PROXIES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const clientIpHeader = process.env.CLIENT_IP_HEADER || "cf-connecting-ip";
if (!["cf-connecting-ip", "x-forwarded-for"].includes(clientIpHeader))
  throw Error("CLIENT_IP_HEADER只能为cf-connecting-ip或x-forwarded-for");
// Exact proxy addresses/CIDRs only; direct connections trust no forwarding headers.
app.set("trust proxy", trustedProxies.length ? trustedProxies : false);
function clientAddress(req) {
  const peer = req.socket.remoteAddress;
  const trusted = app.get("trust proxy fn")(peer, 0);
  const forwarded = req.get("cf-connecting-ip");
  const address =
    clientIpHeader === "cf-connecting-ip"
      ? trusted && isIP(forwarded || "")
        ? forwarded
        : peer
      : req.ip;
  if (!isIP(address || "") || address.includes("%")) return peer;
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4)
    return address.slice(7);
  return isIP(address) === 6
    ? new URL(`http://[${address}]/`).hostname.slice(1, -1)
    : address;
}
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin")) {
    try {
      if (
        new URL(req.get("origin")).host !== req.get("host") &&
        !(process.env.ALLOWED_ORIGINS || "")
          .split(",")
          .includes(req.get("origin"))
      )
        return res.status(403).json({ error: "不允许跨站写入" });
    } catch {
      return res.status(403).json({ error: "来源无效" });
    }
  }
  next();
});
app.use(express.json({ limit: "64mb" }));
const attempts = new Map();
function rate(req, res, next) {
  const now = Date.now(),
    key = clientAddress(req);
  let a = attempts.get(key);
  if (!a || now - a.start > 600000) {
    a = { start: now, count: 0 };
    attempts.set(key, a);
  }
  if (++a.count > 60)
    return res.status(429).json({ error: "操作频繁，请稍后再试" });
  if (attempts.size > 5000)
    for (const [k, v] of attempts)
      if (now - v.start > 600000) attempts.delete(k);
  next();
}
app.get("/api/health", (_, res) => res.json({ ok: true, authMode: "oidc" }));
const accounts = installAccounts({ app, db, rate }),
  auth = accounts.auth;
installExports({ app, db, dataDir, accounts });
function validateProject(v) {
  if (
    !v ||
    v.schemaVersion !== 1 ||
    v.paletteVersion !== "xing-public-221-20261016-v1"
  )
    throw Error("项目版本无效");
  if (
    !Number.isInteger(v.width) ||
    !Number.isInteger(v.height) ||
    v.width < 16 ||
    v.width > 1000 ||
    v.height < 16 ||
    v.height > 1000
  )
    throw Error("项目尺寸无效");
  if (
    !Array.isArray(v.patternRle) ||
    v.patternRle.length % 2 ||
    v.patternRle.length > 2e6
  )
    throw Error("网格无效");
  let total = 0;
  for (let i = 0; i < v.patternRle.length; i += 2) {
    const a = v.patternRle[i],
      b = v.patternRle[i + 1];
    if (
      !Number.isInteger(a) ||
      a < -1 ||
      a > 220 ||
      !Number.isInteger(b) ||
      b < 1 ||
      (total += b) > v.width * v.height
    )
      throw Error("网格无效");
  }
  if (total !== v.width * v.height) throw Error("网格长度无效");
  if (
    typeof v.name !== "string" ||
    v.name.length > 120 ||
    typeof v.id !== "string" ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(v.id)
  )
    throw Error("作品标识或标题无效");
  for (const s of [v.source, v.reference?.url, v.reference?.rawUrl])
    if (
      s !== undefined &&
      (typeof s !== "string" ||
        s.length > 12e6 ||
        !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(s))
    )
      throw Error("图片格式无效");
  if (v.generationBase)
    validateProject({
      ...v,
      width: v.generationBase.width,
      height: v.generationBase.height,
      patternRle: v.generationBase.patternRle,
      generationBase: undefined,
      variants: undefined,
    });
  if (v.variants)
    for (const key of ["normal", "handmade"])
      validateProject({
        ...v,
        patternRle: v.variants[key],
        generationBase: undefined,
        variants: undefined,
      });
  return v;
}
app.get("/api/works", auth, (req, res) =>
  res.json({
    userId: req.user.id,
    works: db
      .prepare(
        "SELECT id,title,updated FROM works WHERE user_id=? ORDER BY updated DESC",
      )
      .all(req.user.id),
  }),
);
app.get("/api/works/:id", auth, (req, res) => {
  const w = db
    .prepare("SELECT data,updated FROM works WHERE id=? AND user_id=?")
    .get(req.params.id, req.user.id);
  if (!w) return res.status(404).json({ error: "作品不存在或无权访问" });
  res.json({
    project: JSON.parse(w.data),
    updated: w.updated,
    userId: req.user.id,
  });
});
app.put("/api/works/:id", auth, accounts.account, async (req, res) => {
  await accounts.access(req, "cloud");
  // A login change in another tab changes the shared cookie, not this tab's UI.
  if (
    req.body.expectedUserId !== undefined &&
    req.body.expectedUserId !== req.user.id
  )
    return res.status(412).json({
      error: "登录账号已改变，请刷新页面后重新保存",
      code: "ACCOUNT_CHANGED",
    });
  let v;
  try {
    v = validateProject(req.body.project);
    if (v.id !== req.params.id) throw Error("作品标识不一致");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const existing = db
    .prepare("SELECT updated FROM works WHERE id=? AND user_id=?")
    .get(v.id, req.user.id);
  if (
    existing &&
    (!Number.isSafeInteger(req.body.expectedUpdated) ||
      req.body.expectedUpdated < 1)
  )
    return res.status(428).json({
      error:
        "缺少此账号作品的同步版本，请在我的作品中重新打开账号作品，或另存副本后保存",
      code: "SYNC_VERSION_REQUIRED",
    });
  if (existing && req.body.expectedUpdated !== existing.updated)
    return res
      .status(409)
      .json({ error: "服务端作品已有更新，请先重新打开或另存副本" });
  if (
    !existing &&
    db
      .prepare("SELECT count(*) AS n FROM works WHERE user_id=?")
      .get(req.user.id).n >= accounts.rules.workLimit
  )
    return res
      .status(400)
      .json({ error: "账号作品数量达到本服务上限，请先备份并移除旧作品" });
  const updated = Math.max(Date.now(), (existing?.updated || 0) + 1);
  db.prepare(
    "INSERT INTO works VALUES(?,?,?,?,?) ON CONFLICT(id,user_id) DO UPDATE SET title=excluded.title,data=excluded.data,updated=excluded.updated",
  ).run(v.id, req.user.id, v.name, JSON.stringify(v), updated);
  res.json({ ok: true, updated });
});
app.delete("/api/works/:id", auth, accounts.account, async (req, res) => {
  await accounts.access(req, "cloud");
  const result = db
    .prepare("DELETE FROM works WHERE id=? AND user_id=?")
    .run(req.params.id, req.user.id);
  res
    .status(result.changes ? 200 : 404)
    .json(result.changes ? { ok: true } : { error: "作品不存在或无权访问" });
});
app.patch("/api/works/:id", auth, accounts.account, async (req, res) => {
  await accounts.access(req, "cloud");
  const w = db
    .prepare("SELECT * FROM works WHERE id=? AND user_id=?")
    .get(req.params.id, req.user.id);
  if (!w) return res.status(404).json({ error: "作品不存在或无权访问" });
  if (req.body.expectedUpdated !== w.updated)
    return res
      .status(409)
      .json({ error: "作品版本已改变，请重新打开后重命名" });
  const title = String(req.body.title || "")
    .trim()
    .slice(0, 120);
  if (!title) return res.status(400).json({ error: "作品名不能为空" });
  const p = JSON.parse(w.data);
  p.name = title;
  p.updatedAt = Math.max(Date.now(), w.updated + 1);
  db.prepare(
    "UPDATE works SET title=?,data=?,updated=? WHERE id=? AND user_id=?",
  ).run(title, JSON.stringify(p), p.updatedAt, w.id, req.user.id);
  res.json({ ok: true, updated: p.updatedAt });
});
app.post("/api/works/:id/copy", auth, accounts.account, async (req, res) => {
  await accounts.access(req, "cloud");
  const w = db
    .prepare("SELECT * FROM works WHERE id=? AND user_id=?")
    .get(req.params.id, req.user.id);
  if (!w) return res.status(404).json({ error: "作品不存在或无权访问" });
  if (
    db.prepare("SELECT count(*) n FROM works WHERE user_id=?").get(req.user.id)
      .n >= accounts.rules.workLimit
  )
    return res.status(400).json({ error: "账号作品数量达到上限" });
  const p = JSON.parse(w.data);
  p.id = crypto.randomUUID();
  p.name = p.name.slice(0, 112) + " · 副本";
  p.updatedAt = Date.now();
  db.prepare("INSERT INTO works VALUES(?,?,?,?,?)").run(
    p.id,
    req.user.id,
    p.name,
    JSON.stringify(p),
    p.updatedAt,
  );
  res
    .status(201)
    .json({ project: p, updated: p.updatedAt, userId: req.user.id });
});
app.use("/api", (_, res) => res.status(404).json({ error: "接口不存在" }));
const staticDir = path.resolve(
  process.env.STATIC_DIR || path.join(root, "dist"),
);
app.use(express.static(staticDir, { index: "index.html" }));
app.get("/{*path}", (_, res) => {
  if (fs.existsSync(path.join(staticDir, "index.html")))
    res.sendFile(path.join(staticDir, "index.html"));
  else res.status(200).send("开发模式前端地址：http://127.0.0.1:5173");
});
app.use((err, req, res, next) => {
  console.error("request error:", err.type || err.name);
  res
    .status(
      err.outcome
        ? err.outcome === "unknown"
          ? 503
          : err.status || 403
        : err.status || 500,
    )
    .json({
      error:
        err.type === "entity.too.large"
          ? "项目超过64MB，请减少版本或压缩原图"
          : err instanceof SyntaxError
            ? "请求JSON无效"
            : err.status && err.status < 500
              ? err.message
              : err.status === 503
                ? err.message
                : "服务器处理失败，请稍后重试",
      code: err.code,
    });
});
const host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 8787);
app.listen(port, host, () =>
  console.log(`豆格工坊 · BeadGrid Studio http://${host}:${port}`),
);
