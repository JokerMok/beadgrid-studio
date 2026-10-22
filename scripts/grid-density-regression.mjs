import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TEST_URL || "http://127.0.0.1:4181";
const out = path.join(root, "verification/grid-density");
fs.mkdirSync(out, { recursive: true });
const manifest = JSON.parse(
  fs.readFileSync(path.join(out, "sources/manifest.json"), "utf8"),
);
const raiden = {
  slug: "raiden",
  name: "雷电将军",
  path: "src/assets/raiden-shogun.png",
  page: "https://wiki.hoyolab.com/pc/genshin/entry/49",
  asset:
    "https://bbs.hoyolab.com/hoyowiki/picture/character/雷电将军/avatar.png",
  sha256: "47e66a1dcef2539a472d9f69c4cdd35a9cda303155eca28f769a6769144c8601",
};
const allCases = [
  raiden,
  ...manifest.filter((x) => !x.slug.includes("gallery")),
  {
    ...raiden,
    slug: "raiden-close",
    name: "雷电将军 · 固定近景",
    crop: { x: 0.34, y: 0.14, w: 0.34, h: 0.42 },
  },
  manifest.find((x) => x.slug === "nahida-gallery"),
];
const cases = process.env.SAMPLE_FILTER
  ? allCases.filter((item) => item.slug === process.env.SAMPLE_FILTER)
  : allCases;
const report = process.env.SAMPLE_FILTER
  ? JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"))
  : {
      date: new Date().toISOString(),
      parameters: {
        limit: 64,
        merge: 0,
        similar: false,
        edges: 0,
        smallCleanup: false,
        removeLight: false,
        alpha: "keep",
        placement: "contain",
        padding: "empty",
      },
      samples: [],
      checks: [],
      pageErrors: [],
    };
