import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
const out = path.resolve("verification"),
  base = process.env.TEST_URL || "http://127.0.0.1:4173",
  results = { date: new Date().toISOString(), base, checks: [], errors: [] };
const b = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});
const p = await b.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
p.setDefaultTimeout(20000);
p.on("pageerror", (e) => results.errors.push(e.message));
const pass = (name, detail) => {
  console.log("PASS", name);
  results.checks.push({ name, status: "passed", detail });
};
const snapshot = async () => {
  const promise = p.waitForEvent("download");
  await p.getByRole("button", { name: "导出项目", exact: true }).click();
  const d = await promise;
  return JSON.parse(fs.readFileSync(await d.path(), "utf8"));
};
const values = (v) => {
  const a = [];
  for (let i = 0; i < v.patternRle.length; i += 2)
    for (let j = 0; j < v.patternRle[i + 1]; j++) a.push(v.patternRle[i]);
  return a;
};
const total = (v) => values(v).filter((x) => x >= 0).length;
const blank = async (w = 16, h = 16) => {
  await p.getByRole("button", { name: "自定义创作", exact: true }).click();
  await p.getByLabel("新建宽度").fill(String(w));
  await p.getByLabel("新建高度").fill(String(h));
  await p.getByRole("button", { name: "创建空白板" }).click();
  await p.getByTestId("usage-total").filter({ hasText: /^0 / }).waitFor();
};
const canvas = p.getByTestId("editor-canvas");
async function center() {
  const r = await canvas.boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
const clickCenter = async () => {
  const c = await center();
  await p.mouse.click(c.x, c.y);
};
try {
  await p.goto(base);
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await blank();
  for (const n of [1, 2, 3, 5]) {
    await p.getByRole("button", { name: "清除画面", exact: true }).click();
    await p.getByRole("button", { name: "画笔", exact: true }).click();
    await p.getByRole("button", { name: `${n}格画笔`, exact: true }).click();
    await clickCenter();
    const v = await snapshot();
    assert.equal(total(v), n * n);
  }
  pass("1/2/3/5格画笔实际绘制数量正确");
  await p.getByRole("button", { name: "清除画面", exact: true }).click();
  await p.getByRole("button", { name: "1格画笔", exact: true }).click();
  let c = await center();
  await p.mouse.move(c.x - 120, c.y);
  await p.mouse.down();
  await p.mouse.move(c.x + 120, c.y, { steps: 12 });
  await p.mouse.up();
  let v = await snapshot();
  assert(total(v) > 4);
  pass("连续笔画连接多格，无断点");
  await p.getByRole("button", { name: "吸管", exact: true }).click();
  await clickCenter();
  assert(
    (await p
      .getByRole("button", { name: "画笔", exact: true })
      .getAttribute("aria-pressed")) === "true",
  );
  await p.getByRole("button", { name: "橡皮", exact: true }).click();
  const prev = total(v);
  await clickCenter();
  assert.equal(total(await snapshot()), prev - 1);
  pass("吸管切回画笔，橡皮清除并更新用量");
  await p.getByRole("button", { name: "填充", exact: true }).click();
  await p.mouse.click(c.x, c.y + 80);
  assert.equal(total(await snapshot()), 256);
  await p.getByRole("button", { name: "魔法选取", exact: true }).click();
  await clickCenter();
  await p.getByRole("button", { name: "清除选区", exact: true }).click();
  assert.equal(total(await snapshot()), 0);
  pass("连通填充、魔法选取和选区清除");
  await p.getByRole("button", { name: "套索", exact: true }).click();
  c = await center();
  await p.mouse.move(c.x - 70, c.y - 70);
  await p.mouse.down();
  for (const [x, y] of [
    [70, -70],
    [70, 70],
    [-70, 70],
    [-70, -70],
  ])
    await p.mouse.move(c.x + x, c.y + y, { steps: 5 });
  await p.mouse.up();
  await p.getByRole("button", { name: /填入 A1/ }).click();
  v = await snapshot();
  assert(total(v) > 0 && total(v) < 256);
  pass("套索选区与选区填色");
  await p.getByRole("button", { name: "禁用色号", exact: true }).click();
  await p.getByRole("button", { name: "色卡A1", exact: true }).click();
  await p
    .getByRole("button", { name: "应用到当前图纸", exact: true })
    .last()
    .click();
  v = await snapshot();
  assert(!values(v).includes(0));
  assert(total(v) > 0);
  pass("禁用色号应用后重映射，不把有效格误清空");
  await p.getByRole("button", { name: "自选颜色", exact: true }).click();
  await p.getByLabel("纳入自选A3", { exact: true }).check();
  await p.getByLabel("纳入自选A4", { exact: true }).check();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "应用到当前图纸", exact: true })
    .click();
  v = await snapshot();
  assert(values(v).every((n) => n === -1 || n === 2 || n === 3));
  pass("自选色卡限制与重新匹配");
  await p
    .getByTestId("reference-input")
    .setInputFiles(path.resolve("tests/fixtures/synthetic-illustration.png"));
  await p.getByRole("dialog", { name: "描摹参考底图" }).waitFor();
  await p.getByRole("dialog").locator("input[type=range]").fill("0.5");
  await p.getByRole("button", { name: "完成", exact: true }).click();
  v = await snapshot();
  assert.equal(v.reference.opacity, 0.5);
  assert(v.reference.url.startsWith("data:image/"));
  pass("添加描摹底图、透明度与项目保存");
  await blank(24, 20);
  await clickCenter();
  await p.getByRole("button", { name: "旋转90°", exact: true }).click();
  v = await snapshot();
  assert.equal(v.width, 20);
  assert.equal(v.height, 24);
  assert.equal(total(v), 1);
  await p.getByRole("button", { name: "左右翻转", exact: true }).click();
  await p.getByRole("button", { name: "上下翻转", exact: true }).click();
  assert.equal(total(await snapshot()), 1);
  await p.getByRole("button", { name: "手动裁剪", exact: true }).click();
  await p.getByLabel("裁剪w").fill("16");
  await p.getByLabel("裁剪h").fill("16");
  await p.getByRole("button", { name: "确认裁剪", exact: true }).click();
  v = await snapshot();
  assert.equal(v.width, 16);
  assert.equal(v.height, 16);
  pass("旋转、双向翻转和按格裁剪");
  await p.getByRole("button", { name: "网格对齐", exact: true }).click();
  await p.getByRole("dialog").locator("input[type=range]").first().fill("0.5");
  await p.getByRole("button", { name: "应用并重新生成", exact: true }).click();
  await p.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
  v = await snapshot();
  assert.equal(v.settings.mode, "recognize");
  assert.equal(v.settings.alignX, 0.5);
  pass("网格偏移与中心采样识别路径");
  await p.getByRole("button", { name: "简化图", exact: true }).click();
  await p.getByRole("button", { name: "生成拼豆图" }).click();
  await p.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
  v = await snapshot();
  assert.equal(v.settings.mode, "simple");
  assert(new Set(values(v).filter((n) => n >= 0)).size <= 16);
  pass("独立简化图路径可运行");
  await blank(1000, 1000);
  await p.getByRole("button", { name: "下载图纸", exact: true }).click();
  await p.getByLabel("每格像素").selectOption("56");
  await p.getByRole("button", { name: "开始导出", exact: true }).click();
  await p.getByRole("button", { name: "取消处理", exact: true }).click();
  assert.equal(total(await snapshot()), 0);
  pass("1000×1000大尺寸导出可取消，网格保留");
  const large = {
    ...v,
    id: crypto.randomUUID(),
    name: "自动分板回归",
    width: 300,
    height: 16,
    patternRle: [0, 4800],
    settings: { ...v.settings, width: 300, height: 16 },
    source: undefined,
  };
  await p
    .getByTestId("project-input")
    .setInputFiles({
      name: "large.bead.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(large)),
    });
  await p
    .getByTestId("usage-total")
    .filter({ hasText: /^4,800 / })
    .waitFor();
  await p.getByRole("button", { name: "下载图纸", exact: true }).click();
  await p.getByLabel("每格像素").selectOption("56");
  await p.getByRole("button", { name: "开始导出", exact: true }).click();
  await p
    .getByRole("button", { name: "下载文件", exact: true })
    .waitFor({ timeout: 60000 });
  const promise = p.waitForEvent("download");
  await p.getByRole("button", { name: "下载文件", exact: true }).click();
  const d = await promise;
  await d.saveAs(path.join(out, "downloads/large-auto-partition.zip"));
  const zip = unzipSync(fs.readFileSync(await d.path())),
    manifest = JSON.parse(strFromU8(zip["分板说明.json"]));
  assert.equal(manifest.total, 4800);
  assert.equal(manifest.tiles.length, 3);
  pass("超宽高清图自动分104格板，4800颗与3张分区守恒");
  assert.equal(results.errors.length, 0);
  results.status = "passed";
} catch (e) {
  results.status = "failed";
  results.error = String(e.stack || e);
  console.error(e);
  await p
    .screenshot({ path: path.join(out, "advanced-failure.png") })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(out, "advanced-results.json"),
    JSON.stringify(results, null, 2),
  );
  await b.close();
}
