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
  a = await browser.newContext({
    storageState: path.join(priv, "a-session.json"),
    viewport: { width: 1488, height: 1056 },
  }),
  b = await browser.newContext({
    storageState: path.join(priv, "b-session.json"),
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }),
  p = await a.newPage(),
  bp = await b.newPage(),
  report = {
    date: new Date().toISOString(),
    checks: [],
    errors: [],
    assetErrors: [],
    status: "running",
  };
for (const page of [p, bp]) {
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("response", (r) => {
    if (r.url().includes("/assets/") && r.status() >= 400)
      report.assetErrors.push(new URL(r.url()).pathname + ":" + r.status());
  });
}
const call = (page, route, body) =>
  page.evaluate(
    async ({ route, body }) => {
      const r = await fetch("/api" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { http: r.status, ...(await r.json()) };
    },
    { route, body },
  );
const mark = (s) => {
  report.checks.push(s);
  console.log("PASS", s);
};
async function login(page, user) {
  await page.goto(base + "/auth/login?switch=1");
  await page.locator("#username").fill(user.username);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((u) => u.origin === base);
  await page.getByText("已自动保存", { exact: true }).waitFor();
}
try {
  await p.goto(base + "/workspace");
  await p.getByText("已自动保存", { exact: true }).waitFor();
  const user = (await call(p, "/me")).user;
  assert.equal(user.uid, previous.accountA.uid);
  assert.equal(user.studioAccess, true);
  assert.equal((await call(p, "/access/studio", {})).allowed, true);
  const work = await call(p, "/works/" + previous.accountA.projectId);
  assert.equal(work.project.name, "qa-public-A-雷电将军");
  assert.deepEqual(
    work.project.patternRle,
    JSON.parse(fs.readFileSync(path.join(out, "downloads/raiden.bead.json")))
      .patternRle,
  );
  report.deployment = await p.evaluate(
    async () => await (await fetch("/deployment.json")).json(),
  );
  mark(
    "最终服务重启后统一UID/会话/作品网格持久，正式HTTPS直达与刷新、access权限正常",
  );
  await bp.goto(base);
  const bu = (await call(bp, "/me")).user;
  assert.equal(bu.uid, previous.accountB.uid);
  const expired = await call(bp, "/exports/" + previous.pendingLogoutJob.id);
  assert.equal(expired.status, "expired");
  assert.equal(bu.freeCredits, previous.pendingLogoutJob.startingQuota - 1);
  assert.equal(bu.heldCredits, 0);
  mark("用户退出后的预占按中心真实时间到期，后台独立恢复，额度只返还一次");
  await bp.getByRole("button", { name: /账号：/ }).click();
  await bp.locator(".account-job").first().waitFor();
  await bp.screenshot({
    path: path.join(out, "mobile-account.png"),
    fullPage: true,
  });
  await bp.getByLabel("关闭弹窗", { exact: true }).click();
  await p.getByRole("button", { name: /账号：/ }).click();
  const security = p.getByRole("link", { name: "账号与安全", exact: true });
  assert.equal(
    await security.getAttribute("href"),
    "https://accounts.shizibandu.icu/?product=beadgrid&tab=security",
  );
  await security.click();
  await p.waitForURL((u) => u.origin === "https://accounts.shizibandu.icu");
  let cm = await call(p, "/me");
  if (cm.http !== 200) {
    await p.getByRole("link", { name: "登录", exact: true }).click();
    await p.waitForFunction(
      () =>
        !!document.querySelector("#username") ||
        !!document.querySelector('[aria-label="退出当前产品"]'),
    );
    if (await p.locator("#username").isVisible()) {
      await p.locator("#username").fill(qa.a.username);
      await p.locator("#password").fill(qa.a.password);
      await p.getByRole("button", { name: "登录", exact: true }).click();
    }
    await p.waitForFunction(
      () =>
        location.origin === "https://accounts.shizibandu.icu" &&
        !!document.querySelector('[aria-label="退出当前产品"]'),
    );
    cm = await call(p, "/me");
  }
  assert.equal(cm.http, 200);
  assert.equal(cm.user.uid, user.uid);
  const centerProducts = await p.evaluate(
    async () => await (await fetch("/api/entitlements")).json(),
  );
  assert.ok(
    centerProducts.find((e) => e.product.id === "beadgrid").membership.active,
  );
  assert.ok(
    centerProducts
      .filter((e) => e.product.id !== "beadgrid")
      .every((e) => !e.membership.active),
  );
  await p.goto(
    "https://accounts.shizibandu.icu/?product=beadgrid&tab=security&returnUrl=https%3A%2F%2Fexample.invalid",
  );
  const back = p.getByRole("link", {
    name: "返回豆格工坊 · 拼豆",
    exact: true,
  });
  assert.equal(await back.getAttribute("href"), base);
  await p.screenshot({
    path: path.join(out, "public-center.png"),
    fullPage: true,
  });
  await back.click();
  await p.waitForURL((u) => u.origin === base);
  await p.getByText("已自动保存", { exact: true }).waitFor();
  mark(
    "从拼豆进入公共个人中心，中心UID一致；拼豆会员不扩散到其他产品，返回地址仅来自登记",
  );
  const centerPage = await a.newPage();
  await centerPage.goto("https://accounts.shizibandu.icu/?product=beadgrid");
  await call(p, "/logout", {});
  assert.equal((await call(p, "/me")).user, null);
  assert.equal((await call(centerPage, "/me")).http, 200);
  mark("退出当前拼豆只销毁本产品会话，公共个人中心仍登录");
  await login(p, qa.a);
  await call(p, "/logout-all", {});
  assert.equal((await call(p, "/me")).user, null);
  assert.equal((await call(centerPage, "/me")).http, 401);
  assert.equal((await call(bp, "/me")).user.uid, previous.accountB.uid);
  mark("正式全局退出撤销同一QA账号的中心/产品会话，不影响另一个账号");
  await centerPage.close();
  await login(p, qa.a);
  await p.getByRole("button", { name: /账号：/ }).click();
  await p.locator(".account-job").first().waitFor();
  await p.screenshot({ path: path.join(out, "account.png"), fullPage: true });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.assetErrors, []);
  report.status = "passed";
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
    path.join(out, "final-results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
