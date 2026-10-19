import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { unzipSync } from "fflate";
const base = process.env.TEST_URL || "http://127.0.0.1:4173",
  dir = path.resolve("verification/v1.1-regression");
fs.mkdirSync(dir + "/downloads", { recursive: true });
const report = {
  date: new Date().toISOString(),
  base,
  checks: [],
  errors: [],
  externalRequests: [],
  downloads: [],
};
const pass = (name, detail) => {
  report.checks.push({ name, detail, status: "passed" });
  console.log("PASS", name);
};
const b = await chromium.launch({ headless: true }),
  context = await b.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }),
  p = await context.newPage();
p.setDefaultTimeout(20000);
context.on("request", (r) => {
  if (
    /^https?:/.test(r.url()) &&
    new URL(r.url()).origin !== new URL(base).origin
  )
    report.externalRequests.push(r.url());
});
p.on("pageerror", (e) => report.errors.push(e.message));
const button = (name) => p.getByRole("button", { name, exact: true }),
  waitSave = () => p.getByText("已自动保存", { exact: true }).waitFor(),
  snapshot = async (name) =>
    p.screenshot({ path: dir + "/" + name, animations: "disabled" });
const cells = (v) =>
  v.patternRle.flatMap((n, i) =>
    i % 2 ? [] : Array(v.patternRle[i + 1]).fill(n),
  );
