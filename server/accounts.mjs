import * as oidc from "openid-client";
import { randomBytes, createHash } from "node:crypto";
import {
  createEntitlementClient,
  CenterRequestError,
} from "./center-client.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const random = () => randomBytes(32).toString("base64url");
export const fault = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
export function installAccounts({ app, db, rate }) {
  const env = process.env;
  const required = [
    "ACCOUNTS_URL",
    "OIDC_ISSUER",
    "OIDC_APPLICATION",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "OIDC_REDIRECT_URI",
    "PRODUCT_ID",
    "PRODUCT_SERVICE_KEY",
  ];
  for (const name of required)
    if (!env[name]) throw Error("Missing account configuration: " + name);
  if (
    env.PRODUCT_ID !== "beadgrid" ||
    env.OIDC_APPLICATION !== "zhenyi-beadgrid"
  )
    throw Error("Untrusted product/application");
  if (env.OIDC_CLIENT_SECRET.length < 32 || env.PRODUCT_SERVICE_KEY.length < 32)
    throw Error("Product secrets too short");
  const testing = env.NODE_ENV === "test" && env.OIDC_TEST_HTTP === "1";
  const accountsUrl = new URL(env.ACCOUNTS_URL),
    issuer = new URL(env.OIDC_ISSUER),
    callback = new URL(env.OIDC_REDIRECT_URI);
  for (const u of [accountsUrl, issuer, callback])
    if (
      (!testing && u.protocol !== "https:") ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw Error("Invalid trusted account URL");
  if (
    callback.pathname !== "/auth/callback/beadgrid" ||
    issuer.pathname !== "/"
  )
    throw Error("Invalid issuer/callback path");
  if (
    !testing &&
    (issuer.href !== "https://identity.accounts.shizibandu.icu/" ||
      accountsUrl.href !== "https://accounts.shizibandu.icu/" ||
      callback.origin !== "https://pindou.shizibandu.icu")
  )
    throw Error("Production trust anchor mismatch");
  db.exec(`CREATE TABLE IF NOT EXISTS identities(id INTEGER PRIMARY KEY,uid TEXT NOT NULL UNIQUE,issuer TEXT NOT NULL,subject TEXT NOT NULL,username TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(issuer,subject));
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES identities(id),access_token TEXT NOT NULL,expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS login_attempts(token TEXT PRIMARY KEY,state TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS works(id TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES identities(id),title TEXT NOT NULL,data TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(id,user_id));
  PRAGMA user_version=3;`);
  const secure = !testing && env.COOKIE_SECURE !== "0";
  if (env.NODE_ENV === "production" && !secure)
    throw Error("Secure cookies required");
  const name = secure ? "__Host-beadgrid_session" : "beadgrid_oidc_session",
    flowName = secure ? "__Host-beadgrid_login" : "beadgrid_oidc_login";
  const opts = { httpOnly: true, secure, sameSite: "lax", path: "/" };
  const readCookie = (req, key) =>
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(key + "="))
      ?.slice(key.length + 1);
  const clear = (req, res) => {
    req.sessionHash ||= readCookie(req, name)
      ? hash(readCookie(req, name))
      : undefined;
    if (req.sessionHash)
      db.prepare("DELETE FROM sessions WHERE token=?").run(req.sessionHash);
    res.clearCookie(name, opts);
  };
  const rights = createEntitlementClient({
    centerUrl: accountsUrl.href,
    productId: "beadgrid",
    serviceKey: env.PRODUCT_SERVICE_KEY,
    timeoutMs: Number(env.CENTER_TIMEOUT_MS || 10000),
  });
  async function centerCall(token, endpoint, body) {
    let response, result;
    try {
      response = await fetch(
        new URL("/api/v1/products/beadgrid/" + endpoint, accountsUrl),
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: "Bearer " + env.PRODUCT_SERVICE_KEY,
            "X-User-Token": token,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        },
      );
      result = await response.json();
    } catch {
      throw fault(
        503,
        "CENTER_UNAVAILABLE",
        "公共账号中心暂不可用，编辑内容已保留，请稍后重试",
      );
    }
    if (!response.ok)
      throw fault(
        response.status >= 500 ? 503 : response.status,
        result.code || "CENTER_REJECTED",
        result.error || "账号中心校验失败",
      );
    return result;
  }
  let configured;
  async function configuration() {
    if (configured) return configured;
    const d = await fetch(
      new URL(
        `/.well-known/${env.OIDC_APPLICATION}/openid-configuration`,
        issuer,
      ),
      { signal: AbortSignal.timeout(10000) },
    ).then((r) => {
      if (!r.ok) throw Error("Discovery unavailable");
      return r.json();
    });
    if (d.issuer !== issuer.href.replace(/\/$/, ""))
      throw Error("Discovery issuer mismatch");
    for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"])
      if (new URL(d[key]).origin !== issuer.origin)
        throw Error("Untrusted OIDC endpoint");
    const c = new oidc.Configuration(
      d,
      env.OIDC_CLIENT_ID,
      {
        client_secret: env.OIDC_CLIENT_SECRET,
        id_token_signed_response_alg: "RS256",
      },
      oidc.ClientSecretPost(env.OIDC_CLIENT_SECRET),
    );
    c.timeout = 10;
    if (testing) oidc.allowInsecureRequests(c);
    oidc.enableNonRepudiationChecks(c);
    configured = c;
    return c;
  }
  app.get("/auth/login", rate, async (req, res) => {
    const c = await configuration();
    clear(req, res);
    db.prepare("DELETE FROM login_attempts WHERE expires<?").run(Date.now());
    const token = random(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier();
    db.prepare("INSERT INTO login_attempts VALUES(?,?,?,?,?)").run(
      hash(token),
      state,
      nonce,
      verifier,
      Date.now() + 600000,
    );
    res.cookie(flowName, token, { ...opts, maxAge: 600000 });
    const url = oidc.buildAuthorizationUrl(c, {
      redirect_uri: callback.href,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      ...(req.query.switch === "1" ? { prompt: "login" } : {}),
    });
    res.redirect(url.href);
  });
  app.get(callback.pathname, rate, async (req, res) => {
    const token = readCookie(req, flowName);
    const row =
      token &&
      db
        .prepare("DELETE FROM login_attempts WHERE token=? RETURNING *")
        .get(hash(token));
    res.clearCookie(flowName, opts);
    try {
      if (!row || row.expires <= Date.now())
        throw Error("Invalid login attempt");
      const url = new URL(req.originalUrl, callback.origin);
      const result = await oidc.authorizationCodeGrant(
        await configuration(),
        url,
        {
          expectedState: row.state,
          expectedNonce: row.nonce,
          pkceCodeVerifier: row.verifier,
          idTokenExpected: true,
        },
      );
      const claims = result.claims();
      if (
        !claims?.sub ||
        !Number.isFinite(claims.exp) ||
        claims.exp * 1000 <= Date.now()
      )
        throw Error("Invalid claims");
      const identity = (await centerCall(result.access_token, "identity")).user;
      if (
        !identity?.uid ||
        identity.subject !== claims.sub ||
        identity.issuer !== issuer.href.replace(/\/$/, "") ||
        identity.organization !== "consumers"
      )
        throw Error("Identity mismatch");
      const old = db
        .prepare(
          "SELECT * FROM identities WHERE uid=? OR (issuer=? AND subject=?)",
        )
        .all(identity.uid, issuer.href, claims.sub);
      if (
        old.some(
          (u) =>
            u.uid !== identity.uid ||
            u.issuer !== issuer.href ||
            u.subject !== claims.sub,
        )
      )
        throw Error("Identity binding mismatch");
      db.prepare(
        "INSERT INTO identities(uid,issuer,subject,username,created) VALUES(?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET username=excluded.username",
      ).run(
        identity.uid,
        issuer.href,
        claims.sub,
        identity.display_name || identity.username || "公共账号用户",
        Date.now(),
      );
      const user = db
          .prepare("SELECT * FROM identities WHERE uid=?")
          .get(identity.uid),
        session = random();
      db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
      db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
        hash(session),
        user.id,
        result.access_token,
        Math.min(claims.exp * 1000, Date.now() + 8 * 3600000),
      );
      res.cookie(name, session, {
        ...opts,
        maxAge: Math.min(claims.exp * 1000 - Date.now(), 8 * 3600000),
      });
      res.redirect("/");
    } catch {
      res.redirect("/?authError=login_failed");
    }
  });
  app.post("/api/logout", (req, res) => {
    clear(req, res);
    res.json({ ok: true });
  });
  app.use("/api", async (req, res, next) => {
    const cookie = readCookie(req, name);
    if (!cookie) return next();
    req.sessionHash = hash(cookie);
    const session = db
      .prepare(
        "SELECT s.*,i.uid,i.username,i.issuer,i.subject FROM sessions s JOIN identities i ON s.user_id=i.id WHERE token=? AND expires>?",
      )
      .get(req.sessionHash, Date.now());
    if (!session) {
      clear(req, res);
      return res.status(401).json({
        error: "登录已失效，请使用公共账号重新登录",
        code: "LOGIN_REQUIRED",
      });
    }
    try {
      const identity = (await centerCall(session.access_token, "identity"))
        .user;
      if (identity.uid !== session.uid)
        throw fault(401, "IDENTITY_CHANGED", "登录身份不匹配");
      req.user = {
        id: session.user_id,
        uid: session.uid,
        username:
          identity.display_name || identity.username || session.username,
      };
      req.accessToken = session.access_token;
      next();
    } catch (error) {
      if ([401, 403].includes(error.status)) {
        clear(req, res);
        error.status = 401;
      }
      next(error);
    }
  });
  const auth = (req, res, next) =>
    req.user
      ? next()
      : res
          .status(401)
          .json({ error: "请使用公共账号登录", code: "LOGIN_REQUIRED" });
  const account = (req, res, next) => {
    const expected = req.body?.expectedUserId;
    if (expected !== undefined && expected !== req.user?.id)
      return res
        .status(412)
        .json({ error: "登录身份已改变", code: "ACCOUNT_CHANGED" });
    next();
  };
  async function userView(req) {
    if (!req.user) return null;
    const e = await rights.get(req.accessToken),
      member = e.membership;
    const quota = e.features.find(
      (f) =>
        f.id === (env.EXPORT_QUOTA_FEATURE || "export") && f.kind === "quota",
    );
    const access = e.features.find(
      (f) =>
        f.id === (env.EXPORT_ACCESS_FEATURE || "export_member") &&
        f.kind === "access",
    );
    return {
      ...req.user,
      role: "user",
      email: null,
      emailVerified: false,
      memberUntil: member.expires_at
        ? new Date(member.expires_at).getTime()
        : 0,
      freeCredits: quota?.remaining || 0,
      status: member.active
        ? "member"
        : member.expires_at
          ? "expired"
          : "ordinary",
      exportAccess: !!access?.allowed,
      exportQuotaAllowed: !!quota?.allowed,
      heldCredits: quota?.held || 0,
      entitlements: e,
    };
  }
  app.get("/admin", (_, res) =>
    res.redirect(new URL("/admin", accountsUrl).href),
  );
  app.use("/api", (req, res, next) => {
    for (const legacy of ["studio_session", "studio_session_v16_local"])
      if (readCookie(req, legacy))
        res.clearCookie(legacy, { ...opts, sameSite: "strict" });
    next();
  });
  app.get("/api/me", async (req, res) =>
    res.json({
      user: await userView(req),
      cacheVersion: "accounts-v1",
      authMode: "oidc",
    }),
  );
  app.post("/api/logout-all", auth, async (req, res) => {
    await centerCall(req.accessToken, "logout-all", {});
    clear(req, res);
    res.json({ ok: true });
  });
  app.get("/api/policy", (_, res) =>
    res.json({
      authMode: "oidc",
      accountsUrl: accountsUrl.origin,
      securityUrl: new URL("/?product=beadgrid&tab=security", accountsUrl).href,
      redeemUrl: new URL("/?product=beadgrid&tab=redeem", accountsUrl).href,
      adminUrl: new URL("/admin", accountsUrl).href,
      rules: {
        workLimit: 50,
        exportReservationMinutes: 5,
        basis:
          "本地编辑、项目备份免费；账号功能按中心access校验。免次导出单独检查export_member；否则export预占1次。会员状态本身不等于无限次数，普通免费额度维持原配置0次，不自动赠送。",
      },
      ai: { available: false, reason: "原站未开放；未接入模型" },
    }),
  );
  app.post("/api/access/:feature", auth, async (req, res) => {
    if (!["studio", "cloud"].includes(req.params.feature))
      throw fault(400, "INVALID_FEATURE", "功能无效");
    res.json(await rights.check(req.accessToken, req.params.feature));
  });
  app.all(
    [
      "/api/register",
      "/api/login",
      "/api/recover",
      "/api/reset-password",
      "/api/verify-email",
      "/api/account/password",
      "/api/account/email",
      "/api/account/redeem",
      "/api/admin",
      "/api/admin/{*path}",
    ],
    (_, res) =>
      res.status(410).json({
        code: "CENTRAL_ACCOUNTS_ONLY",
        error: "旧拼豆账号体系已停用，请前往公共账号中心",
      }),
  );
  return {
    auth,
    account,
    userView,
    rights,
    centerCall,
    configuration,
    clear,
    rules: { workLimit: 50 },
    access: async (req, feature) => rights.check(req.accessToken, feature),
  };
}
