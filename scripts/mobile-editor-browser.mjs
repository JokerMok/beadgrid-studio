import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const base = process.env.TEST_URL || "http://127.0.0.1:4182",
  out = path.resolve("verification/product-parity-20261020");
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ headless: true }),
  c = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }),
  p = await c.newPage(),
  report = { date: new Date().toISOString(), checks: [], errors: [] };
p.on("pageerror", (e) => report.errors.push(e.message));
const saved = async () => {
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await p.waitForTimeout(720);
};
const snapshot = () =>
  p.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("xing-local-v1", 1);
        r.onsuccess = () => {
          const db = r.result,
            q = db
              .transaction("meta")
              .objectStore("meta")
              .get("draft:" + location.origin + "/api:guest");
          q.onsuccess = () => {
            resolve(q.result);
            db.close();
          };
        };
      }),
  );
const cells = (raw) =>
  raw.patternRle.flatMap((v, i, a) => (i % 2 ? [] : Array(a[i + 1]).fill(v)));
try {
  await p.goto(base + "/?v=1.6.0");
  await saved();
  const initial = await snapshot();
  await p
    .getByTestId("image-input")
    .setInputFiles(path.resolve("tests/fixtures/portrait-contain.png"));
  const d = p.getByRole("dialog", { name: "上传图片并设置板子" });
  await d.getByRole("button", { name: "长边100格", exact: true }).tap();
  await p.waitForFunction(
    () =>
      document.querySelector(".import-preview-viewport")?.dataset.state ===
      "ready",
  );
  await d.getByRole("button", { name: "确认生成", exact: true }).tap();
  await d.waitFor({ state: "hidden" });
  await saved();
  const generated = await snapshot();
  assert.notEqual(generated.id, initial.id);
  assert.ok(generated.generationBase);
  report.checks.push(
    "390px/DPR2触摸上传、调整网格、确认生成，独立新ID和基准保存",
  );
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
  await p.getByRole("button", { name: "画笔", exact: true }).tap();
  await p.touchscreen.tap(x, y);
  await saved();
  const drawn = await snapshot();
  assert.notDeepEqual(cells(drawn), cells(generated));
  await p.getByRole("button", { name: "橡皮", exact: true }).tap();
  await p.touchscreen.tap(x, y);
  await saved();
  assert.equal(cells(await snapshot())[0], -1);
  await p.getByRole("button", { name: "撤销", exact: true }).tap();
  await saved();
  assert.deepEqual(cells(await snapshot()), cells(drawn));
  await p.getByRole("button", { name: "重做", exact: true }).tap();
  await saved();
  const edited = await snapshot();
  assert.equal(cells(edited)[0], -1);
  report.checks.push("真实触摸落笔/橡皮坐标正确，撤销重做保持网格与用量");
  await p.screenshot({
    path: path.join(out, "mobile-editor.png"),
    fullPage: true,
  });
  await p.reload();
  await saved();
  assert.equal((await snapshot()).id, generated.id);
  assert.deepEqual(cells(await snapshot()), cells(edited));
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  assert.deepEqual(report.errors, []);
  report.checks.push("编辑后刷新恢复与无横向溢出");
  report.status = "passed";
  console.log("PASS", report.checks);
} catch (e) {
  report.status = "failed";
  report.error = e.stack;
  throw e;
} finally {
  fs.writeFileSync(
    path.join(out, "mobile-editor-results.json"),
    JSON.stringify(report, null, 2),
  );
  await b.close();
}