const saveDownload = async (d) => {
  const file = dir + "/downloads/" + d.suggestedFilename();
  await d.saveAs(file);
  return file;
};
async function read() {
  const event = p.waitForEvent("download");
  await p
    .locator(".top-toolbar")
    .getByRole("button", { name: "导出项目", exact: true })
    .click();
  const f = await saveDownload(await event);
  return JSON.parse(fs.readFileSync(f, "utf8"));
}
async function upload(name, w = 32, h = 32) {
  await p
    .getByTestId("image-input")
    .setInputFiles("tests/fixtures/" + name + ".png");
  const d = p.getByRole("dialog", { name: "上传图片并设置板子" });
  await d.waitFor();
  await d.getByLabel("导入宽度").fill(String(w));
  await d.getByLabel("导入高度").fill(String(h));
  await d.getByLabel("导入最大颜色数").fill("8");
  await d.getByRole("button", { name: "确认裁剪并生成拼豆图" }).click();
  await p.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
  await waitSave();
  return read();
}
async function closeToast() {
  if (await button("关闭提示").count()) await button("关闭提示").click();
}
function png(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let at = 8,
    w,
    h,
    metadata;
  const idat = [];
  while (at < bytes.length) {
    const n = bytes.readUInt32BE(at),
      type = bytes.toString("ascii", at + 4, at + 8),
      body = bytes.subarray(at + 8, at + 8 + n);
    if (type === "IHDR") {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
    }
    if (type === "IDAT") idat.push(body);
    if (type === "tEXt" && body.toString().startsWith("bead-project\0"))
      metadata = JSON.parse(body.subarray(13).toString());
    at += n + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, h * (w * 4 + 1));
  return { width: w, height: h, metadata, raw };
}
async function exported(
  kind,
  { mirror = false, parts = false, board = 52 } = {},
) {
  await button("下载图纸").click();
  let d = p.getByRole("dialog");
  await d.getByLabel("导出内容", { exact: true }).selectOption(kind);
  if (kind === "assembly" || kind === "sections") {
    await d.getByLabel("常规板尺寸").selectOption(String(board));
    if (parts)
      await d
        .getByRole("button", { name: "多块部分导出", exact: true })
        .click();
  }
  await d.getByLabel("镜像导出", { exact: true }).setChecked(mirror);
  await d.getByRole("button", { name: "确认并生成图纸" }).click();
  await p
    .getByRole("dialog", { name: "导出完成" })
    .waitFor({ timeout: 120000 });
  const dl = p.waitForEvent("download");
  await button("下载文件").click();
  const file = await saveDownload(await dl),
    bytes = fs.readFileSync(file);
  report.downloads.push({
    kind,
    mirror,
    parts,
    board,
    file,
    bytes: bytes.length,
  });
  return { file, bytes };
}
try {
  await p.goto(base);
  await waitSave();
  await p
    .getByTestId("image-input")
    .setInputFiles("tests/fixtures/synthetic-illustration.png");
  let d = p.getByRole("dialog", { name: "上传图片并设置板子" });
  await d.waitFor();
  assert.equal(await d.getByLabel("导入宽度").inputValue(), "104");
  assert.equal(await d.getByLabel("导入高度").inputValue(), "104");
  assert.equal(await d.getByLabel("导入最大颜色数").inputValue(), "221");
  await snapshot("upload-default.png");
  const handle = await d.getByLabel("裁剪把手se").boundingBox();
  await p.mouse.move(handle.x + 4, handle.y + 4);
  await p.mouse.down();
  await p.mouse.move(handle.x - 65, handle.y - 45, { steps: 10 });
  await p.mouse.up();
  await d.getByLabel("导入宽度").fill("24");
  await d.getByLabel("导入高度").fill("16");
  await d.getByRole("button", { name: "确认裁剪并生成拼豆图" }).click();
  await p.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
  const cropped = await read();
  assert(cropped.settings.crop.w < 1 && cropped.settings.crop.h < 1);
  pass("上传裁剪八把手、独立宽高及生成", { crop: cropped.settings.crop });
  let project = await upload("synthetic-illustration");
  const generated = cells(project);
  assert.equal(generated.filter((c) => c >= 0).length, 404);
  const expected = {
    C16: 112,
    C18: 86,
    C22: 30,
    F9: 10,
    F16: 121,
    G3: 8,
    G4: 25,
    H5: 12,
  };
  const palette = JSON.parse(fs.readFileSync("src/palette.json", "utf8")),
    counts = {};
  for (const c of generated)
    if (c >= 0) counts[palette[c].code] = (counts[palette[c].code] || 0) + 1;
  assert.deepEqual(counts, expected);
  await button("手型").click();
  await closeToast();
  await p.locator(".top-toolbar").evaluate((e) => (e.scrollLeft = 0));
  await snapshot("desktop-aligned.png");
  fs.copyFileSync(
    dir + "/desktop-aligned.png",
    "verification/v1.1-comparison/local-uploaded-32-8.png",
  );
  await button("自选颜色").click();
  await snapshot("color-picker.png");
  await p.getByRole("button", { name: "色卡H7", exact: true }).click();
  pass("同图片32×32、8色，色号集合与用量对应原站上传结果", {
    total: 404,
    counts,
  });
  await button("画笔").click();
  const canvas = p.getByTestId("editor-canvas"),
    r = await canvas.boundingBox();
  await p.mouse.click(r.x + 700, r.y + 100);
  const drawn = await read();
  assert.equal(cells(drawn).filter((c) => c >= 0).length, 405);
  await button("撤销").click();
  assert.deepEqual(cells(await read()), generated);
  await button("重做").click();
  assert.deepEqual(cells(await read()), cells(drawn));
  pass("画笔、撤销重做与实时用量", { before: 404, after: 405 });
  await button("框选").click();
  await p.mouse.move(r.x + 698, r.y + 99);
  await p.mouse.down();
  await p.mouse.move(r.x + 742, r.y + 144, { steps: 8 });
  await p.mouse.up();
  await p.getByText(/已选 \d+ 格/).waitFor();
  await p.getByRole("button", { name: /填入 H7/ }).click();
  const selected = await read();
  assert(cells(selected).filter((c) => c >= 0).length > 405);
  await button("撤销").click();
  assert.deepEqual(cells(await read()), cells(drawn));
  await p.getByRole("button", { name: "取消", exact: true }).click();
  pass("矩形选区填色及撤销");
  await button("编辑缩放比例").click();
  await p.getByLabel("缩放百分比").fill("125");
  await p.getByLabel("缩放百分比").press("Enter");
  assert((await button("编辑缩放比例").innerText()).includes("125%"));
  await button("编辑缩放比例").click();
  await p.getByLabel("缩放百分比").fill("100");
  await p.getByLabel("缩放百分比").press("Enter");
  await p.locator(".grid-color-settings summary").click();
  await p.getByLabel("5格网格颜色", { exact: true }).fill("#bb33dd");
  await p.getByRole("button", { name: "恢复推荐" }).click();
  await p.locator(".grid-color-settings summary").click();
  await button("显示色号").click();
  assert.equal((await read()).grid.codes, true);
  await button("显示色号").click();
  pass("缩放比例编辑、三档网格颜色与色号开关");
  const edge = p.getByLabel("当前图纸边缘强化强度");
  await edge.scrollIntoViewIfNeeded();
  await edge.dispatchEvent("pointerdown");
  await edge.fill("82");
  await edge.fill("0");
  assert.deepEqual(cells(await read()), cells(drawn));
  pass("边缘强化从基线预览，归零恢复原网格");
  await button("识别 / 手绘边缘 · 统一色号").click();
  d = p.getByRole("dialog");
  await d.getByRole("button", { name: "自动识别外围描线" }).click();
  await d.getByText(/已选 \d+ 格 →/).waitFor();
  await d.getByRole("button", { name: "应用统一边缘色号" }).click();
  await button("撤销").click();
  assert.deepEqual(cells(await read()), cells(drawn));
  pass("轮廓自动识别、应用与主工作台撤销");
  await button("保存").click();
  await waitSave();
  const saved = await read();
  await p.reload();
  await waitSave();
  assert.deepEqual(cells(await read()), cells(saved));
  await button("保存至我的作品").click();
  d = p.getByRole("dialog");
  await d
    .locator(".work-card")
    .filter({ hasText: saved.name })
    .locator(".work-open")
    .first()
    .click();
  await d.waitFor({ state: "hidden" });
  assert.deepEqual(cells(await read()), cells(saved));
  pass("命名保存、刷新恢复与本地作品重开", {
    cells: cells(saved).length,
    total: cells(saved).filter((c) => c >= 0).length,
  });
  const output = await exported("chart"),
    chart = png(output.bytes);
  assert.equal(chart.metadata.total, 405);
  assert.equal(
    chart.metadata.usage.reduce((s, c) => s + c.count, 0),
    405,
  );
  assert(chart.width > 3200 && chart.height >= 4096);
  await p
    .getByTestId("image-input")
    .setInputFiles("tests/fixtures/synthetic-illustration.png");
  await p.getByRole("dialog").getByRole("button", { name: "返回画板" }).click();
  pass("实际下载完整PNG、尺寸与用量一致", {
    width: chart.width,
    height: chart.height,
    total: chart.metadata.total,
    file: output.file,
  });
  const normal = png((await exported("mosaic")).bytes),
    mirror = png((await exported("mosaic", { mirror: true })).bytes);
  assert.equal(normal.width, 4096);
  for (const y of [0, 20, 210, 500, 2000, 4095])
    for (const x of [0, 40, 500, 2100, 4095]) {
      const i = y * (normal.width * 4 + 1) + 1 + x * 4,
        j = y * (mirror.width * 4 + 1) + 1 + (mirror.width - 1 - x) * 4;
      assert(
        normal.raw.subarray(i, i + 4).equals(mirror.raw.subarray(j, j + 4)),
      );
    }
  const colors = unzipSync((await exported("palette")).bytes);
  assert(Object.keys(colors).some((n) => n.endsWith(".csv")));
  const card = png(
    Buffer.from(
      Object.values(colors).find((_, i) =>
        Object.keys(colors)[i].endsWith(".png"),
      ),
    ),
  );
  pass("镜像马赛克与独立色卡实际下载", {
    mosaic: [normal.width, normal.height],
    palette: [card.width, card.height],
  });
  const full = png((await exported("assembly", { board: 52 })).bytes);
  assert.equal(full.metadata.total, 405);
  const parts = unzipSync((await exported("sections", { board: 52 })).bytes);
  const partPngs = Object.entries(parts)
    .filter(([n]) => n.endsWith(".png"))
    .map(([n, bytes]) => ({
      name: n,
      metadata: png(Buffer.from(bytes)).metadata,
    }));
  assert.equal(
    partPngs.reduce((n, p) => n + p.metadata.total, 0),
    405,
  );
  pass("常规板完整规划、明确分区与留白数量", { total: 405, parts: partPngs });
  // Exercise recognition using the real upload entry and the same retained source.
  await button("识别图片色号").click();
  d = p.getByRole("dialog");
  await d.getByRole("button", { name: "自动检测原图网格" }).click();
  await d.getByText("已检测像素网格：128 × 128 格").waitFor();
  await d.getByLabel("导入宽度").fill("128");
  await d.getByLabel("导入高度").fill("128");
  await d.getByRole("button", { name: "确认裁剪并生成拼豆图" }).click();
  await p.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
  const recognized = await read();
  assert.equal(recognized.settings.mode, "recognize");
  assert.equal(recognized.width, 128);
  pass("公开规则的原生像素网格检测与色块识别");
  for (const [width, height, name] of [
    [820, 1000, "tablet"],
    [390, 844, "phone"],
  ]) {
    await p.setViewportSize({ width, height });
    await upload("transparent-edge", 24, 24);
    await p.getByRole("button", { name: "设置与用量", exact: true }).click();
    await p.getByLabel("板子宽度").fill("26");
    await p.getByRole("button", { name: "应用到当前图纸" }).click();
    await p.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
    await p.getByRole("button", { name: "关闭设置" }).click();
    await closeToast();
    await snapshot(name + ".png");
    const pageWidth = await p.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert(pageWidth <= width + 1);
    pass(name + " 窄窗口上传、设置、生成与操作区", {
      viewport: [width, height],
      pageWidth,
    });
  }
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  assert.equal(report.externalRequests.length, 0);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.stack;
  console.error(e);
  await snapshot("failure.png").catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(dir + "/results.json", JSON.stringify(report, null, 2));
  await b.close();
}
