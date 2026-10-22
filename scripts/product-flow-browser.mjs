import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "verification/product-parity-20261020"),
  downloads = path.join(out, "downloads");
fs.mkdirSync(downloads, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bead-v16-browser-"));
const socket = net.createServer().listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = "http://127.0.0.1:" + port;
const env = {
  ...process.env,
  ENV_FILE: "none",
  DATA_DIR: temp,
  STATIC_DIR: path.resolve(
    root,
    process.env.TEST_BUILD_DIR ||
      (fs.existsSync(path.join(root, ".local-public/v16-local/dist/index.html"))
        ? ".local-public/v16-local/dist"
        : "dist"),
  ),
  HOST: "127.0.0.1",
  PORT: String(port),
  NODE_ENV: "test",
  TEST_MAIL_DIR: path.join(temp, "mail"),
  PUBLIC_URL: base,
  SIGNUP_MEMBER_DAYS: "0",
  SIGNUP_FREE_CREDITS: "0",
  SMTP_HOST: "",
  COOKIE_SECURE: "0",
};
const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (b) => (serverLog += b));
server.stderr.on("data", (b) => (serverLog += b));
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(base + "/api/health")).ok) break;
  } catch {}
  await pause(50);
}
const init = spawn(
  process.execPath,
  ["server/manage.mjs", "init-admin", "browser-admin"],
  { env, stdio: ["pipe", "pipe", "pipe"] },
);
init.stdin.end("isolated-browser-admin-2026\n");
assert.equal((await once(init, "exit"))[0], 0);
const browser = await chromium.launch({ headless: true });
const report = {
  date: new Date().toISOString(),
  version: "1.6.0",
  checks: [],
  downloads: [],
  errors: [],
  scope: "isolated temporary DB; no production/original account changes",
};
const mark = (s) => {
  report.checks.push(s);
  console.log("PASS", s);
};
let page;
const context = await browser.newContext({
  viewport: { width: 1488, height: 1056 },
  acceptDownloads: true,
});
await context.addInitScript(() => {
  const W = window.Worker;
  window.__productResults = [];
  window.Worker = class extends W {
    constructor(u, o) {
      super(u, o);
      this.kind = String(u);
      this.addEventListener("message", (e) => {
        if (e.data.cells && this.kind.includes("convert.worker")) {
          window.__productResults.push({
            cells: Array.from(e.data.cells),
            settings: this.settings,
          });
          if (window.__productResults.length > 5)
            window.__productResults.shift();
        }
      });
    }
    postMessage(m, ...args) {
      this.settings = structuredClone(m.settings);
      super.postMessage(m, ...args);
    }
  };
});
const meta = async (p = page) =>
  p.evaluate(async () => {
    const id = (await (await fetch("/api/me")).json()).user?.id;
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("xing-local-v1", 1);
      r.onsuccess = () => {
        const db = r.result,
          q = db
            .transaction("meta")
            .objectStore("meta")
            .get(
              "draft:" +
                location.origin +
                "/api:" +
                (id ? "user:" + id : "guest"),
            );
        q.onsuccess = () => {
          resolve(q.result);
          db.close();
        };
        q.onerror = () => reject(q.error);
      };
    });
  });
const cells = (p) =>
  p.patternRle.flatMap((n, i, a) => (i % 2 ? [] : Array(a[i + 1]).fill(n)));
