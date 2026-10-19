import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "verification/review-four-fixes");
fs.mkdirSync(out, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(root, ".local-public/four-fixes-"));
fs.cpSync(path.join(root, "server"), path.join(sandbox, "server"), {
  recursive: true,
});
fs.symlinkSync(
  path.resolve(root, process.env.TEST_BUILD_DIR || "dist"),
  path.join(sandbox, "dist"),
);
const socket = net.createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [path.join(sandbox, "server/index.mjs")],
  {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: path.join(sandbox, "data"),
      TRUSTED_PROXIES: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (x) => (serverLog += x));
server.stderr.on("data", (x) => (serverLog += x));
const report = {
  date: new Date().toISOString(),
  base,
  isolatedData: true,
  checks: [],
  errors: [],
};
const mark = (name) => {
  report.checks.push(name);
  console.log("PASS", name);
};
let browser;
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    if (server.exitCode !== null || n === 99)
      throw Error(serverLog || "server timeout");
    await pause(30);
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    // Deterministic failure/cancellation injection; production code is unchanged.
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.conversion = String(url).includes("convert.worker");
      }
      postMessage(message, ...args) {
        if (this.conversion && window.__conversionFault === "hold") return;
        if (this.conversion && window.__conversionFault === "fail") {
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: { error: "定向测试：生成失败" },
                }),
              ),
            10,
          );
          return;
        }
        return super.postMessage(message, ...args);
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  async function menuAction(name, p = page) {
    const menu = p.locator(".project-menu");
    if (await menu.count()) {
      if ((await menu.getAttribute("open")) === null)
        await menu.locator("summary").click();
    }
    await p.getByRole("button", { name, exact: true }).click();
  }
  const waitSave = async () => {
    await page.getByText("已自动保存", { exact: true }).waitFor();
  };
  const works = () =>
    page.getByRole("dialog", { name: "我的作品", exact: true });
  async function close() {
    const d = page.getByRole("dialog");
    if (await d.count())
      await d
        .getByRole("button", { name: /^(关闭弹窗|返回画板)$/ })
        .first()
        .click();
  }
  async function stored(store, key) {
    return page.evaluate(
      ({ store, key }) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open("xing-local-v1", 1);
          req.onsuccess = () => {
            const db = req.result,
              tx = db.transaction(store, "readonly");
            const q =
              key === undefined
                ? tx.objectStore(store).getAll()
                : tx.objectStore(store).get(key);
            q.onsuccess = () => resolve(q.result);
            q.onerror = () => reject(q.error);
            tx.oncomplete = () => db.close();
          };
        }),
      { store, key },
    );
  }
  async function snapshot() {
    const pending = page.waitForEvent("download");
    await menuAction("导出项目");
    const dl = await pending,
      stream = await dl.createReadStream(),
      parts = [];
    for await (const c of stream) parts.push(c);
    return JSON.parse(Buffer.concat(parts));
  }
  const inputA = fs.readFileSync(
    path.join(root, "tests/fixtures/synthetic-illustration.png"),
  );
  const inputB = fs.readFileSync(
    path.join(root, "tests/fixtures/solid-blocks.png"),
  );
  async function upload(buffer, drop = false) {
    if (drop) {
      await page.locator(".workspace").evaluate(
        (node, bytes) => {
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([new Uint8Array(bytes)], "same.png", {
              type: "image/png",
            }),
          );
          node.dispatchEvent(
            new DragEvent("drop", {
              dataTransfer: transfer,
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        [...buffer],
      );
    } else
      await page
        .getByTestId("image-input")
        .setInputFiles({ name: "same.png", mimeType: "image/png", buffer });
    await page.getByRole("dialog", { name: "上传图片并设置板子" }).waitFor();
  }
  async function generate(height = 16, waitForClose = true) {
    const d = page.getByRole("dialog", { name: "上传图片并设置板子" });
    await d.getByRole("button", { name: /^原图完整置入/ }).click();
    for (const [label, value] of [
      ["导入宽度", "16"],
      ["导入高度", String(height)],
    ]) {
      await d.getByLabel(label, { exact: true }).fill(value);
      await d.getByLabel(label, { exact: true }).press("Tab");
    }
    await d.getByRole("button", { name: "确认生成", exact: true }).click();
    if (waitForClose) await d.waitFor({ state: "hidden" });
  }
  async function generated() {
    await page.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
    await waitSave();
  }
  async function localOpen(name) {
    await menuAction("我的作品");
    await works()
      .locator(".work-open")
      .filter({ has: page.getByText(name, { exact: true }) })
      .click();
    await waitSave();
  }
  async function cloudSave(p = page, expected = 200) {
    await menuAction("我的作品", p);
    const response = p.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes("/api/works/"),
    );
    await p
      .getByRole("button", { name: "保存当前作品到账号", exact: true })
      .click();
    const r = await response;
    assert.equal(r.status(), expected, await r.text());
    const body = r.request().postDataJSON();
    await p
      .getByRole("dialog", { name: "我的作品" })
      .getByRole("button", { name: "关闭弹窗", exact: true })
      .click();
    await p.getByText("已自动保存", { exact: true }).waitFor();
    return body;
  }
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await waitSave();
  await upload(inputA);
  await generate();
  await generated();
  await page.getByLabel("作品名称").fill("作品 A");
  await menuAction("保存");
  await waitSave();
  const a = await snapshot();
  await upload(inputB, true);
  await generate();
  await generated();
  await page.getByLabel("作品名称").fill("作品 B");
  await menuAction("保存");
  await waitSave();
  const b = await snapshot();
  assert.notEqual(a.id, b.id);
  assert.notDeepEqual(a.patternRle, b.patternRle);
  await page.reload();
  await waitSave();
  assert.deepEqual((await snapshot()).patternRle, b.patternRle);
  await localOpen("作品 A");
  assert.deepEqual((await snapshot()).patternRle, a.patternRle);
  await localOpen("作品 B");
  assert.deepEqual((await snapshot()).patternRle, b.patternRle);
  const beforeDates = Object.fromEntries(
    (await stored("projects")).map((p) => [p.id, p.updatedAt]),
  );
  for (let i = 0; i < 2; i++) {
    await localOpen("作品 A");
    await menuAction("我的作品");
    await close();
    await page.reload();
    await waitSave();
  }
  assert.deepEqual(
    Object.fromEntries(
      (await stored("projects")).map((p) => [p.id, p.updatedAt]),
    ),
    beforeDates,
  );
  await menuAction("我的作品");
  await works()
    .locator(".work-open")
    .getByText("作品 B", { exact: true })
    .waitFor();
  const order = await works().locator(".work-open b").allTextContents();
  assert(
    order.indexOf("作品 B") < order.indexOf("作品 A"),
    JSON.stringify({ order, beforeDates }),
  );
  await close();
  mark(
    "点击上传A、同名拖放B生成后分别保存，刷新可分别打开；反复查看不改变排序/更新时间",
  );
  await localOpen("作品 B");
  await menuAction("图片转马赛克");
  await generate(17);
  await generated();
  const regen = await snapshot();
  assert.equal(regen.id, b.id);
  assert.equal(regen.height, 17);
  await button("撤销").click();
  assert.equal((await snapshot()).height, 16);
  await button("重做").click();
  assert.equal((await snapshot()).height, 17);
  const stable = await snapshot();
  await upload(inputA);
  await close();
  assert.deepEqual(await snapshot(), stable);
  await page.evaluate(() => (window.__conversionFault = "hold"));
  await upload(inputA);
  await generate(16, false);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.deepEqual(await snapshot(), stable);
  await page.evaluate(() => (window.__conversionFault = "fail"));
  await upload(inputA);
  await generate(16, false);
  await page
    .getByRole("alert")
    .filter({ hasText: "定向测试：生成失败" })
    .waitFor();
  await close();
  assert.deepEqual(await snapshot(), stable);
  await page.evaluate(() => (window.__conversionFault = null));
  mark(
    "重新生成保留ID且支持撤销重做；关闭上传、取消处理及注入生成失败均保留原项目",
  );

  const credentials = {
    username: "fixes-account-a",
    password: "temporary-fixes-password-a",
  };
  assert.equal(
    (
      await context.request.post(base + "/api/register", { data: credentials })
    ).status(),
    201,
  );
  await page.reload();
  await waitSave();
  await page.getByLabel("作品名称").fill("账号 A 初稿");
  await cloudSave();
  const meta = (await stored("meta", "draft")).cloudSync;
  assert.equal(meta.projectId, stable.id);
  assert.equal(meta.source, base + "/api");
  assert(meta.updated > 0);
  const exported = await snapshot();
  assert.equal(exported.cloudSync, undefined);
  await page.reload();
  await waitSave();
  await page.getByLabel("作品名称").fill("账号 A 刷新后");
  assert.equal((await cloudSave()).expectedUpdated, meta.updated);
  mark(
    "账号作品保存后刷新、编辑再次保存成功；同步元数据已持久化且不进入项目文件",
  );
  const pageB = await context.newPage();
  pageB.setDefaultTimeout(20000);
  await pageB.goto(base, { waitUntil: "domcontentloaded" });
  await pageB.getByText("已自动保存", { exact: true }).waitFor();
  await menuAction("我的作品", pageB);
  await pageB
    .locator(".cloud-works")
    .getByRole("button", { name: "打开", exact: true })
    .click();
  await pageB.getByText("已自动保存", { exact: true }).waitFor();
  await page.getByLabel("作品名称").fill("账号 A 窗口一");
  await cloudSave();
  await pageB.getByLabel("作品名称").fill("账号 A 窗口二");
  await cloudSave(pageB, 409);
  await pageB.close();
  const cloudA = await context.request.get(base + "/api/works/" + stable.id);
  assert.equal((await cloudA.json()).project.name, "账号 A 窗口一");
  mark("两个窗口基于同一版本：窗口一保存后，窗口二仍返回真实409且未覆盖窗口一");

  await page.getByTestId("project-input").setInputFiles({
    name: "import.bead.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...exported, cloudSync: meta })),
  });
  await waitSave();
  assert.equal((await cloudSave(page, 428)).expectedUpdated, undefined);
  await page
    .getByRole("alert")
    .filter({ hasText: "缺少此账号作品的同步版本" })
    .waitFor();
  mark("同ID导入文件不继承内存或伪造的同步版本，明确428恢复/另存提示");
  await menuAction("我的作品");
  await works()
    .locator(".cloud-works")
    .getByRole("button", { name: "打开", exact: true })
    .click();
  await waitSave();
  await cloudSave();
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("xing-local-v1", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("meta", "readwrite"),
            store = tx.objectStore("meta"),
            q = store.get("draft");
          q.onsuccess = () => {
            const raw = q.result;
            raw.cloudSync.source = "https://other-service.invalid/api";
            store.put(raw, "draft");
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await waitSave();
  assert.equal((await cloudSave(page, 428)).expectedUpdated, undefined);
  mark("服务来源不匹配的已存同步版本不被采用");
  await menuAction("我的作品");
  await works().getByRole("button", { name: "退出登录", exact: true }).click();
  await close();
  await waitSave();
  assert.equal((await stored("meta", "draft")).cloudSync, undefined);
  const other = {
    username: "fixes-account-b",
    password: "temporary-fixes-password-b",
  };
  assert.equal(
    (
      await context.request.post(base + "/api/register", { data: other })
    ).status(),
    201,
  );
  await page.reload();
  await waitSave();
  await page.getByLabel("作品名称").fill("账号 B 独立作品");
  assert.equal((await cloudSave()).expectedUpdated, undefined);
  const isolatedA = await browser.newContext();
  assert.equal(
    (
      await isolatedA.request.post(base + "/api/login", { data: credentials })
    ).status(),
    200,
  );
  const originalA = await isolatedA.request.get(
    base + "/api/works/" + stable.id,
  );
  assert.equal(originalA.status(), 200);
  assert.equal((await originalA.json()).project.name, "账号 A 窗口一");
  await isolatedA.close();
  mark("退出清除当前同步信息，切换账号保存不复用旧账号版本，账号A作品不被覆盖");
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.stack;
  process.exitCode = 1;
  console.error(e);
} finally {
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill("SIGTERM");
  await once(server, "exit");
  fs.rmSync(sandbox, { recursive: true, force: true });
}
