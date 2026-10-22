import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { generateKeyPairSync, sign, createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { blank, serialize } from "../src/model.ts";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test("公共OIDC与权威权益：一次回调、签名/nonce/PKCE，身份隔离及未知结果恢复", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }),
    jwk = {
      ...publicKey.export({ format: "jwk" }),
      kid: "test",
      use: "sig",
      alg: "RS256",
    };
  const codes = new Map(),
    tokens = new Map(),
    reservations = new Map(),
    users = {
      a: {
        uid: randomUUID(),
        username: "qa_a",
        subject: "sub_a",
        member: false,
        quota: 4,
      },
      b: {
        uid: randomUUID(),
        username: "qa_b",
        subject: "sub_b",
        member: true,
        quota: 0,
      },
    };
  let bad = "",
    failStatus = false,
    loseConfirm = false,
    memberAccess = false,
    serverBase;
  const json = (res, status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const mock = http.createServer(async (req, res) => {
    const url = new URL(req.url, serverBase),
      chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString();
    if (url.pathname.startsWith("/.well-known/"))
      return json(res, 200, {
        issuer: serverBase,
        authorization_endpoint: serverBase + "/authorize",
        token_endpoint: serverBase + "/token",
        jwks_uri: serverBase + "/jwks",
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.pathname === "/jwks") return json(res, 200, { keys: [jwk] });
    if (url.pathname === "/token") {
      const b = new URLSearchParams(raw),
        c = codes.get(b.get("code"));
      codes.delete(b.get("code"));
      if (
        !c ||
        createHash("sha256")
          .update(b.get("code_verifier") || "")
          .digest("base64url") !== c.challenge ||
        b.get("client_secret") !== "s".repeat(40)
      )
        return json(res, 400, { error: "invalid_grant" });
      const u = users[c.user],
        token = "access-" + randomUUID();
      tokens.set(token, u);
      const h = Buffer.from(
          JSON.stringify({ alg: "RS256", kid: "test" }),
        ).toString("base64url"),
        p = Buffer.from(
          JSON.stringify({
            iss: serverBase,
            sub: u.subject,
            aud: bad === "aud" ? "wrong" : "client_beadgrid",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (bad === "exp" ? -10 : 3600),
            nonce: bad === "nonce" ? "wrong" : c.nonce,
          }),
        ).toString("base64url"),
        input = h + "." + p;
      let signature = sign(
        "RSA-SHA256",
        Buffer.from(input),
        privateKey,
      ).toString("base64url");
      if (bad === "signature") signature = signature.slice(0, -6) + "AAAAAA";
      return json(res, 200, {
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        id_token: input + "." + signature,
      });
    }
    if (req.headers.authorization !== "Bearer " + "k".repeat(40))
      return json(res, 403, { error: "service rejected" });
    const lookup = () =>
      reservations.get(url.searchParams.get("reservation_id")) ||
      [...reservations.values()].find(
        (v) => v.request_id === url.searchParams.get("request_id"),
      );
    if (url.pathname.endsWith("/recovery/reservations")) {
      if (failStatus) return json(res, 503, { code: "DOWN" });
      const r = lookup();
      return json(res, r ? 200 : 404, r || { code: "RESERVATION_NOT_FOUND" });
    }
    const b = raw ? JSON.parse(raw) : {};
    if (url.pathname.endsWith("/recovery")) {
      const r =
        reservations.get(b.reservation_id) ||
        [...reservations.values()].find((v) => v.request_id === b.request_id);
      if (!r) return json(res, 404, { code: "RESERVATION_NOT_FOUND" });
      if (
        (b.action === "cancel" && r.status === "reserved") ||
        (b.action === "refund" && r.status === "confirmed")
      ) {
        r.status = b.action === "refund" ? "refunded" : "cancelled";
        users[r.user].quota++;
      }
      return json(res, 200, r);
    }
    const u = tokens.get(req.headers["x-user-token"]);
    if (!u)
      return json(res, 401, { code: "INVALID_TOKEN", error: "invalid token" });
    if (url.pathname.endsWith("/identity"))
      return json(res, 200, {
        user: { ...u, issuer: serverBase, organization: "consumers" },
      });
    if (url.pathname.endsWith("/entitlements"))
      return json(res, 200, {
        product: { id: "beadgrid" },
        membership: {
          active: u.member,
          expires_at: u.member
            ? new Date(Date.now() + 864e5).toISOString()
            : null,
        },
        features: [
          {
            id: "export",
            kind: "quota",
            remaining: u.quota,
            held: 0,
            allowed: true,
          },
          {
            id: "export_member",
            kind: "access",
            allowed: memberAccess && u.member,
          },
        ],
      });
    if (url.pathname.endsWith("/check"))
      return json(
        res,
        b.feature_id === "export_member" && !(memberAccess && u.member)
          ? 403
          : 200,
        { allowed: true },
      );
    if (url.pathname.endsWith("/reservations")) {
      let r = [...reservations.values()].find(
        (r) => r.request_id === b.request_id,
      );
      if (!r) {
        if (u.quota < 1)
          return json(res, 403, {
            code: "INSUFFICIENT_QUOTA",
            error: "额度不足",
          });
        u.quota--;
        r = {
          id: randomUUID(),
          request_id: b.request_id,
          status: "reserved",
          expires_at: new Date(Date.now() + 300000).toISOString(),
          user: u === users.a ? "a" : "b",
        };
        reservations.set(r.id, r);
      }
      return json(res, 200, r);
    }
    if (url.pathname.endsWith("/confirm")) {
      const r = reservations.get(url.pathname.split("/").at(-2));
      r.status = "confirmed";
      if (loseConfirm) {
        failStatus = true;
        res.destroy();
        return;
      }
      return json(res, 200, r);
    }
    return json(res, 404, {});
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  serverBase = "http://127.0.0.1:" + mock.address().port;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "beadgrid-oidc-")),
    portServer = http.createServer().listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const port = portServer.address().port;
  await new Promise((r) => portServer.close(r));
  const base = "http://127.0.0.1:" + port;
  let child,
    log = "";
  async function start(trusted = "127.0.0.1/32") {
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        ENV_FILE: "none",
        NODE_ENV: "test",
        OIDC_TEST_HTTP: "1",
        ACCOUNTS_URL: serverBase,
        OIDC_ISSUER: serverBase,
        OIDC_APPLICATION: "zhenyi-beadgrid",
        OIDC_CLIENT_ID: "client_beadgrid",
        OIDC_CLIENT_SECRET: "s".repeat(40),
        OIDC_REDIRECT_URI: base + "/auth/callback/beadgrid",
        PRODUCT_ID: "beadgrid",
        PRODUCT_SERVICE_KEY: "k".repeat(40),
        DATA_DIR: data,
        PORT: String(port),
        CENTER_TIMEOUT_MS: "500",
        TRUSTED_PROXIES: trusted,
        CLIENT_IP_HEADER: "x-forwarded-for",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (x) => (log += x));
    child.stderr.on("data", (x) => (log += x));
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error(log);
      try {
        if ((await fetch(base + "/api/health")).ok) return;
      } catch {}
      await sleep(30);
    }
    throw Error("start timeout");
  }
  async function stop() {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  async function login(user = "a", tamper = false) {
    const r = await fetch(base + "/auth/login", { redirect: "manual" }),
      cookie = r.headers
        .getSetCookie()
        .find((x) => x.startsWith("beadgrid_oidc_login="))
        ?.split(";")[0],
      auth = new URL(r.headers.get("location")),
      code = randomUUID();
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    codes.set(code, {
      user,
      challenge: auth.searchParams.get("code_challenge"),
      nonce: auth.searchParams.get("nonce"),
    });
    const callback =
      base +
      "/auth/callback/beadgrid?code=" +
      code +
      "&state=" +
      (tamper ? "wrong" : auth.searchParams.get("state"));
    const result = await fetch(callback, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    return {
      result,
      callback,
      cookie,
      session: result.headers
        .getSetCookie()
        .find((x) => x.startsWith("beadgrid_oidc_session="))
        ?.split(";")[0],
    };
  }
  const req = async (cookie, route, body, method) => {
    const r = await fetch(base + "/api" + route, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: {
        Cookie: cookie || "",
        Origin: base,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    await start();
    assert.equal(
      (await req("", "/login", { username: "x", password: "y" })).status,
      410,
    );
    assert.equal((await req("", "/register", {})).status, 410);
    assert.match(
      (await login("a", true)).result.headers.get("location"),
      /authError/,
    );
    for (bad of ["signature", "nonce", "aud", "exp"])
      assert.match(
        (await login()).result.headers.get("location"),
        /authError/,
        bad,
      );
    bad = "";
    const a = await login(),
      b = await login("b");
    assert.ok(a.session);
    assert.ok(b.session);
    assert.match(a.result.headers.getSetCookie().join(";"), /HttpOnly/);
    assert.match(a.result.headers.getSetCookie().join(";"), /SameSite=Lax/);
    assert.match(
      (
        await fetch(a.callback, {
          headers: { Cookie: a.cookie },
          redirect: "manual",
        })
      ).headers.get("location"),
      /authError/,
    );
    const au = (await req(a.session, "/me")).body.user,
      bu = (await req(b.session, "/me")).body.user;
    assert.equal(au.uid, users.a.uid);
    assert.equal(bu.exportAccess, false);
    assert.equal(
      (
        await req(b.session, "/exports/reserve", {
          requestKey: randomUUID(),
          fingerprint: "b".repeat(64),
          kind: "chart",
        })
      ).status,
      403,
      "membership alone cannot supply quota/access",
    );
    const p = serialize(blank(16, 16));
    p.cells = undefined;
    assert.equal(
      (
        await req(
          a.session,
          "/works/" + p.id,
          { project: p, expectedUserId: au.id },
          "PUT",
        )
      ).status,
      200,
    );
    assert.equal((await req(b.session, "/works/" + p.id)).status, 404);
    assert.equal(
      (
        await req(
          b.session,
          "/works/" + p.id,
          { project: p, expectedUserId: au.id },
          "PUT",
        )
      ).status,
      412,
    );
    assert.equal(
      (await req(a.session, "/works/" + p.id, { project: p }, "PUT")).status,
      428,
    );
    const reserveBody = {
      requestKey: randomUUID(),
      fingerprint: "a".repeat(64),
      kind: "chart",
      expectedUserId: au.id,
    };
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () =>
        req(a.session, "/exports/reserve", reserveBody),
      ),
    );
    const j = concurrent[0].body;
    assert.ok(concurrent.every((x) => x.body.id === j.id));
    assert.equal(users.a.quota, 3);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    async function upload() {
      const r = await fetch(base + "/api/exports/" + j.id + "/file", {
        method: "PUT",
        headers: {
          Cookie: a.session,
          Origin: base,
          "Content-Type": "application/octet-stream",
          "X-Studio-User": String(au.id),
          "X-Filename": "sample.png",
        },
        body: png,
      });
      return { status: r.status, body: await r.json() };
    }
    loseConfirm = true;
    failStatus = false;
    const unknown = await upload();
    assert.equal(unknown.status, 202);
    assert.equal(unknown.body.status, "pending_recovery");
    assert.equal(users.a.quota, 3);
    // Product logout does not remove the durable task. Recovery needs only the product credential.
    await req(a.session, "/logout", {});
    await stop();
    loseConfirm = false;
    failStatus = false;
    await start();
    await sleep(180);
    const a2 = await login();
    const ready = await req(a2.session, "/exports/" + j.id);
    assert.equal(ready.body.status, "ready");
    assert.equal(users.a.quota, 3);
    const download = await fetch(base + "/api/exports/" + j.id + "/download", {
      headers: { Cookie: a2.session },
    });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
    await fetch(base + "/api/exports/" + j.id + "/download", {
      headers: { Cookie: a2.session },
    });
    assert.equal(users.a.quota, 3);
    assert.equal(
      (
        await fetch(base + "/api/exports/" + j.id + "/download", {
          headers: { Cookie: b.session },
        })
      ).status,
      404,
    );
    await req(a2.session, "/exports/" + j.id + "/cancel", {});
    assert.equal(users.a.quota, 3, "client cannot refund completed artifact");
    const cancel = await req(a2.session, "/exports/reserve", {
      ...reserveBody,
      requestKey: randomUUID(),
      fingerprint: "c".repeat(64),
    });
    assert.equal(users.a.quota, 2);
    await Promise.all(
      Array.from({ length: 3 }, () =>
        req(a2.session, "/exports/" + cancel.body.id + "/cancel", {}),
      ),
    );
    assert.equal(users.a.quota, 3);
    const db = new DatabaseSync(path.join(data, "studio.sqlite"));
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(au.id);
    db.close();
    assert.equal((await req(a2.session, "/me")).status, 401);
    for (let i = 0; i < 60; i++)
      assert.equal(
        (
          await fetch(base + "/auth/login", {
            redirect: "manual",
            headers: { "X-Forwarded-For": "203.0.113.10" },
          })
        ).status,
        302,
      );
    assert.equal(
      (
        await fetch(base + "/auth/login", {
          redirect: "manual",
          headers: { "X-Forwarded-For": "203.0.113.10" },
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await fetch(base + "/auth/login", {
          redirect: "manual",
          headers: { "X-Forwarded-For": "203.0.113.11" },
        })
      ).status,
      302,
    );
    await stop();
    await start("");
    for (let i = 0; i < 60; i++)
      assert.equal(
        (
          await fetch(base + "/auth/login", {
            redirect: "manual",
            headers: { "X-Forwarded-For": "198.51.100." + (i + 1) },
          })
        ).status,
        302,
      );
    assert.equal(
      (
        await fetch(base + "/auth/login", {
          redirect: "manual",
          headers: {
            "X-Forwarded-For": "198.51.100.250",
            "CF-Connecting-IP": "198.51.100.251",
          },
        })
      ).status,
      429,
    );
    assert.ok(!log.includes("s".repeat(40)) && !log.includes("k".repeat(40)));
  } finally {
    await stop();
    await new Promise((r) => mock.close(r));
    fs.rmSync(data, { recursive: true, force: true });
  }
});
