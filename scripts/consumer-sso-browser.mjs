// HTTPS acceptance using fresh browsers and real native forms. No stored login cookies are injected.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const root = path.resolve(import.meta.dirname, ".."),
  base = "https://pindou.shizibandu.icu",
  center = "https://accounts.shizibandu.icu";
const out = path.join(root, "verification/consumer-sso-20261022"),
  priv = path.join(root, ".local-public/consumer-sso");
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(priv, { recursive: true });
const qaFile = path.join(priv, "credentials.json");
if (!fs.existsSync(qaFile))
  fs.writeFileSync(
    qaFile,
    JSON.stringify({
      username: "qa_sso_20261022_" + randomBytes(4).toString("hex"),
      password: "Aa7!" + randomBytes(12).toString("hex"),
    }),
    { mode: 0o600 },
  );
const qa = JSON.parse(fs.readFileSync(qaFile)),
  other = JSON.parse(
    fs.readFileSync(
      path.join(root, ".local-public/account-integration/qa-accounts.json"),
    ),
  ).a;
const report = {
  date: new Date().toISOString(),
  checks: [],
  errors: [],
  badRequests: [],
  status: "running",
};
const flush = () =>
  fs.writeFileSync(
    path.join(out, "browser-results.json"),
    JSON.stringify(report, null, 2),
  );
const mark = (s) => {
  report.checks.push(s);
  flush();
  console.log("PASS", s);
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1488, height: 1056 },
  acceptDownloads: true,
});
const second = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const p = await context.newPage(),
  bp = await second.newPage();