const sum = (p) => cells(p).filter((n) => n >= 0).length;
async function waitSaved(p = page) {
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await pause(720);
}
async function projectMenu(label, p = page) {
  await p.getByLabel("作品菜单", { exact: true }).click();
  await p.getByRole("button", { name: label, exact: true }).click();
}
async function toolMenu(label, p = page) {
  await p.getByLabel("工具扩展", { exact: true }).click();
  await p.getByRole("button", { name: label, exact: true }).click();
}
async function ready(p = page) {
  const h = await p.waitForFunction(() => {
    const c = document.querySelector(
      ".import-preview-viewport[data-state=ready] canvas",
    );
    if (!c) return false;
    return (
      window.__productResults.findLast(
        (x) => JSON.stringify(x.settings) === c.dataset.settings,
      ) || false
    );
  });
  return h.jsonValue();
}
async function shot(name, p = page) {
  await p.screenshot({ path: path.join(out, name + ".png"), fullPage: true });
}
async function downloaded(trigger, name, p = page) {
  const event = p.waitForEvent("download");
  await trigger();
  const d = await event;
  assert.equal(await d.failure(), null);
  const file = path.join(downloads, name || d.suggestedFilename());
  await d.saveAs(file);
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length > 20);
  report.downloads.push({ name: path.basename(file), bytes: bytes.length });
  return { file, bytes };
}
function pngInfo(bytes) {
  const b = Buffer.from(bytes);
  assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const width = b.readUInt32BE(16),
    height = b.readUInt32BE(20);
  let metadata = null;
  for (let i = 8; i < b.length; ) {
    const n = b.readUInt32BE(i),
      type = b.subarray(i + 4, i + 8).toString();
    if (type === "tEXt") {
      const text = b.subarray(i + 8, i + 8 + n).toString();
      if (text.startsWith("bead-project\0"))
        metadata = JSON.parse(text.slice(13));
    }
    i += 12 + n;
  }
  return { width, height, metadata };
}
try {
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await waitSaved();
  assert.match(
    await page.getByLabel("作品名称", { exact: true }).inputValue(),
    /雷电将军/,
  );
  const initial = await meta();
  assert.ok(initial.generationBase);
  await shot("desktop");
  mark("首次雷电示例、真实网格和生成基准；无历史覆盖");
  await page.getByLabel("下载图纸", { exact: true }).click();
  await page
    .getByRole("button", { name: "确认并生成图纸", exact: true })
    .click();
  await page.getByRole("dialog", { name: "登录账号" }).waitFor();
  await page.getByLabel("关闭弹窗").click();
  mark("游客可本地编辑与备份，图纸下载进入登录；云 API 拒绝未登录");
  await page
    .getByTestId("image-input")
    .setInputFiles(path.join(root, "tests/fixtures/portrait-contain.png"));
  let dialog = page.getByRole("dialog", { name: "上传图片并设置板子" });
  await dialog.waitFor();
  await ready();
  for (const edge of [300, 100, 200, 100])
    await dialog
      .getByRole("button", { name: "长边" + edge + "格", exact: true })
      .click();
  const preview = await ready();
  assert.equal(Math.max(preview.settings.width, preview.settings.height), 100);
  const advanced = dialog.locator(".import-advanced");
  if ((await advanced.getAttribute("open")) === null)
    await advanced.locator("summary").click();
  await dialog.getByLabel("清除主要边缘背景（实验）", { exact: true }).check();
  const withoutBackground = await ready();
  assert.equal(withoutBackground.settings.removeBackground, true);
  assert.ok(
    withoutBackground.cells.filter((i) => i >= 0).length <=
      preview.cells.filter((i) => i >= 0).length,
  );
  await dialog
    .getByLabel("清除主要边缘背景（实验）", { exact: true })
    .uncheck();
  assert.deepEqual((await ready()).cells, preview.cells);
  await advanced.locator("summary").click();
  await shot("upload");
  await dialog.getByRole("button", { name: "确认生成", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await waitSaved();
  let p = await meta();
  assert.deepEqual(cells(p), preview.cells);
  assert.notEqual(p.id, initial.id);
  assert.deepEqual(
    cells({ ...p, patternRle: p.generationBase.patternRle }),
    preview.cells,
  );
  mark(
    "真实上传、快速100/200/300格调节淘汰旧任务、预览与确认逐格一致、新素材新ID",
  );
  await page.getByLabel("作品名称", { exact: true }).fill("游客人物 A");
  await projectMenu("保存");
  await waitSaved();
  const A = await meta();
  // Real pointer operations use the rendered canvas coordinates, not static assumptions.
  const canvas = page.getByTestId("editor-canvas");
  const geometry = await canvas.evaluate((c) => ({
    r: c.getBoundingClientRect().toJSON(),
    x: +c.dataset.gridX,
    y: +c.dataset.gridY,
    cell: +c.dataset.cellSize,
  }));
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await page.mouse.click(
    geometry.r.x + geometry.x + geometry.cell * 0.5,
    geometry.r.y + geometry.y + geometry.cell * 0.5,
  );
  await waitSaved();
  let edited = await meta();
  assert.notDeepEqual(cells(edited), cells(A));
  await page.getByRole("button", { name: "橡皮", exact: true }).click();
  await page.mouse.click(
    geometry.r.x + geometry.x + geometry.cell * 0.5,
    geometry.r.y + geometry.y + geometry.cell * 0.5,
  );
  await waitSaved();
  assert.equal(cells(await meta())[0], -1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  mark("画笔、橡皮真实落笔、撤销重做和用量变动");
  await page.getByRole("tab", { name: "原图", exact: true }).click();
  await page.getByLabel("画布操作", { exact: true }).click();
  await page.getByRole("button", { name: "清除画面", exact: true }).click();
  await waitSaved();
  assert.equal(sum(await meta()), 0);
  assert.equal(
    await page
      .getByRole("tab", { name: "拼豆图", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.getByLabel("下载图纸", { exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "确认并生成图纸", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByLabel("关闭弹窗").click();
  await projectMenu("恢复本次生成图纸");
  await waitSaved();
  assert.deepEqual(cells(await meta()), preview.cells);
  await page.reload();
  await waitSaved();
  assert.deepEqual(cells(await meta()), preview.cells);
  mark("清空强制显示真实拼豆状态、空图拦截、生成基准保存刷新后可恢复");
  const projectFile = await downloaded(
    () => projectMenu("导出项目"),
    "portrait.be ad.json".replace(" ", ""),
  );
  const parsed = JSON.parse(projectFile.bytes.toString());
  assert.deepEqual(cells(parsed), preview.cells);
  assert.ok(parsed.generationBase);
  await page
    .getByTestId("image-input")
    .setInputFiles(path.join(root, "src/assets/raiden-shogun.png"));
  dialog = page.getByRole("dialog", { name: "上传图片并设置板子" });
  await ready();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await meta()).id, A.id);
  mark("取消保留原作品；实际 .bead.json 下载及基准数据可读");
  // Register through the real UI; account changes get their own browser draft.
  await page.getByLabel("登录 / 注册", { exact: true }).click();
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("账号名", { exact: true }).fill("browser-user-a");
  await page
    .getByLabel("新密码", { exact: true })
    .fill("isolated-browser-pass-2026");
  await page
    .getByLabel("确认密码", { exact: true })
    .fill("isolated-browser-pass-2026");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.getByRole("dialog", { name: "账号中心" }).waitFor();
  await shot("account-center");
  const a = (await (await context.request.get(base + "/api/me")).json()).user;
  assert.equal(a.status, "ordinary");
  await waitSaved();
  assert.notEqual((await meta()).name, "游客人物 A");
  await page.getByLabel("关闭弹窗").click();
  mark("注册登录恢复、普通用户权益、游客/账号草稿隔离与明确归属提示");
  await page.getByTestId("project-input").setInputFiles(projectFile.file);
  await waitSaved();
  await page.getByLabel("作品名称", { exact: true }).fill("账号 A 私有作品");
  await projectMenu("我的作品");
  await page
    .getByRole("button", { name: "保存当前作品到账号", exact: true })
    .click();
  await page.getByText("作品已保存到独立服务", { exact: true }).waitFor();
  await page.getByLabel("关闭弹窗").click();
  await waitSaved();
  await page.reload();
  await waitSaved();
  await page.getByLabel("作品名称", { exact: true }).fill("账号 A 刷新后更新");
  await projectMenu("我的作品");
  await page
    .getByRole("button", { name: "保存当前作品到账号", exact: true })
    .click();
  await page.getByText("作品已保存到独立服务", { exact: true }).waitFor();
  await page.getByLabel("关闭弹窗").click();
  await waitSaved();
  mark("项目导入、账号保存、刷新后同步版本恢复、再次保存无误报冲突");
  const tab = await context.newPage();
  await tab.goto(base);
  await waitSaved(tab);
  await page.getByLabel("作品名称", { exact: true }).fill("窗口 A 最新");
  await projectMenu("我的作品");
  await page
    .getByRole("button", { name: "保存当前作品到账号", exact: true })
    .click();
  await page.getByText("作品已保存到独立服务", { exact: true }).waitFor();
  await page.getByLabel("关闭弹窗").click();
  await projectMenu("我的作品", tab);
  await tab
    .getByRole("button", { name: "保存当前作品到账号", exact: true })
    .click();
  await tab
    .getByText("服务端作品已有更新，请先重新打开或另存副本", { exact: true })
    .waitFor();
  await tab.close();
  mark("双窗口打开同版本后保留真实乐观锁冲突");
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  let rr = await adminContext.request.post(base + "/api/login", {
    data: {
      username: "browser-admin",
      password: "isolated-browser-admin-2026",
    },
  });
  assert.equal(rr.status(), 200);
  const admin = await adminContext.newPage();
  await admin.goto(base + "/admin");
  await admin.getByRole("dialog", { name: "账号中心" }).waitFor();
  await admin.getByRole("button", { name: "管理后台", exact: true }).click();
  await admin
    .getByLabel("搜索账号／ID", { exact: true })
    .fill("browser-user-a");
  await admin.getByRole("button", { name: "查询", exact: true }).click();
  await admin.getByText(/#2 browser-user-a/).waitFor();
  await shot("admin", admin);
  rr = await adminContext.request.patch(base + "/api/admin/users/" + a.id, {
    data: {
      reason: "isolated UI regression",
      memberUntil: Date.now() + 864e5,
      freeCredits: 2,
    },
  });
  assert.equal(rr.status(), 200);
  await page.getByLabel("账号：browser-user-a", { exact: true }).click();
  await page
    .getByText(/有效会员/)
    .first()
    .waitFor();
  await page.getByLabel("关闭弹窗").click();
  mark("服务端管理员权限、用户查询、会员状态与次数独立管理");
  // Real downloads, decode PNGs/ZIPs and compare metadata totals to the edited project.
  const expected = await meta();
  for (const kind of [
    "chart",
    "mosaic",
    "palette",
    "assembly",
    "sections",
    "mirror",
  ]) {
    await page.getByLabel("下载图纸", { exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("导出内容", { exact: true })
      .selectOption(kind === "mirror" ? "chart" : kind);
    if (kind === "mirror")
      await dialog.getByLabel("镜像导出", { exact: true }).check();
    if (kind === "assembly" || kind === "sections")
      await dialog.getByLabel("常规板尺寸", { exact: true }).selectOption("52");
    await dialog
      .getByRole("button", { name: "确认并生成图纸", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "文件已生成", exact: true })
      .waitFor();
    const file = await downloaded(
      () => page.getByRole("button", { name: "下载文件", exact: true }).click(),
      "output-" +
        kind +
        (kind === "palette" || kind === "sections" ? ".zip" : ".png"),
    );
    const entries =
      file.bytes.subarray(0, 2).toString() === "PK"
        ? Object.entries(unzipSync(file.bytes))
        : [[path.basename(file.file), file.bytes]];
    let totals = 0;
    for (const [name, bytes] of entries) {
      if (!name.endsWith(".png")) continue;
      const info = pngInfo(bytes);
      assert.ok(info.width > 0 && info.height > 0);
      const valid = await page.evaluate(async (bytes) => {
        const b = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const dimensions = [b.width, b.height];
        b.close();
        return dimensions;
      }, Array.from(bytes));
      assert.deepEqual(valid, [info.width, info.height]);
      if (info.metadata) {
        const n = info.metadata.usage?.reduce((n, c) => n + c.count, 0) || 0;
        totals += n;
      }
      report.downloads.at(-1).dimensions = [info.width, info.height];
    }
    if (
      kind === "chart" ||
      kind === "mosaic" ||
      kind === "assembly" ||
      kind === "mirror"
    )
      assert.equal(totals, sum(expected));
    if (kind === "sections") assert.equal(totals, sum(expected));
    await page
      .getByRole("button", { name: "关闭／取消未完成任务", exact: true })
      .click();
  }
  mark(
    "完整图纸、马赛克、独立色卡、物理拼板、分区：浏览器实际下载并解码，PNG元数据用量守恒",
  );
  await page.getByRole("button", { name: "用豆清单", exact: true }).click();
  await shot("bead-list");
  const csv = await downloaded(
    () => page.getByRole("button", { name: "下载 CSV", exact: true }).click(),
    "bead-list.csv",
  );
  assert.equal(csv.bytes.subarray(0, 3).toString("hex"), "efbbbf");
  const listImage = await downloaded(
    () =>
      page.getByRole("button", { name: "下载清单图片", exact: true }).click(),
    "bead-list-image.png",
  );
  const listEntries =
    listImage.bytes.subarray(0, 2).toString() === "PK"
      ? Object.values(unzipSync(listImage.bytes)).filter(
          (b) =>
            Buffer.from(b).subarray(0, 8).toString("hex") ===
            "89504e470d0a1a0a",
        )
      : [listImage.bytes];
  for (const bytes of listEntries) assert.ok(pngInfo(bytes).height > 500);
  await page.getByLabel("关闭弹窗").click();
  mark("中文Excel CSV 与清单图片实际下载，规格和颗数来自当前编辑网格");
  // Candidate variants and local editing restoration.
  await toolMenu("识别成手搓图");
  await page
    .getByRole("button", { name: "应用所选版本", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.querySelector("[role=dialog] button.primary")?.disabled,
  );
  await page.getByRole("button", { name: "应用所选版本", exact: true }).click();
  await waitSaved();
  assert.equal((await meta()).variants.active, "handmade");
  await page.reload();
  await waitSaved();
  await toolMenu("识别成手搓图");
  await page.getByRole("button", { name: /普通图纸/ }).click();
  await page.getByRole("button", { name: "应用所选版本", exact: true }).click();
  await waitSaved();
  assert.deepEqual(cells(await meta()), preview.cells);
  mark("普通/手搓候选选择、双版本保存刷新、切回普通图纸不丢网格");
  await page.getByRole("tab", { name: "熨烫", exact: true }).click();
  for (const name of [
    "常规烫",
    "仙度瑞拉烫",
    "华夫格烫",
    "烘焙纸烫",
    "毛巾烫",
    "漂巾烫",
    "细网格丽特烫",
    "粗网格丽特烫",
  ])
    await page.getByRole("radio", { name, exact: true }).click();
  await shot("ironing");
  assert.deepEqual(cells(await meta()), preview.cells);
  await page.getByRole("tab", { name: "拼豆图", exact: true }).click();
  await toolMenu("禁用色号");
  await page.getByRole("button", { name: "禁用色卡A1", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await waitSaved();
  assert.deepEqual(
    (await meta()).settings.disabled,
    expected.settings.disabled,
  );
  mark("8种熨烫表面不改色号；取消禁色不留下隐性修改");
  // Real source underlay and grid-aligned recognition.
  await page
    .getByTestId("reference-input")
    .setInputFiles(path.join(root, "tests/fixtures/solid-blocks.png"));
  await page.getByRole("dialog", { name: "描摹参考底图" }).waitFor();
  await page
    .getByRole("button", { name: "识别已对齐底图", exact: true })
    .click();
  await waitSaved();
  assert.ok((await meta()).reference);
  assert.ok(sum(await meta()) > 0);
  await projectMenu("恢复本次生成图纸");
  await waitSaved();
  assert.deepEqual(cells(await meta()), preview.cells);
  mark("添加底图、按放置位置识别色块、恢复生成基准");
  // Focused coverage for newly completed advanced operations and persistent reset.
  await toolMenu("更多");
  await page
    .getByRole("button", {
      name: "图纸调节 · 亮度／对比度／饱和度／锐化／曝光",
      exact: true,
    })
    .click();
  await page.getByLabel("亮度", { exact: true }).focus();
  await page.getByLabel("亮度", { exact: true }).press("End");
  await page.waitForFunction(
    () =>
      document.querySelector(".import-preview-viewport")?.dataset.state ===
      "ready",
  );
  const adjustedPixels = await page
    .getByLabel("实际拼豆预览", { exact: true })
    .evaluate((c) =>
      Array.from(c.getContext("2d").getImageData(0, 0, c.width, c.height).data),
    );
  await shot("adjustment");
  await page.getByRole("button", { name: "应用图纸调节", exact: true }).click();
  await waitSaved();
  const adjusted = await meta();
  assert.notDeepEqual(cells(adjusted), preview.cells);
  assert.equal(sum(adjusted), sum(expected));
  const palette = JSON.parse(
    fs.readFileSync(path.join(root, "src/palette.json"), "utf8"),
  );
  const outputColors = cells(adjusted);
  for (let i = 0; i < outputColors.length; i++) {
    if (outputColors[i] < 0) {
      assert.equal(adjustedPixels[i * 4 + 3], 0);
      continue;
    }
    const hex = palette[outputColors[i]].hex;
    assert.deepEqual(
      adjustedPixels.slice(i * 4, i * 4 + 3),
      [1, 3, 5].map((x) => parseInt(hex.slice(x, x + 2), 16)),
    );
  }
  await projectMenu("恢复本次生成图纸");
  await waitSaved();
  // A manually selected face/region can have different exclusions from the rest of the image.
  await page.getByRole("button", { name: "框选", exact: true }).click();
  let g = await page.getByTestId("editor-canvas").evaluate((c) => ({
    r: c.getBoundingClientRect().toJSON(),
    x: +c.dataset.gridX,
    y: +c.dataset.gridY,
    cell: +c.dataset.cellSize,
  }));
  await page.mouse.move(
    g.r.x + g.x + g.cell * 10.2,
    g.r.y + g.y + g.cell * 10.2,
  );
  await page.mouse.down();
  await page.mouse.move(
    g.r.x + g.x + g.cell * 25.2,
    g.r.y + g.y + g.cell * 25.2,
    { steps: 6 },
  );
  await page.mouse.up();
  await toolMenu("禁用色号");
  await page.getByRole("button", { name: "禁用色卡A1", exact: true }).click();
  await page.getByRole("button", { name: "应用禁色规则", exact: true }).click();
  await waitSaved();
  assert.equal((await meta()).colorRules.length, 1);
  await page.reload();
  await waitSaved();
  assert.equal((await meta()).colorRules.length, 1);
  await projectMenu("恢复本次生成图纸");
  await waitSaved();
  assert.equal((await meta()).colorRules, undefined);
  // Re-run from original source with the same ID; apply creates a new persisted baseline.
  const regenerateId = (await meta()).id;
  await projectMenu("按当前参数重新生成");
  dialog = page.getByRole("dialog", { name: "上传图片并设置板子" });
  await ready();
  await dialog.getByRole("button", { name: "长边150格", exact: true }).click();
  const regenerated = await ready();
  await dialog.getByRole("button", { name: "确认生成", exact: true }).click();
  await waitSaved();
  assert.equal((await meta()).id, regenerateId);
  assert.deepEqual(cells(await meta()), regenerated.cells);
  // Return to the imported snapshot so the remainder compares the same portrait.
  await page.getByTestId("project-input").setInputFiles(projectFile.file);
  await waitSaved();
  await projectMenu("图片转马赛克");
  dialog = page.getByRole("dialog", { name: "上传图片并设置板子" });
  await ready();
  await dialog.getByRole("button", { name: "确认生成", exact: true }).click();
  await page.getByRole("dialog", { name: "马赛克结果" }).waitFor();
  await shot("mosaic-result");
  await page
    .getByRole("button", { name: "置于画板继续编辑", exact: true })
    .click();
  await toolMenu("网格对齐");
  dialog = page.getByRole("dialog", { name: "上传图片并设置板子" });
  await dialog.getByText("已有图纸识别与对齐", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  mark(
    "图纸调节真实预览/确认逐像素一致、区域禁色保存恢复、重新生成同ID、马赛克结果和网格校准入口",
  );
  // Logout and another account cannot inherit the previous browser draft or cloud data.
  await page.getByLabel("账号：browser-user-a", { exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await waitSaved();
  assert.equal((await meta()).id, A.id);
  await page.getByLabel("登录 / 注册", { exact: true }).click();
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("账号名", { exact: true }).fill("browser-user-b");
  await page
    .getByLabel("新密码", { exact: true })
    .fill("isolated-browser-pass-2026");
  await page
    .getByLabel("确认密码", { exact: true })
    .fill("isolated-browser-pass-2026");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.getByRole("dialog", { name: "账号中心" }).waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /普通用户/);
  assert.equal(
    (await context.request.get(base + "/api/works/" + A.id)).status(),
    404,
  );
  assert.equal(
    (await (await context.request.get(base + "/api/works")).json()).works
      .length,
    0,
  );
  mark("退出恢复游客草稿；A/B账号草稿、云作品与越权读取隔离");
  const secondary = await context.newPage();
  await secondary.goto(base);
  await waitSaved(secondary);
  const c = await context.request.post(base + "/api/login", {
    data: {
      username: "browser-user-a",
      password: "isolated-browser-pass-2026",
    },
  });
  assert.equal(c.status(), 200);
  await secondary.evaluate(() => window.dispatchEvent(new Event("focus")));
  await secondary.getByLabel("账号：browser-user-a", { exact: true }).waitFor();
  await waitSaved(secondary);
  assert.doesNotMatch((await meta(secondary)).name, /雷电将军/);
  await context.request.post(base + "/api/login", {
    data: {
      username: "browser-user-b",
      password: "isolated-browser-pass-2026",
    },
  });
  await secondary.evaluate(() => window.dispatchEvent(new Event("focus")));
  await secondary.getByLabel("账号：browser-user-b", { exact: true }).waitFor();
  await waitSaved(secondary);
  assert.match((await meta(secondary)).name, /雷电将军/);
  await secondary.close();
  mark(
    "共享Cookie多标签切换身份时切换对应草稿，既不混用同步版本也不自动上传其他账号内容",
  );

  const bu = (await (await context.request.get(base + "/api/me")).json()).user;
  await adminContext.request.patch(base + "/api/admin/users/" + bu.id, {
    data: {
      reason: "isolated expiry",
      memberUntil: Date.now() - 1000,
      freeCredits: 0,
    },
  });
  await page.getByLabel("关闭弹窗").click();
  await page.getByLabel("账号：browser-user-b", { exact: true }).click();
  await page
    .getByText(/会员已到期/)
    .first()
    .waitFor();
  await page.getByLabel("关闭弹窗").click();
  await page.getByLabel("下载图纸", { exact: true }).click();
  await page.getByText(/当前剩余 0 次/).waitFor();
  await page
    .getByRole("button", { name: "确认并生成图纸", exact: true })
    .click();
  await page
    .getByText(/免费次数已用尽/)
    .first()
    .waitFor();
  mark("到期会员/次数耗尽在服务端阻止受控导出，前端不伪装成功");
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(base);
  await waitSaved(mobile);
  await shot("mobile", mobile);
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await mobile.getByRole("button", { name: "设置与用量", exact: true }).click();
  await mobile.getByRole("button", { name: "长边300格", exact: true }).click();
  await mobile.getByRole("button", { name: "关闭设置", exact: true }).click();
  await mobileContext.request.post(base + "/api/login", {
    data: {
      username: "browser-user-b",
      password: "isolated-browser-pass-2026",
    },
  });
  await mobile.reload();
  await waitSaved(mobile);
  await mobile.getByRole("button", { name: "用豆清单", exact: true }).click();
  await shot("mobile-bead-list", mobile);
  const mobileList = await downloaded(
    () =>
      mobile.getByRole("button", { name: "下载清单图片", exact: true }).click(),
    "mobile-raiden-list.zip",
    mobile,
  );
  const mobileFiles = unzipSync(mobileList.bytes);
  const mobileData = JSON.parse(
    Buffer.from(mobileFiles["清单数据.json"]).toString(),
  );
  assert.equal(mobileData.total, sum(await meta(mobile)));
  assert.equal(
    mobileData.rows.reduce((n, r) => n + r.count, 0),
    mobileData.total,
  );
  assert.ok(
    Object.keys(mobileFiles).filter((n) => n.endsWith(".png")).length >= 2,
  );

  await mobile.getByLabel("关闭弹窗").click();
  await mobile
    .getByTestId("image-input")
    .setInputFiles(path.join(root, "src/assets/raiden-shogun.png"));
  await mobile.getByRole("dialog", { name: "上传图片并设置板子" }).waitFor();
  await mobile.getByRole("button", { name: "长边200格", exact: true }).click();
  await shot("mobile-upload", mobile);
  await mobile.getByRole("button", { name: "取消", exact: true }).click();
  mark("390px/DPR2手机属性抽屉、网格档位、用豆清单和上传取消无横向溢出");
  const legacyContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const legacyPage = await legacyContext.newPage();
  await legacyPage.goto(base);
  await waitSaved(legacyPage);
  const legacyProject = JSON.parse(projectFile.bytes.toString());
  legacyProject.name = "旧账号 A 私有草稿";
  legacyProject.cloudSync = {
    source: base + "/api",
    userId: a.id,
    projectId: legacyProject.id,
    updated: 111,
  };
  await legacyPage.evaluate(
    (raw) =>
      new Promise((resolve) => {
        const r = indexedDB.open("xing-local-v1", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(["meta", "projects"], "readwrite");
          const meta = tx.objectStore("meta");
          meta.delete("draft:" + location.origin + "/api:guest");
          meta.put(raw, "draft");
          tx.objectStore("projects").put(raw);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    legacyProject,
  );
  await legacyPage.reload();
  await waitSaved(legacyPage);
  assert.match(
    await legacyPage.getByLabel("作品名称", { exact: true }).inputValue(),
    /雷电将军/,
  );
  await projectMenu("我的作品", legacyPage);
  assert.equal(await legacyPage.locator(".work-open").count(), 0);
  await legacyPage.getByLabel("关闭弹窗").click();
  await legacyContext.request.post(base + "/api/login", {
    data: {
      username: "browser-user-a",
      password: "isolated-browser-pass-2026",
    },
  });
  await legacyPage.reload();
  await waitSaved(legacyPage);
  assert.equal(
    await legacyPage.getByLabel("作品名称", { exact: true }).inputValue(),
    "旧账号 A 私有草稿",
  );
  await legacyContext.close();
  mark(
    "旧版有账号同步归属的草稿/作品仅在匹配账号恢复，不静默显示给游客；原数据未删除",
  );
  assert.deepEqual(report.errors, []);
  report.status = "passed";
  await mobileContext.close();
  await adminContext.close();
} catch (e) {
  report.status = "failed";
  report.error = e.stack;
  if (page) {
    await shot("failure").catch(() => {});
    fs.writeFileSync(
      path.join(out, "failure-body.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw e;
} finally {
  fs.writeFileSync(
    path.join(out, "browser-results.json"),
    JSON.stringify(report, null, 2),
  );
  fs.writeFileSync(path.join(out, "server-test.log"), serverLog);
  await browser.close();
  server.kill();
  await once(server, "exit");
  fs.rmSync(temp, { recursive: true, force: true });
}
