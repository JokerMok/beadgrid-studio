import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "verification/consumer-sso-20261022"),
  base = "https://pindou.shizibandu.icu";
fs.mkdirSync(path.join(out, "downloads"), { recursive: true });
const qa = JSON.parse(
  fs.readFileSync(
    path.join(root, ".local-public/account-integration/qa-accounts.json"),
  ),
).a;
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    acceptDownloads: true,
  }),
  p = await context.newPage();
p.setDefaultTimeout(30000);
const report = { checks: [], downloads: [], errors: [], status: "running" };
p.on("pageerror", (e) => report.errors.push(e.message));
p.on("dialog", (d) => d.accept());
const save = () =>
  fs.writeFileSync(
    path.join(out, "studio-smoke.json"),
    JSON.stringify(report, null, 2),
  );
const mark = (s) => {
  report.checks.push(s);
  save();
  console.log("PASS", s);
};
const saved = () => p.getByText("已自动保存", { exact: true }).waitFor();
const api = async (route) => {
  const r = await p.request.get(base + "/api" + route);
  assert.equal(r.status(), 200);
  return r.json();
};
async function snap() {
  const u = (await api("/me")).user;
  return p.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("beadgrid-public-accounts-v1", 1);
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
          q.onerror = () => reject(q.error);
        };
      }),
    u.id,
  );
}
const cells = (v) =>
  v.patternRle.flatMap((x, i, a) => (i % 2 ? [] : Array(a[i + 1]).fill(x)));