const browser = await chromium.launch({ headless: true });
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    bypassCSP: true,
  });
  await context.addInitScript(() => {
    const W = window.Worker;
    window.__density = { active: 0, max: 0, completed: [] };
    window.Worker = class extends W {
      constructor(url, options) {
        super(url, options);
        this.conversion = String(url).includes("convert.worker");
        if (this.conversion) {
          window.__density.active++;
          window.__density.max = Math.max(
            window.__density.max,
            window.__density.active,
          );
          this.addEventListener("message", ({ data }) => {
            if (data.cells) {
              window.__density.completed.push({
                settings: this.settings,
                cells: Array.from(data.cells),
                workerMs: performance.now() - this.start,
              });
              if (window.__density.completed.length > 6)
                window.__density.completed.shift();
            }
          });
        }
      }
      postMessage(message, ...args) {
        if (this.conversion) {
          this.settings = structuredClone(message.settings);
          this.start = performance.now();
          if (window.__holdConversion) return;
          if (window.__failConversion) {
            setTimeout(
              () =>
                this.dispatchEvent(
                  new MessageEvent("message", {
                    data: { error: "定向测试：转换失败" },
                  }),
                ),
              20,
            );
            return;
          }
          if (window.__delayConversion) {
            this.timer = setTimeout(
              () => super.postMessage(message, ...args),
              window.__delayConversion,
            );
            return;
          }
        }
        return super.postMessage(message, ...args);
      }
      terminate() {
        clearTimeout(this.timer);
        if (this.conversion && !this.ended) {
          this.ended = true;
          window.__density.active--;
        }
        super.terminate();
      }
    };
  });
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => report.pageErrors.push(e.message));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByText("已自动保存", { exact: true }).waitFor();
  const d = () => page.getByRole("dialog", { name: "上传图片并设置板子" });
  async function ready() {
    const h = await page.waitForFunction(() => {
      const v = document.querySelector(
          '.import-preview-viewport[data-state="ready"]',
        ),
        c = v?.querySelector("canvas");
      if (!c) return false;
      const s = JSON.parse(c.dataset.settings),
        dialog = c.closest("[role=dialog]");
      if (
        s.width !==
          Number(dialog.querySelector('[aria-label="导入宽度"]').value) ||
        s.height !==
          Number(dialog.querySelector('[aria-label="导入高度"]').value) ||
        s.limit !==
          Number(dialog.querySelector('[aria-label="最大颜色数数值"]').value)
      )
        return false;
      return (
        window.__density.completed.findLast(
          (x) => JSON.stringify(x.settings) === c.dataset.settings,
        ) || false
      );
    });
    return h.jsonValue();
  }
  async function input(label, value) {
    await d().getByLabel(label, { exact: true }).fill(String(value));
  }
  async function advanced(open = true) {
    const detail = d().locator(".import-advanced");
    if (((await detail.getAttribute("open")) !== null) !== open)
      await detail.locator("summary").click();
  }
  async function snapshot() {
    return page.evaluate(
      () =>
        new Promise((resolve) => {
          let r = indexedDB.open("xing-local-v1", 1);
          r.onsuccess = () => {
            let db = r.result,
              q = db.transaction("meta").objectStore("meta").get("draft:"+window.location.origin+"/api:guest");
            q.onsuccess = () => {
              resolve(q.result);
              db.close();
            };
          };
        }),
    );
  }
  const initial = await snapshot();
  for (const item of cases) {
    await page
      .getByTestId("image-input")
      .setInputFiles(path.resolve(root, item.path));
    await d().waitFor();
    await ready();
    await advanced();
    await d().getByLabel("仅移除白色／浅色边缘", { exact: true }).uncheck();
    if (item.crop) {
      for (const [k, label] of [
        ["w", "区域宽"],
        ["h", "区域高"],
        ["x", "左侧"],
        ["y", "顶部"],
      ])
        await input("裁剪" + label + "百分比", item.crop[k] * 100);
    } else
      await d()
        .getByRole("button", { name: "使用完整原图", exact: true })
        .click();
    await advanced(false);
    await input("最大颜色数数值", 64);
    await ready();
    const sample = { ...item, results: [] };
    for (const edge of [100, 200, 300]) {
      const start = Date.now();
      await d()
        .getByRole("button", { name: `长边${edge}格`, exact: true })
        .click();
      const result = await ready();
      const elapsed = Date.now() - start;
      assert.equal(
        Math.max(result.settings.width, result.settings.height),
        edge,
      );
      assert.equal(result.settings.limit, 64);
      assert.equal(result.settings.merge, 0);
      assert.equal(result.settings.edges, 0);
      assert.equal(result.settings.removeLight, false);
      assert.deepEqual(
        result.settings.crop,
        item.crop || { x: 0, y: 0, w: 1, h: 1 },
      );
      const counts = new Map();
      for (const c of result.cells) {
        assert.ok(c >= -1 && c < 221);
        if (c >= 0) counts.set(c, (counts.get(c) || 0) + 1);
      }
      const total = [...counts.values()].reduce((n, c) => n + c, 0),
        empty = result.cells.length - total;
      const pixels = await d()
        .getByLabel("实际拼豆预览", { exact: true })
        .evaluate((c) => c.toDataURL("image/png"));
      const file = `${item.slug}-${edge}.png`;
      fs.writeFileSync(
        path.join(out, file),
        Buffer.from(pixels.split(",")[1], "base64"),
      );
      const row = {
        edge,
        width: result.settings.width,
        height: result.settings.height,
        colors: counts.size,
        total,
        empty,
        cm: [result.settings.width * 0.26, result.settings.height * 0.26],
        elapsedMs: elapsed,
        workerMs: Math.round(result.workerMs),
        settings: result.settings,
        image: file,
      };
      fs.writeFileSync(
        path.join(out, `${item.slug}-${edge}.grid.json`),
        JSON.stringify({ settings: result.settings, cells: result.cells }),
      );
      sample.results.push(row);
      if (item.slug === "raiden" && edge === 200) {
        await d()
          .locator(".import-body")
          .evaluate((n) => (n.scrollTop = 0));
        await page.screenshot({
          path: path.join(out, "desktop.png"),
          fullPage: true,
        });
      }
    }
    report.samples = report.samples.filter(
      (previous) => previous.slug !== sample.slug,
    );
    report.samples.push(sample);
    await d().getByRole("button", { name: "取消", exact: true }).click();
    assert.deepEqual(await snapshot(), initial);
    console.log("PASS", item.name, "100/200/300同参数真实转换");
  }
  report.checks.push(
    `${report.samples.length}组原图（7角色、固定近景及纹样背景）100/200/300同裁剪同参数转换，取消保留原作品`,
  );
  // The production pipeline is also exported for a deterministic demo rebuild and raster diagnostics.
  await page.addScriptTag({
    content: fs.readFileSync(path.join(out, "pipeline.js"), "utf8"),
  });
  const source =
    "data:image/png;base64," +
    fs.readFileSync(path.join(root, raiden.path)).toString("base64");
  const demoSettings = report.samples
    .find((item) => item.slug === "raiden")
    .results.find((x) => x.edge === 200).settings;
  const diagnostics = await page.evaluate(
    async ({ source, s }) => {
      const a = await densityPipeline.prepareRaster(source, {
          ...s,
          fit: "contain",
        }),
        b = await densityPipeline.prepareRaster(source, { ...s, fit: "crop" });
      let differences = 0;
      for (let i = 0; i < a.pixels.length; i++)
        if (a.pixels[i] !== b.pixels[i]) differences++;
      const p = densityPipeline.blank(s.width, s.height);
      p.name = "雷电将军 · 原神角色立绘";
      p.settings = s;
      p.sourceName = "雷电将军 · 原神角色立绘.png";
      p.cells = (
        await densityPipeline.convertImage(source, s, {
          signal: new AbortController().signal,
        })
      ).cells;
      const demo = densityPipeline.serialize(p);
      demo.id = "demo-raiden-shogun";
      demo.updatedAt = 0;
      delete demo.source;
      return { fullCropDifferences: differences, bytes: a.pixels.length, demo };
    },
    { source, s: demoSettings },
  );
  assert.equal(diagnostics.fullCropDifferences, 0);
  fs.writeFileSync(
    path.join(out, "demo-candidate.json"),
    JSON.stringify(diagnostics.demo) + "\n",
  );
  delete diagnostics.demo;
  report.diagnostics = diagnostics;
  assert.deepEqual(report.pageErrors, []);
  delete report.error;
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.stack;
  throw e;
} finally {
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
