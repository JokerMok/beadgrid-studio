import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const base = "https://pindou.shizibandu.icu",
  out = path.resolve("verification/accounts-integration-20261022"),
  priv = path.resolve(".local-public/account-integration"),
  qa = JSON.parse(fs.readFileSync(path.join(priv, "qa-accounts.json"))),
  previous = JSON.parse(
    fs.readFileSync(path.join(out, "browser-results.json")),
  );
const browser = await chromium.launch({ headless: true }),
  report = {
    date: new Date().toISOString(),
    checks: [],
    downloads: [],
    errors: [],
    status: "running",
  },
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  }),
  p = await context.newPage();
p.setDefaultTimeout(30000);
p.on("pageerror", (e) => report.errors.push(e.message));
p.on("dialog", (d) => d.accept());
const call = (route, body, method) =>
  p.evaluate(
    async ({ route, body, method }) => {
      const r = await fetch("/api" + route, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { http: r.status, ...(await r.json()) };
    },
    { route, body, method },
  );
const mark = (s) => {
  report.checks.push(s);
  console.log("PASS", s);
};
async function login() {
  await p.goto(base + "/auth/login?switch=1");
  await p.locator("#username").fill(qa.b.username);
  await p.locator("#password").fill(qa.b.password);
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await p.waitForURL((u) => u.origin === base);
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await p.waitForTimeout(800);
}
try {
  await login();
  let u = (await call("/me")).user;
  if (Date.now() > previous.pendingLogoutJob.expires + 35000) {
    const j = await call("/exports/" + previous.pendingLogoutJob.id);
    assert.equal(j.status, "expired");
    assert.equal(u.freeCredits, previous.pendingLogoutJob.startingQuota);
    mark(
      "真实中心预占到期，用户已退出仍由后台恢复并返还，重新登录可见权威状态",
    );
  } else report.notes = ["预占尚未到期，最终检查再核对"];
  await p
    .getByTestId("image-input")
    .setInputFiles(path.resolve("tests/fixtures/synthetic-illustration.png"));
  const d = p.getByRole("dialog", { name: "上传图片并设置板子" });
  await d.getByRole("button", { name: "长边100格", exact: true }).tap();
  await p.waitForFunction(
    () =>
      document.querySelector(".import-preview-viewport")?.dataset.state ===
      "ready",
  );
  await p.screenshot({
    path: path.join(out, "mobile-upload.png"),
    fullPage: true,
  });
  await d.getByRole("button", { name: "确认生成", exact: true }).tap();
  await d.waitFor({ state: "hidden" });
  await p.waitForTimeout(800);
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.screenshot({ path: path.join(out, "mobile.png"), fullPage: true });
  const before = (await call("/me")).user.freeCredits;
  await p.getByLabel("下载图纸", { exact: true }).tap();
  await p.getByRole("button", { name: "确认并生成图纸", exact: true }).tap();
  const ready = p.getByRole("dialog", { name: "导出完成", exact: true });
  await ready.waitFor();
  let committedJob;
  await p.route("**/api/exports/*/file", async (route) => {
    committedJob = new URL(route.request().url()).pathname.split("/")[3];
    const r = await route.fetch();
    assert.equal(r.status(), 200);
    await route.abort("failed");
  });
  await ready.getByRole("button", { name: "下载文件", exact: true }).tap();
  await ready.getByText(/未确认结算成功/).waitFor();
  await p.unroute("**/api/exports/*/file");
  assert.ok(committedJob);
  const j = await call("/exports/" + committedJob);
  assert.equal(j.status, "ready");
  assert.equal((await call("/me")).user.freeCredits, before - 1);
  mark(
    "普通账号真实导出扣1次，浏览器响应丢失时显示未确认，权威任务已完成而不重复扣次",
  );
  const event = p.waitForEvent("download");
  await ready.getByRole("button", { name: "下载文件", exact: true }).tap();
  const download = await event;
  assert.equal(await download.failure(), null);
  const target = path.join(out, "downloads", "mobile-quota-chart.png");
  await download.saveAs(target);
  const bytes = fs.readFileSync(target);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const dimensions = await p.evaluate(
    async (bytes) => {
      const im = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const s = { width: im.width, height: im.height };
      im.close();
      return s;
    },
    [...bytes],
  );
  report.downloads.push({
    name: "mobile-quota-chart.png",
    bytes: bytes.length,
    ...dimensions,
  });
  assert.equal((await call("/me")).user.freeCredits, before - 1);
  mark("同一任务重试上传和实际下载成功，不重复消费；手机无横向溢出");
  await ready
    .getByRole("button", { name: "关闭／取消未完成任务", exact: true })
    .tap();
  await call("/logout", {});
  await login();
  const restored = await call("/exports/" + committedJob);
  assert.equal(restored.status, "ready");
  assert.equal((await call("/me")).user.freeCredits, before - 1);
  await p.getByRole("button", { name: /账号：/ }).tap();
  await p.screenshot({
    path: path.join(out, "mobile-account.png"),
    fullPage: true,
  });
  await p.getByLabel("关闭弹窗", { exact: true }).tap();
  mark("退出后重新登录可恢复已完成任务并领取既有文件");
  await context.storageState({ path: path.join(priv, "b-session.json") });
  fs.chmodSync(path.join(priv, "b-session.json"), 0o600);
  report.status = "passed";
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.status = "failed";
  report.error = String(e.stack).replace(
    /([?&](?:code|state|nonce)=)[^&\s"']+/g,
    "$1[redacted]",
  );
  console.error(report.error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(out, "followup-results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