function watch(page) {
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (["localhost", "127.0.0.1"].includes(u.hostname))
      report.badRequests.push(u.origin + u.pathname);
  });
  page.on("dialog", (d) => d.accept());
}
watch(p);
watch(bp);
const get = async (page, url) => {
  const r = await page.request.get(url);
  return { http: r.status(), ...(await r.json()) };
};
const call = (page, route, body, method) =>
  page.evaluate(
    async ({ route, body, method }) => {
      const m = await (await fetch("/api/me")).json();
      const r = await fetch("/api" + route, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: {
          "Content-Type": "application/json",
          ...(m.csrf ? { "X-CSRF-Token": m.csrf } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { http: r.status(), ...(await r.json()) };
    },
    { route, body, method },
  );
const saved = (page) => page.getByText("已自动保存", { exact: true }).waitFor();
async function loginForm(page, user) {
  await page.locator("#username").fill(user.username);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}
async function account(page) {
  await page.getByRole("button", { name: /账号：/ }).click();
  await page.getByRole("link", { name: "账号与安全", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("link", { name: "统一管理后台", exact: true }).count(),
    0,
  );
}
async function enter(page, tab) {
  await account(page);
  await page
    .getByRole("link", {
      name: tab === "security" ? "账号与安全" : "会员／兑换",
      exact: true,
    })
    .click();
  await page.waitForURL(
    (u) =>
      u.origin === center &&
      u.pathname === "/" &&
      u.searchParams.get("tab") === tab,
  );
  await page
    .getByRole("heading", {
      name: tab === "security" ? "账号与安全" : "兑换会员或次数",
      exact: true,
    })
    .waitFor();
}
const back = async (page) => {
  await page
    .getByRole("link", { name: "返回豆格工坊 · 拼豆", exact: true })
    .click();
  await page.waitForURL(base + "/");
  await saved(page);
};
try {
  await p.goto(base);
  await saved(p);
  assert.equal((await get(p, base + "/api/me")).user, null);
  assert.equal((await get(p, center + "/api/me")).http, 401);
  assert.equal(
    (await context.cookies(center)).some(
      (c) => c.name === "__Host-zy_center" || c.name === "__Host-zy_admin",
    ),
    false,
  );
  await p.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await p
    .getByRole("link", { name: "登录／注册公共账号", exact: true })
    .click();
  await p.locator("#username").waitFor();
  const original = new URL(p.url());
  const origState = original.searchParams.get("state");
  assert.ok(origState);
  assert.notEqual(original.searchParams.get("prompt"), "login");
  await p.getByRole("link", { name: "忘记密码？", exact: true }).click();
  assert.equal(new URL(p.url()).searchParams.get("state"), origState);
  await p.getByRole("link", { name: /登录/ }).first().click();
  await p.locator("#username").waitFor();
  assert.equal(new URL(p.url()).searchParams.get("state"), origState);
  mark("注册/找回/登录页面往返保留同一消费者应用与授权上下文");
  const registered = path.join(priv, "registered.json");
  if (!fs.existsSync(registered)) {
    await p.getByRole("link", { name: "立即注册", exact: true }).click();
    await p.locator("#username").fill(qa.username);
    await p.locator("#name").fill("拼豆跨站验收");
    await p.locator("#password").fill(qa.password);
    await p.locator("#confirm").fill(qa.password);
    await p.screenshot({ path: path.join(out, "01-consumer-signup.png") });
    await p.getByRole("button", { name: "注册", exact: true }).click();
    await p.waitForURL(base + "/");
    await saved(p);
    const u = (await get(p, base + "/api/me")).user;
    fs.writeFileSync(
      registered,
      JSON.stringify({ uid: u.uid, date: new Date().toISOString() }),
      { mode: 0o600 },
    );
    mark(
      "全新无管理员/中心会话浏览器，从拼豆真实注册后回到拼豆并建立消费者会话",
    );
  } else {
    await loginForm(p, qa);
    await p.waitForURL(base + "/");
    await saved(p);
    mark("重复验收使用已实际注册的专用消费者，首次注册证据单独保留");
  }
  const user = (await get(p, base + "/api/me")).user;
  report.newConsumer = { uid: user.uid };
  assert.ok(user.uid);
  assert.equal((await get(p, center + "/api/me")).http, 401);
  const authRequests = [];
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin === center && u.pathname === "/auth/login")
      authRequests.push(u.pathname);
  });
  await enter(p, "security");
  assert.equal((await get(p, center + "/api/me")).user.uid, user.uid);
  assert.ok(authRequests.length === 1);
  await p.screenshot({ path: path.join(out, "02-center-security.png") });
  mark(
    "个人中心原先401：点击账号与安全自动OIDC、无需再次输入密码，security/product/统一UID正确",
  );
  await p.reload();
  assert.equal((await get(p, center + "/api/me")).user.uid, user.uid);
  await back(p);
  assert.equal((await get(p, base + "/api/me")).user.uid, user.uid);
  await enter(p, "redeem");
  assert.equal(new URL(p.url()).searchParams.get("product"), "beadgrid");
  assert.equal(authRequests.length, 1);
  await p.screenshot({ path: path.join(out, "03-center-redeem.png") });
  mark("返回拼豆会话保留；再次进入兑换直接复用同一中心会话，不重复授权");
  const adminChecks = [];
  for (const [url, method] of [
    ["/api/admin/users", "GET"],
    ["/api/admin/grants", "POST"],
    ["/api/admin/catalog/products", "PUT"],
    ["/admin/api/get-users?owner=consumers", "GET"],
  ]) {
    const r = await p.request.fetch(center + url, {
      method,
      headers: { Origin: center, "Content-Type": "application/json" },
      ...(method !== "GET"
        ? { data: { reason: "consumer must be rejected" } }
        : {}),
    });
    adminChecks.push({ url, method, status: r.status() });
    assert.ok([401, 403].includes(r.status()), JSON.stringify(adminChecks));
  }
  report.adminRejections = adminChecks;
  mark("消费者请求真实用户列表/发权益/改配置/原生管理API均401或403");
  const profile = await p
    .getByRole("button", { name: "账号与安全", exact: true })
    .click()
    .then(() => p.getByRole("link", { name: "修改密码与个人资料（新窗口）" }));
  const popupEvent = p.waitForEvent("popup");
  await profile.click();
  const native = await popupEvent;
  watch(native);
  await native.waitForURL(
    (u) =>
      u.hostname === "identity.accounts.shizibandu.icu" &&
      u.pathname === "/account",
  );
  await native.getByText("返回个人中心", { exact: true }).waitFor();
  assert.equal(
    (
      await native.request
        .get("https://identity.accounts.shizibandu.icu/api/get-account")
        .then((r) => r.json())
    ).data.owner,
    "consumers",
  );
  await native.screenshot({
    path: path.join(out, "04-native-consumer-profile.png"),
  });
  await native.getByRole("link", { name: "返回个人中心", exact: true }).click();
  await native.waitForURL(
    (u) => u.origin === center && u.searchParams.get("tab") === "security",
  );
  await native.close();
  mark("原生资料/密码入口保持consumers身份，返回个人中心security及产品上下文");
  // Clear only the center session through its actual logout UI; upstream SSO remains independent.
  await p.getByLabel("退出当前产品", { exact: true }).click();
  await p.waitForURL(center + "/");
  assert.equal((await get(p, center + "/api/me")).http, 401);
  await p.reload();
  assert.equal((await get(p, center + "/api/me")).http, 401);
  mark("个人中心当前退出/刷新保持未登录，不立即自动授权");
  const t1 = await context.newPage(),
    t2 = await context.newPage();
  watch(t1);
  watch(t2);
  await t1.goto(
    center +
      "/auth/login?product=beadgrid&tab=security&account=" +
      user.uid +
      "&switch=1",
  );
  await t1.locator("#username").waitFor();
  await t2.goto(
    center +
      "/auth/login?product=beadgrid&tab=redeem&account=" +
      user.uid +
      "&switch=1",
  );
  await t2.locator("#username").waitFor();
  await loginForm(t2, qa);
  await t2.waitForURL(
    (u) => u.origin === center && u.searchParams.get("tab") === "redeem",
  );
  await loginForm(t1, qa);
  await t1.waitForURL(
    (u) => u.origin === center && u.searchParams.get("tab") === "security",
  );
  assert.equal((await get(t1, center + "/api/me")).user.uid, user.uid);
  assert.equal((await get(t2, center + "/api/me")).user.uid, user.uid);
  await t1.reload();
  await t2.reload();
  assert.equal(new URL(t1.url()).searchParams.get("tab"), "security");
  assert.equal(new URL(t2.url()).searchParams.get("tab"), "redeem");
  mark("两个并行授权逆序完成，分别恢复security/redeem；刷新不串目标");
  const failed = await context.newPage();
  watch(failed);
  await failed.goto(
    center +
      "/auth/login?product=beadgrid&tab=redeem&account=" +
      user.uid +
      "&switch=1",
  );
  await failed.locator("#username").waitFor();
  const state = new URL(failed.url()).searchParams.get("state");
  await failed.goto(
    center +
      "/auth/callback/center?error=access_denied&state=" +
      encodeURIComponent(state),
  );
  await failed
    .getByRole("heading", { name: "登录未完成", exact: true })
    .waitFor();
  const retry = failed.getByRole("link", {
    name: "重新登录 / 切换账号",
    exact: true,
  });
  assert.match(await retry.getAttribute("href"), /tab=redeem/);
  await retry.click();
  await failed.waitForURL(
    (u) => u.origin === center && u.searchParams.get("tab") === "redeem",
  );
  mark("模拟提供方取消返回：不循环跳转，错误页可重试并恢复原目标");
  await failed.close();
  await t1.close();
  await t2.close();
  await p.goto(base);
  await saved(p);
  await p.getByLabel("作品名称", { exact: true }).fill("qa-sso-new-consumer");
  await p.getByLabel("作品名称", { exact: true }).blur();
  await p.getByLabel("作品菜单", { exact: true }).click();
  await p.getByRole("button", { name: "我的作品", exact: true }).click();
  if ((await get(p, base + "/api/works")).works.length) {
    await p
      .locator(".cloud-works")
      .getByRole("button", { name: "打开", exact: true })
      .first()
      .click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await p.getByLabel("作品菜单", { exact: true }).click();
    await p.getByRole("button", { name: "我的作品", exact: true }).click();
  }
  await p
    .getByRole("button", { name: "保存当前作品到账号", exact: true })
    .click();
  await p.getByText("作品已保存到独立服务", { exact: true }).waitFor();
  const works = (await get(p, base + "/api/works")).works;
  assert.ok(works.length >= 1);
  report.savedWork = works[0].id;
  await p.getByLabel("关闭弹窗", { exact: true }).click();
  await bp.goto(base + "/auth/login?switch=1");
  await loginForm(bp, other);
  await bp.waitForURL(base + "/");
  await saved(bp);
  const ou = (await get(bp, base + "/api/me")).user;
  report.otherConsumer = { uid: ou.uid };
  assert.notEqual(ou.uid, user.uid);
  assert.equal((await get(bp, base + "/api/works/" + works[0].id)).http, 404);
  assert.ok(
    !(await get(bp, base + "/api/works")).works.some(
      (w) => w.id === works[0].id,
    ),
  );
  await enter(bp, "security");
  assert.equal((await get(bp, center + "/api/me")).user.uid, ou.uid);
  await bp.screenshot({
    path: path.join(out, "05-mobile-consumer-security.png"),
    fullPage: true,
  });
  mark(
    "第二个已有消费者真实登录；两账号作品读取隔离、中心UID各自一致、手机入口正常",
  );
  // Deliberately put the center on B while product still uses A. No session cookies are injected.
  await p.goto(center + "/auth/login?switch=1");
  await loginForm(p, other);
  await p.waitForURL(center + "/");
  await p.goto(base);
  await saved(p);
  assert.equal((await get(p, base + "/api/me")).user.uid, user.uid);
  await account(p);
  await p.getByRole("link", { name: "账号与安全", exact: true }).click();
  await p
    .getByRole("heading", { name: "产品与个人中心的账号不一致", exact: true })
    .waitFor();
  assert.equal((await get(p, center + "/api/me")).user.uid, ou.uid);
  await p.screenshot({ path: path.join(out, "06-account-mismatch.png") });
  await p
    .getByRole("link", { name: "使用产品账号重新验证", exact: true })
    .click();
  await loginForm(p, qa);
  await p.waitForURL(
    (u) => u.origin === center && u.searchParams.get("tab") === "security",
  );
  assert.equal((await get(p, center + "/api/me")).user.uid, user.uid);
  mark("产品A/中心B被明确阻止；重新验证A后恢复，不合并或误归属");
  await back(p);
  await account(p);
  await p.getByRole("button", { name: "退出当前拼豆", exact: true }).click();
  await p.getByRole("button", { name: "登录 / 注册", exact: true }).waitFor();
  assert.equal((await get(p, base + "/api/me")).user, null);
  assert.equal((await get(p, center + "/api/me")).http, 200);
  await p.reload();
  await saved(p);
  assert.equal((await get(p, base + "/api/me")).user, null);
  mark("退出当前拼豆仅销毁产品会话，刷新不自动登录；中心会话保留");
  await p.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await p
    .getByRole("link", { name: "登录／注册公共账号", exact: true })
    .click();
  await p.waitForURL(base + "/");
  await saved(p);
  await account(p);
  await p.getByRole("button", { name: "切换公共账号", exact: true }).click();
  await p.locator("#username").waitFor();
  assert.equal(new URL(p.url()).searchParams.get("prompt"), "login");
  await loginForm(p, other);
  await p.waitForURL(base + "/");
  await saved(p);
  assert.equal((await get(p, base + "/api/me")).user.uid, ou.uid);
  assert.notEqual(
    await p.getByLabel("作品名称", { exact: true }).inputValue(),
    "qa-sso-new-consumer",
  );
  mark("明确切换要求重新认证，切换后不展示或自动保存上一账号草稿");
  await account(p);
  await p.getByRole("button", { name: "退出全部产品", exact: true }).click();
  await p.getByRole("button", { name: "登录 / 注册", exact: true }).waitFor();
  assert.equal((await get(p, base + "/api/me")).user, null);
  assert.equal((await get(bp, center + "/api/me")).http, 401);
  await p.reload();
  await saved(p);
  assert.equal((await get(p, base + "/api/me")).user, null);
  await p.goto(base + "/auth/login");
  await p.locator("#username").waitFor();
  mark("全部产品退出使同UID跨浏览器中心会话失效，上游SSO也不再自动登录");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.badRequests, []);
  report.status = "passed";
  flush();
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  await p
    .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
    .catch(() => {});
  flush();
  throw e;
} finally {
  await browser.close();
}