async function download(trigger) {
  const event = p.waitForEvent("download");
  await trigger();
  const d = await event;
  assert.equal(await d.failure(), null);
  const target = path.join(out, "downloads", d.suggestedFilename());
  await d.saveAs(target);
  const buf = fs.readFileSync(target);
  report.downloads.push({ file: path.basename(target), bytes: buf.length });
  assert.ok(buf.length > 20);
  return buf;
}
const menu = async (name) => {
  await p.getByLabel("作品菜单", { exact: true }).click();
  await p.getByRole("button", { name, exact: true }).click();
};
try {
  await p.goto(base + "/auth/login?switch=1");
  await p.locator("#username").fill(qa.username);
  await p.locator("#password").fill(qa.password);
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await p.waitForURL(base + "/");
  await saved();
  const user = (await api("/me")).user;
  assert.equal(user.exportAccess, true);
  await p.getByRole("button", { name: /账号：/ }).click();
  assert.equal(await p.getByText("统一管理后台", { exact: true }).count(), 0);
  await p.screenshot({ path: path.join(out, "00-product-account.png") });
  await p.getByLabel("关闭弹窗", { exact: true }).click();
  if (process.env.BEADGRID_SMOKE_RESUME) {
    const previous = JSON.parse(
      fs.readFileSync(path.join(out, "studio-smoke.json")),
    );
    report.checks = previous.checks;
    report.resumed = "上传编辑已通过，仅续测下载与重启";
    await menu("我的作品");
    await p
      .locator(".cloud-works > div")
      .filter({ hasText: "qa-sso-upload-download" })
      .first()
      .getByRole("button", { name: "打开", exact: true })
      .click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await saved();
  } else {
    await p
      .getByTestId("image-input")
      .setInputFiles(path.join(root, "src/assets/raiden-shogun.png"));
    const imp = p.getByRole("dialog", { name: "上传图片并设置板子" });
    await imp.getByRole("button", { name: "长边100格", exact: true }).click();
    await p.waitForFunction(
      () =>
        document.querySelector(".import-preview-viewport")?.dataset.state ===
        "ready",
    );
    await imp.getByRole("button", { name: "确认生成", exact: true }).click();
    await imp.waitFor({ state: "hidden" });
    await saved();
    const before = await snap();
    assert.equal(Math.max(before.width, before.height), 100);
    const pos = await p
      .getByTestId("editor-canvas")
      .evaluate((e) => ({
        r: e.getBoundingClientRect().toJSON(),
        x: +e.dataset.gridX,
        y: +e.dataset.gridY,
        cell: +e.dataset.cellSize,
      }));
    const x = pos.r.x + pos.x + pos.cell * 0.5,
      y = pos.r.y + pos.y + pos.cell * 0.5;
    await p.getByRole("button", { name: "画笔", exact: true }).click();
    await p.mouse.click(x, y);
    await saved();
    await p.waitForTimeout(450);
    const painted = await snap();
    assert.notDeepEqual(cells(painted), cells(before));
    await p.getByRole("button", { name: "橡皮", exact: true }).click();
    await p.mouse.click(x, y);
    await saved();
    await p.waitForTimeout(450);
    assert.equal(cells(await snap())[0], -1);
    await p.getByRole("button", { name: "撤销", exact: true }).click();
    await saved();
    await p.waitForTimeout(450);
    assert.deepEqual(cells(await snap()), cells(painted));
    mark("真实雷电原图上传、100格转换、画笔/橡皮/撤销与当前网格一致");
  }
  await p
    .getByLabel("作品名称", { exact: true })
    .fill("qa-sso-upload-download");
  await p.getByLabel("作品名称", { exact: true }).blur();
  await saved();
  await p.waitForTimeout(450);
  let current = await snap();
  await menu("我的作品");
  await p
    .getByRole("button", { name: "保存当前作品到账号", exact: true })
    .click();
  await p.getByText("作品已保存到独立服务", { exact: true }).waitFor();
  await p.getByLabel("关闭弹窗", { exact: true }).click();
  const cloud = await api("/works/" + current.id);
  assert.deepEqual(cloud.project.patternRle, current.patternRle);
  const project = JSON.parse(
    (await download(() => menu("导出项目"))).toString(),
  );
  assert.deepEqual(project.patternRle, current.patternRle);
  await p.getByRole("button", { name: "用豆清单", exact: true }).click();
  const list = p.getByRole("dialog", { name: "用豆清单", exact: true });
  await download(() =>
    list.getByRole("button", { name: "下载 CSV", exact: true }).click(),
  );
  await p.getByLabel("关闭弹窗", { exact: true }).click();
  await p.getByLabel("下载图纸", { exact: true }).click();
  await p.getByRole("button", { name: "确认并生成图纸", exact: true }).click();
  const ready = p.getByRole("dialog", { name: "导出完成", exact: true });
  await ready.waitFor();
  const png = await download(() =>
    ready.getByRole("button", { name: "下载文件", exact: true }).click(),
  );
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  report.png = await p.evaluate(
    async (bytes) => {
      const im = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const d = { width: im.width, height: im.height };
      im.close();
      return d;
    },
    [...png],
  );
  await ready
    .getByRole("button", { name: "关闭／取消未完成任务", exact: true })
    .click();
  mark("账号作品和项目文件网格一致，CSV及正式图纸PNG实际下载并解码");
  execFileSync(
    "/usr/bin/ssh",
    [
      "-o",
      "IPQoS=none",
      "-S",
      "/tmp/beadgrid-sso-master",
      "tencent-main",
      "sudo systemctl restart beadgrid-studio",
    ],
    { timeout: 20000 },
  );
  for (let i = 0; i < 30; i++) {
    try {
      if ((await p.request.get(base + "/api/health")).ok()) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal((await api("/me")).user.uid, user.uid);
  assert.deepEqual(
    (await api("/works/" + current.id)).project.patternRle,
    current.patternRle,
  );
  await p.reload();
  await saved();
  await p.waitForTimeout(450);
  assert.deepEqual((await snap()).patternRle, current.patternRle);
  await p.screenshot({ path: path.join(out, "08-studio-after-restart.png") });
  mark("产品服务重启后账号关联/会话/云作品/本地草稿及刷新恢复保留");
  assert.deepEqual(report.errors, []);
  report.status = "passed";
  save();
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  await p
    .screenshot({ path: path.join(out, "smoke-failure.png"), fullPage: true })
    .catch(() => {});
  save();
  throw e;
} finally {
  await browser.close();
}
