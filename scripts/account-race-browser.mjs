import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "verification/product-parity-20261020"),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "bead-race-")),
  socket = net.createServer().listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = "http://127.0.0.1:" + port;
const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    ENV_FILE: "none",
    DATA_DIR: temp,
    STATIC_DIR: path.resolve(
      root,
      process.env.TEST_BUILD_DIR || ".local-public/v16-local/dist",
    ),
    HOST: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "test",
    SMTP_HOST: "",
    COOKIE_SECURE: "0",
    SIGNUP_MEMBER_DAYS: "1",
    REWARD_REQUIRE_VERIFIED_EMAIL: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(base + "/api/health")).ok) break;
  } catch {}
  await pause(30);
}
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1024 },
  }),
  second = await browser.newContext(),
  report = { date: new Date().toISOString(), checks: [], errors: [] };
let page;
const pass = (s) => {
  report.checks.push(s);
  console.log("PASS", s);
};
async function bounded(p, label) {
  let timer;
  try {
    return await Promise.race([
      p,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(label + "超时")), 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const credentials = (name) => ({
  username: name,
  password: "isolated-race-password-2026",
});
try {
  assert.equal(
    (
      await context.request.post(base + "/api/register", {
        data: credentials("race-a"),
      })
    ).status(),
    201,
  );
  assert.equal(
    (
      await second.request.post(base + "/api/register", {
        data: credentials("race-b"),
      })
    ).status(),
    201,
  );
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(base);
  await page.getByText("已自动保存", { exact: true }).waitFor();
  await page.getByLabel("作品名称", { exact: true }).fill("账号 A 私有作品");
  await pause(720);
  async function login(name) {
    assert.equal(
      (
        await context.request.post(base + "/api/login", {
          data: credentials(name),
        })
      ).status(),
      200,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByLabel("账号：" + name, { exact: true }).waitFor();
    await page.getByText("已自动保存", { exact: true }).waitFor();
    await pause(720);
  }
  let release, seen;
  const held = new Promise((r) => (release = r)),
    reserved = new Promise((r) => (seen = r));
  let id;
  await page.route("**/api/exports/reserve", async (route) => {
    const r = await route.fetch();
    id = (await r.json()).id;
    seen();
    await held;
    await route.fulfill({ response: r });
  });
  await page.getByLabel("下载图纸", { exact: true }).click();
  await page
    .getByRole("button", { name: "确认并生成图纸", exact: true })
    .click();
  await bounded(reserved, "等待预留响应");
  await login("race-b");
  release();
  await pause(800);
  assert.match(
    await page.getByLabel("作品名称", { exact: true }).inputValue(),
    /雷电将军/,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "文件已生成", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.locator(".processing").count(), 0);
  assert.equal(
    (
      await context.request.get(base + "/api/exports/" + id + "/download")
    ).status(),
    404,
  );
  await page.unroute("**/api/exports/reserve");
  await login("race-a");
  assert.equal(
    (
      await context.request.post(base + "/api/exports/" + id + "/cancel", {
        data: {},
      })
    ).status(),
    200,
  );
  assert.equal(
    await page.getByLabel("作品名称", { exact: true }).inputValue(),
    "账号 A 私有作品",
  );
  pass(
    "服务端预留已完成但响应延迟时切换账号：不启动旧账号导出、不回显旧图、不越权下载，原任务可回原账号取消",
  );
  await page
    .getByTestId("reference-input")
    .setInputFiles(path.join(root, "tests/fixtures/portrait-contain.png"));
  await page.getByRole("dialog", { name: "描摹参考底图" }).waitFor();
  let releaseWorker, workerSeen;
  const block = new Promise((r) => (releaseWorker = r)),
    workerRequested = new Promise((r) => (workerSeen = r));
  await page.route("**/assets/background.worker-*.js", async (route) => {
    const response = await route.fetch();
    workerSeen();
    await block;
    await route.fulfill({ response }).catch(() => {});
  });
  await page
    .getByRole("checkbox", {
      name: "清除底图主要边缘背景（实验，非AI）",
      exact: true,
    })
    .click({ noWaitAfter: true });
  await bounded(workerRequested, "等待底图Worker");
  await login("race-b");
  releaseWorker();
  await pause(600);
  assert.match(
    await page.getByLabel("作品名称", { exact: true }).inputValue(),
    /雷电将军/,
  );
  assert.equal(
    await page.getByRole("dialog", { name: "描摹参考底图" }).count(),
    0,
  );
  assert.equal(await page.locator(".processing").count(), 0);
  await page.unroute("**/assets/background.worker-*.js");
  pass("底图处理进行中切换身份会终止Worker，旧图和回调不会写入新身份草稿");
  await login("race-a");
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) {
      setTimeout(() => original.call(this, blob), 700);
    };
  });
  await page
    .getByTestId("image-input")
    .setInputFiles(path.join(root, "tests/fixtures/portrait-contain.png"));
  await login("race-b");
  await pause(800);
  assert.equal(
    await page.getByRole("dialog", { name: "上传图片并设置板子" }).count(),
    0,
  );
  assert.match(
    await page.getByLabel("作品名称", { exact: true }).inputValue(),
    /雷电将军/,
  );
  pass("延迟图片读取跨身份返回时丢弃，不弹出旧身份素材或改写新作品");
  await page
    .getByTestId("image-input")
    .setInputFiles(path.join(root, "src/assets/raiden-shogun.png"));
  let d = page.getByRole("dialog", { name: "上传图片并设置板子" });
  await d.getByRole("button", { name: "长边100格", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".import-preview-viewport")?.dataset.state ===
      "ready",
  );
  await d.getByRole("button", { name: "确认生成", exact: true }).click();
  await d.waitFor({ state: "hidden" });
  await pause(720);
  await page
    .locator("details.panel-disclosure")
    .filter({ hasText: "转换与边缘处理" })
    .locator("summary")
    .click();
  await page.getByLabel("最大颜色数数值", { exact: true }).fill("3");
  await page.getByLabel("工具扩展", { exact: true }).click();
  await page.getByRole("button", { name: "识别成手搓图", exact: true }).click();
  await page.getByRole("button", { name: "应用所选版本", exact: true }).click();
  await pause(720);
  const p = await page.evaluate(async () => {
    const id = (await (await fetch("/api/me")).json()).user.id;
    return new Promise((resolve) => {
      const req = indexedDB.open("xing-local-v1", 1);
      req.onsuccess = () => {
        const db = req.result,
          r = db
            .transaction("meta")
            .objectStore("meta")
            .get("draft:" + location.origin + "/api:user:" + id);
        r.onsuccess = () => {
          resolve(r.result);
          db.close();
        };
      };
    });
  });
  const actual = new Set(p.patternRle.filter((v, i) => i % 2 === 0 && v >= 0));
  assert.ok(actual.size > 3);
  assert.equal(p.settings.limit, 3);
  assert.equal(p.generationBase.settings.limit, 64);
  pass(
    "未应用的最大色数参数不污染手搓候选；重采样使用已确认基准参数，后续色卡约束仍生效",
  );
  await page.getByLabel("作品菜单", { exact: true }).click();
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page
    .getByRole("button", { name: "保存当前作品到账号", exact: true })
    .click();
  await page.getByText("作品已保存到独立服务", { exact: true }).waitFor();
  const device = await second.newPage();
  await device.goto(base);
  await device.getByText("已自动保存", { exact: true }).waitFor();
  await device.getByLabel("作品菜单", { exact: true }).click();
  await device.getByRole("button", { name: "我的作品", exact: true }).click();
  await device
    .locator(".cloud-works")
    .getByRole("button", { name: "打开", exact: true })
    .first()
    .click();
  await device.getByText("已自动保存", { exact: true }).waitFor();
  await pause(720);
  const restored = await device.evaluate(async () => {
    const id = (await (await fetch("/api/me")).json()).user.id;
    return new Promise((resolve) => {
      const r = indexedDB.open("xing-local-v1", 1);
      r.onsuccess = () => {
        const db = r.result,
          q = db
            .transaction("meta")
            .objectStore("meta")
            .get("draft:" + location.origin + "/api:user:" + id);
        q.onsuccess = () => {
          resolve(q.result);
          db.close();
        };
      };
    });
  });
  assert.deepEqual(restored.patternRle, p.patternRle);
  assert.deepEqual(
    restored.generationBase.patternRle,
    p.generationBase.patternRle,
  );
  assert.equal(restored.id, p.id);
  pass("无本地草稿的独立浏览器登录同一账号，从云作品恢复网格、候选和生成基准");
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.stack;
  await page
    ?.screenshot({ path: path.join(out, "race-failure.png") })
    .catch(() => {});
  throw e;
} finally {
  fs.writeFileSync(
    path.join(out, "account-race-results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  server.kill();
  await once(server, "exit");
  fs.rmSync(temp, { recursive: true, force: true });
}
