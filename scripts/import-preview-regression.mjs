import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.TEST_URL || "http://127.0.0.1:4173";
const portrait =
  process.env.TEST_PORTRAIT_PATH ||
  path.join(root, "tests/fixtures/portrait-contain.png");
const fullFigure = path.join(root, "src/assets/raiden-shogun.png");
const out = path.join(root, "verification/import-preview");
fs.mkdirSync(out, { recursive: true });
const report = { date: new Date().toISOString(), base, checks: [], errors: [] };
const mark = (name) => {
  report.checks.push(name);
  console.log("PASS", name);
};
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1024 },
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    const Original = window.Worker;
    window.__conversionLog = {
      started: 0,
      active: 0,
      maxActive: 0,
      completed: [],
    };
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.isConversion = String(url).includes("convert.worker");
        if (this.isConversion) {
          const log = window.__conversionLog;
          log.started++;
          log.active++;
          log.maxActive = Math.max(log.active, log.maxActive);
          this.addEventListener("message", ({ data }) => {
            if (data.cells) {
              log.completed.push({
                settings: this.settings,
                cells: Array.from(data.cells),
              });
              if (log.completed.length > 8) log.completed.shift();
            }
          });
        }
      }
      postMessage(message, ...args) {
        if (this.isConversion) {
          this.settings = structuredClone(message.settings);
          if (window.__conversionFault === "hold") return;
          if (window.__conversionFault === "fail") {
            setTimeout(
              () =>
                this.dispatchEvent(
                  new MessageEvent("message", {
                    data: { error: "定向测试：预览失败" },
                  }),
                ),
              25,
            );
            return;
          }
          if (window.__conversionDelay) {
            const delay = window.__conversionDelay;
            this.delayed = setTimeout(
              () => super.postMessage(message, ...args),
              delay,
            );
            return;
          }
        }
        super.postMessage(message, ...args);
      }
      terminate() {
        clearTimeout(this.delayed);
        if (this.isConversion && !this.ended) {
          this.ended = true;
          window.__conversionLog.active--;
        }
        super.terminate();
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const dialog = () => page.getByRole("dialog", { name: "上传图片并设置板子" });
  const saved = () => page.getByText("已自动保存", { exact: true }).waitFor();
  async function snapshot() {
    return page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("xing-local-v1", 1);
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction("meta").objectStore("meta").get("draft:"+window.location.origin+"/api:guest");
            q.onsuccess = () => {
              resolve(q.result);
              db.close();
            };
            q.onerror = () => reject(q.error);
          };
          r.onerror = () => reject(r.error);
        }),
    );
  }
  const cellsOf = (raw) => {
    const cells = [];
    for (let i = 0; i < raw.patternRle.length; i += 2)
      cells.push(...Array(raw.patternRle[i + 1]).fill(raw.patternRle[i]));
    return cells;
  };
  const sameGrid = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    const mismatch = actual.findIndex((c, i) => c !== expected[i]);
    assert.equal(mismatch, -1, `逐格差异从${mismatch}开始`);
  };
  async function menu(name) {
    const m = page.locator(".project-menu");
    if ((await m.getAttribute("open")) === null)
      await m.locator("summary").click();
    await button(name).click();
  }
  async function upload(file, drop = false) {
    if (drop)
      await page.evaluate(
        async ({ data, name }) => {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          const dt = new DataTransfer();
          dt.items.add(new File([bytes], name, { type: "image/png" }));
          document
            .querySelector("main")
            .dispatchEvent(
              new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
            );
        },
        {
          data: fs.readFileSync(file).toString("base64"),
          name: path.basename(file),
        },
      );
    else await page.getByTestId("image-input").setInputFiles(file);
    await dialog().waitFor();
  }
  async function ready() {
    const result = await page.waitForFunction(() => {
      const viewport = document.querySelector(
        '.import-preview-viewport[data-state="ready"]',
      );
      const canvas = viewport?.querySelector("canvas");
      if (!canvas) return false;
      const settings = JSON.parse(canvas.dataset.settings);
      const value = (label) =>
        Number(
          document
            .querySelector('[role="dialog"]')
            .querySelector(`[aria-label="${label}"]`).value,
        );
      if (
        settings.width !== value("导入宽度") ||
        settings.height !== value("导入高度") ||
        settings.limit !== value("最大颜色数数值")
      )
        return false;
      return (
        window.__conversionLog.completed.findLast(
          (entry) => JSON.stringify(entry.settings) === canvas.dataset.settings,
        ) || false
      );
    });
    return result.jsonValue();
  }
  async function verifyPreviewPixels(conversion) {
    const actual = await dialog()
      .locator('canvas[aria-label="实际拼豆预览"]')
      .evaluate((canvas) =>
        Array.from(
          canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data,
        ),
      );
    const palette = JSON.parse(
      fs.readFileSync(path.join(root, "src/palette.json"), "utf8"),
    );
    assert.equal(actual.length, conversion.cells.length * 4);
    for (let i = 0; i < conversion.cells.length; i++) {
      const c = conversion.cells[i],
        offset = i * 4;
      if (c < 0) assert.equal(actual[offset + 3], 0, `空格${i}预览不透明`);
      else {
        const hex = palette[c].hex;
        for (let k = 0; k < 3; k++)
          assert.equal(
            actual[offset + k],
            parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16),
            `预览第${i}格RGB不符`,
          );
        assert.equal(actual[offset + 3], 255);
      }
    }
  }
  async function grid(w, h) {
    await dialog()
      .getByLabel("输出网格比例", { exact: true })
      .selectOption("custom");
    await dialog().getByLabel("导入宽度", { exact: true }).fill(String(w));
    await dialog().getByLabel("导入高度", { exact: true }).fill(String(h));
  }
  async function waitDraftCells(expected) {
    await page.waitForFunction(
      (expected) =>
        new Promise((resolve) => {
          const request = indexedDB.open("xing-local-v1", 1);
          request.onsuccess = () => {
            const db = request.result,
              query = db.transaction("meta").objectStore("meta").get("draft:"+window.location.origin+"/api:guest");
            query.onsuccess = () => {
              const raw = query.result;
              db.close();
              if (!raw || raw.width * raw.height !== expected.length) {
                resolve(false);
                return;
              }
              let cursor = 0;
              for (let i = 0; i < raw.patternRle.length; i += 2)
                for (let n = 0; n < raw.patternRle[i + 1]; n++)
                  if (raw.patternRle[i] !== expected[cursor++]) {
                    resolve(false);
                    return;
                  }
              resolve(cursor === expected.length);
            };
          };
        }),
      expected,
    );
  }
  async function confirm() {
    const expected = await ready();
    await dialog()
      .getByRole("button", { name: "确认生成", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    await waitDraftCells(expected.cells);
    await saved();
    return snapshot();
  }
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await saved();
  const original = await snapshot();
  await upload(portrait);
  await ready();
  await grid(96, 80);
  const beforeCrop = await ready();
  const handle = dialog().getByRole("button", {
    name: "裁剪把手nw",
    exact: true,
  });
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 64, hb.y + hb.height / 2 + 42, {
    steps: 9,
  });
  await page.mouse.up();
  const afterCrop = await ready();
  assert.ok(afterCrop.settings.crop.x > 0);
  assert.ok(afterCrop.settings.crop.y > 0);
  assert.notDeepEqual(afterCrop.cells, beforeCrop.cells);
  const edge = await dialog()
    .getByRole("button", { name: "裁剪把手e", exact: true })
    .boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    edge.x + edge.width / 2 - 35,
    edge.y + edge.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  const edgeCrop = await ready();
  assert.ok(edgeCrop.settings.crop.w < afterCrop.settings.crop.w);
  const cropRect = await dialog().locator(".source-crop-box").boundingBox();
  await page.mouse.move(
    cropRect.x + cropRect.width / 2,
    cropRect.y + cropRect.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    cropRect.x + cropRect.width / 2 + 10,
    cropRect.y + cropRect.height / 2 - 8,
    { steps: 4 },
  );
  await page.mouse.up();
  const moved = await ready();
  assert.ok(moved.settings.crop.x > edgeCrop.settings.crop.x);
  assert.equal(moved.settings.crop.w, edgeCrop.settings.crop.w);
  const advanced = dialog().locator(".import-advanced");
  await advanced.locator("summary").click();
  for (const [name, value] of [
    ["裁剪区域宽百分比", "55"],
    ["裁剪区域高百分比", "65"],
    ["裁剪左侧百分比", "18"],
    ["裁剪顶部百分比", "12"],
  ])
    await dialog().getByLabel(name, { exact: true }).fill(value);
  const precise = await ready();
  const cropBox = JSON.parse(
    await dialog().locator(".source-crop-box").getAttribute("data-crop"),
  );
  assert.deepEqual(cropBox, precise.settings.crop);
  await verifyPreviewPixels(precise);
  await dialog().getByLabel("自动合并少量杂色", { exact: true }).check();
  await dialog().getByLabel("边缘强化", { exact: true }).fill("25");
  const enhanced = await ready();
  assert.equal(enhanced.settings.merge, 1);
  assert.equal(enhanced.settings.edges, 25);
  await verifyPreviewPixels(enhanced);
  await dialog().getByLabel("自动适配最大颜色数", { exact: true }).check();
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector('[role="dialog"]')
          .querySelector('[aria-label="最大颜色数数值"]').value,
      ) < 221,
  );
  const auto = await ready();
  assert.ok(auto.settings.limit < 221);
  await dialog().getByLabel("最大颜色数数值", { exact: true }).fill("221");
  await dialog().getByLabel("自动合并少量杂色", { exact: true }).uncheck();
  await dialog().getByLabel("边缘强化", { exact: true }).fill("0");
  await ready();
  await dialog()
    .getByRole("button", { name: "锁定网格宽高比例", exact: true })
    .click();
  await dialog().getByLabel("导入宽度", { exact: true }).fill("120");
  assert.equal(
    await dialog().getByLabel("导入高度", { exact: true }).inputValue(),
    "100",
  );
  await dialog()
    .getByRole("button", { name: "锁定网格宽高比例", exact: true })
    .click();
  await grid(100, 88);
  await ready();
  await grid(99, 88);
  await grid(100, 88);
  await ready();
  await advanced.locator("summary").click();
  await dialog().getByRole("button", { name: "放大预览", exact: true }).click();
  await dialog()
    .getByRole("button", { name: "适应预览窗口", exact: true })
    .click();
  await dialog().getByLabel("网格线", { exact: true }).check();
  await dialog().getByLabel("网格线", { exact: true }).uncheck();
  await dialog()
    .locator(".import-body")
    .evaluate((node) => (node.scrollTop = 0));
  await page.screenshot({
    path: path.join(out, "desktop-crop.png"),
    fullPage: true,
  });
  assert.deepEqual(await snapshot(), original);
  mark(
    "近景图片八把手裁剪、精确数值、网格比例锁定、预览缩放及网格开关；临时调整不改草稿",
  );

  await page.evaluate(() => {
    window.__conversionDelay = 450;
  });
  await dialog().getByLabel("导入宽度", { exact: true }).fill("72");
  await page.waitForTimeout(260);
  for (const n of [73, 80, 88, 92, 96])
    await dialog().getByLabel("导入宽度", { exact: true }).fill(String(n));
  await dialog().getByLabel("最大颜色数数值", { exact: true }).fill("32");
  await dialog().getByRole("button", { name: "确认生成", exact: true }).click();
  assert.equal(
    await dialog()
      .getByRole("button", { name: "正在生成…", exact: true })
      .isVisible(),
    true,
  );
  assert.deepEqual(await snapshot(), original);
  await dialog().waitFor({ state: "hidden" });
  await saved();
  const latest = await page.evaluate(() =>
    window.__conversionLog.completed.at(-1),
  );
  await waitDraftCells(latest.cells);
  const current = await snapshot();
  assert.equal(latest.settings.width, 96);
  assert.equal(latest.settings.limit, 32);
  sameGrid(cellsOf(current), latest.cells);
  assert.notEqual(current.id, original.id);
  assert.equal(
    current.source.split(",")[1],
    fs.readFileSync(portrait).toString("base64"),
  );
  assert.equal(await page.evaluate(() => window.__conversionLog.maxActive), 1);
  await page.evaluate(() => {
    window.__conversionDelay = 0;
  });
  mark(
    "快速连续改参取消旧任务，确认等待最新结果；逐格一致、保留完整原图、新素材独立ID",
  );

  const stable = await snapshot();
  await menu("图片转马赛克");
  await grid(78, 68);
  await ready();
  const regen = await confirm();
  assert.equal(regen.id, current.id);
  assert.equal(regen.width, 78);
  assert.equal(regen.height, 68);
  await button("撤销").click();
  await waitDraftCells(cellsOf(stable));
  await saved();
  sameGrid(cellsOf(await snapshot()), cellsOf(stable));
  await button("重做").click();
  await waitDraftCells(cellsOf(regen));
  await saved();
  const regenerated = await snapshot();
  sameGrid(cellsOf(regenerated), cellsOf(regen));
  await upload(fullFigure);
  await ready();
  const replacementStart = await page.evaluate(
    () => window.__conversionLog.started,
  );
  await dialog().locator('input[type="file"]').setInputFiles(fullFigure);
  await page.waitForFunction(
    (n) => window.__conversionLog.started > n,
    replacementStart,
  );
  await ready();
  assert.deepEqual(await snapshot(), regenerated);
  await dialog().getByRole("button", { name: "关闭弹窗", exact: true }).click();
  assert.deepEqual(await snapshot(), regenerated);
  await page.evaluate(() => {
    window.__conversionFault = "hold";
  });
  await upload(fullFigure);
  await dialog().getByRole("button", { name: "确认生成", exact: true }).click();
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(await snapshot(), regenerated);
  await page.evaluate(() => {
    window.__conversionFault = "fail";
  });
  await upload(fullFigure);
  await dialog().getByRole("button", { name: "确认生成", exact: true }).click();
  await dialog()
    .getByRole("alert")
    .filter({ hasText: "定向测试：预览失败" })
    .waitFor();
  assert.deepEqual(await snapshot(), regenerated);
  await page.evaluate(() => {
    window.__conversionFault = null;
  });
  await dialog().getByRole("button", { name: "重试预览", exact: true }).click();
  await ready();
  assert.deepEqual(await snapshot(), regenerated);
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  mark("重新生成沿用ID且撤销重做可用；取消、关闭及注入失败均不改变原作品");

  await upload(fullFigure, true);
  await dialog()
    .getByRole("button", { name: "使用完整原图", exact: true })
    .click();
  await grid(104, 96);
  await ready();
  const full = await page.evaluate(() =>
    window.__conversionLog.completed.at(-1),
  );
  assert.ok(full.cells.includes(-1));
  await verifyPreviewPixels(full);
  await page.screenshot({
    path: path.join(out, "desktop-full.png"),
    fullPage: true,
  });
  const fullProject = await confirm();
  sameGrid(cellsOf(fullProject), full.cells);
  assert.notEqual(fullProject.id, regenerated.id);
  await button("用豆清单").click();
  const rows = await page
    .locator(".bead-list-table tbody tr")
    .evaluateAll((rows) =>
      rows.map((r) => ({
        code: r.dataset.code,
        count: Number(r.dataset.count),
      })),
    );
  // Also decode the actual CSV instead of relying on UI formatting.
  const downloadWait = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /下载 CSV/ })
    .click();
  const download = await downloadWait;
  await download.saveAs(path.join(out, "list.csv"));
  const csv = fs.readFileSync(path.join(out, "list.csv"), "utf8");
  const counts = new Map();
  for (const c of full.cells)
    if (c >= 0) counts.set(c, (counts.get(c) || 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.equal(
    rows.reduce((n, r) => n + r.count, 0),
    total,
  );
  assert.equal(rows.length, counts.size);
  for (const [i, count] of counts) {
    const code = fullProject.paletteCodes[i];
    assert.ok(
      csv
        .split(/\r?\n/)
        .some(
          (line) =>
            line.includes('"' + code + '"') && line.includes('"' + count + '"'),
        ),
      `${code}用量不一致`,
    );
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭弹窗", exact: true })
    .click();
  await page.reload();
  await saved();
  sameGrid(cellsOf(await snapshot()), full.cells);
  mark("完整立绘拖放、透明空格、逐格确认、清单CSV逐色用量及保存恢复一致");

  // Old files keep an unknown material choice instead of inferring a verified size.
  const legacy = structuredClone(fullProject);
  delete legacy.settings.materialSpec;
  await page.getByTestId("project-input").setInputFiles({
    name: "legacy.bead.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await page.locator(".settings-panel .material-pending").waitFor();
  await saved();
  await menu("图片转马赛克");
  await ready();
  assert.equal(
    await dialog().getByLabel("豆子尺寸", { exact: true }).inputValue(),
    "",
  );
  assert.ok(
    (await dialog().locator(".import-summary").innerText()).includes(
      "请先选择有效规格",
    ),
  );
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  mark("旧项目导入及重新裁剪保留未选择规格，不静默指定尺寸");

  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  await upload(fullFigure);
  await ready();
  const d = dialog(),
    footer = d.locator(".import-footer");
  await d.locator(".import-source-panel > summary").click();
  await d.locator(".source-crop-frame").scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      document.querySelector(".source-crop-box").getBoundingClientRect().width >
      80,
  );
  const mobileHandle = await d
    .getByRole("button", { name: "裁剪把手nw", exact: true })
    .boundingBox();
  const tx = mobileHandle.x + mobileHandle.width / 2,
    ty = mobileHandle.y + mobileHandle.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: tx, y: ty }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: tx + 24, y: ty + 24 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const touched = await ready();
  assert.ok(touched.settings.crop.x > 0 && touched.settings.crop.y > 0);
  assert.equal(await page.evaluate(() => devicePixelRatio), 2);
  await d.locator(".import-source-panel > summary").click();
  const dimensions = await d.evaluate((node) => ({
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
    body: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1);
  assert.equal(dimensions.body, 390);
  const fb = await footer.boundingBox();
  assert.ok(fb.y >= 0 && fb.y + fb.height <= 844);
  await page.screenshot({
    path: path.join(out, "mobile-crop.png"),
    fullPage: true,
  });
  await d.locator(".import-preview-pane").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(out, "mobile-preview.png"),
    fullPage: true,
  });
  await d.getByLabel("导入宽度", { exact: true }).fill("64");
  await ready();
  await d.locator(".import-summary").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(out, "mobile-settings.png"),
    fullPage: true,
  });
  await d.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__conversionLog.active), 0);
  assert.deepEqual(report.errors, []);
  mark(
    "390手机上下布局、可滚动设置、固定确认/取消按钮；关闭释放Worker，无页面错误",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.errors.push(error.stack || String(error));
  throw error;
} finally {
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
