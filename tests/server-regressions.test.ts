import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { blank, serialize } from "../src/model.ts";

async function start(env: Record<string, string>) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "beadgrid-api-fixes-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((r) => socket.close(() => r()));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      DATA_DIR: data,
      HOST: "127.0.0.1",
      PORT: String(port),
      TRUSTED_PROXIES: "",
      CLIENT_IP_HEADER: "cf-connecting-ip",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (s) => (log += s));
  child.stderr.on("data", (s) => (log += s));
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw Error(log);
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await pause(30);
    if (n === 99) throw Error(log || "server timeout");
  }
  return {
    base,
    async request(
      route: string,
      body = {},
      headers: Record<string, string> = {},
      method = "POST",
    ) {
      return fetch(base + "/api" + route, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    },
    async close() {
      child.kill("SIGTERM");
      await once(child, "exit");
      fs.rmSync(data, { recursive: true, force: true });
    },
  };
}

test("可信Tunnel访客额度独立，同一IP超限；注册登录及来源/所有权校验保留", async () => {
  const app = await start({ TRUSTED_PROXIES: "127.0.0.1/32,::1/128" });
  try {
    const a = { "CF-Connecting-IP": "198.51.100.10" };
    for (let i = 0; i < 60; i++)
      assert.equal((await app.request("/login", {}, a)).status, 400);
    assert.equal((await app.request("/register", {}, a)).status, 429);
    assert.equal(
      (
        await app.request(
          "/login",
          {},
          { ...a, "X-Forwarded-For": "203.0.113.99" },
        )
      ).status,
      429,
    );
    const b = { "CF-Connecting-IP": "198.51.100.11" };
    const credentials = {
      username: "proxy-client-b",
      password: "temporary-test-password-42",
    };
    const registered = await app.request("/register", credentials, b);
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await app.request("/login", credentials, b)).status, 200);
    assert.equal(
      (
        await app.request("/login", credentials, {
          ...b,
          Origin: "https://bad.invalid",
        })
      ).status,
      403,
    );
    const p = serialize(blank(16, 16));
    assert.equal(
      (
        await app.request(
          "/works/" + p.id,
          { project: p, expectedUserId: 999999 },
          { Cookie: cookie },
          "PUT",
        )
      ).status,
      412,
    );
    let r = await app.request(
      "/works/" + p.id,
      { project: p },
      { Cookie: cookie },
      "PUT",
    );
    assert.equal(r.status, 200);
    const { updated } = await r.json();
    r = await app.request(
      "/works/" + p.id,
      { project: p },
      { Cookie: cookie },
      "PUT",
    );
    assert.equal(r.status, 428);
    assert.equal((await r.json()).code, "SYNC_VERSION_REQUIRED");
    assert.equal(
      (
        await app.request(
          "/works/" + p.id,
          { project: p, expectedUpdated: null },
          { Cookie: cookie },
          "PUT",
        )
      ).status,
      428,
    );
    r = await app.request(
      "/works/" + p.id,
      { project: p, expectedUpdated: updated },
      { Cookie: cookie },
      "PUT",
    );
    assert.equal(r.status, 200);
    assert.equal(
      (
        await app.request(
          "/works/" + p.id,
          { project: p, expectedUpdated: updated },
          { Cookie: cookie },
          "PUT",
        )
      ).status,
      409,
    );
    assert.equal((await fetch(app.base + "/api/works/" + p.id)).status, 401);
    const direct = {
      username: "direct-local",
      password: "temporary-direct-password-42",
    };
    assert.equal((await app.request("/register", direct)).status, 201);
    assert.equal((await app.request("/login", direct)).status, 200);
  } finally {
    await app.close();
  }
});

test("非可信直连伪造CF及XFF不能绕过认证限流", async () => {
  const app = await start({ TRUSTED_PROXIES: "192.0.2.50/32" });
  try {
    for (let i = 0; i < 60; i++) {
      const status = (
        await app.request(
          "/login",
          {},
          {
            "CF-Connecting-IP": `198.51.100.${i + 1}`,
            "X-Forwarded-For": `203.0.113.${i + 1}`,
          },
        )
      ).status;
      assert.equal(status, 400);
    }
    assert.equal(
      (
        await app.request(
          "/register",
          {},
          {
            "CF-Connecting-IP": "198.51.100.254",
            "X-Forwarded-For": "203.0.113.254",
          },
        )
      ).status,
      429,
    );
  } finally {
    await app.close();
  }
});
