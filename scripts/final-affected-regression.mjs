import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
const dir = "verification/v1.1-regression",
  base = process.env.TEST_URL || "http://127.0.0.1:4173",
  b = await chromium.launch({ headless: true }),
  p = await b.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }),
  r = { base, checks: [], errors: [], externalRequests: [] };
p.setDefaultTimeout(20000);
p.on("pageerror", (e) => r.errors.push(e.message));
p.on("request", (q) => {
  if (
    /^https?:/.test(q.url()) &&
    new URL(q.url()).origin !== new URL(base).origin
  )
    r.externalRequests.push(q.url());
});
const btn = (name) => p.getByRole("button", { name, exact: true });
async function project() {
  const event = p.waitForEvent("download");
  await p
    .locator(".top-toolbar")
    .getByRole("button", { name: "导出项目", exact: true })
    .click();
  const d = await event,
    f = dir + "/downloads/final-current.bead.json";
  await d.saveAs(f);
  return JSON.parse(fs.readFileSync(f, "utf8"));
}
async function generate() {
  const d = p.getByRole("dialog", { name: "上传图片并设置板子" });
  await d.getByLabel("导入宽度").fill("32");
  await d.getByLabel("导入高度").fill("32");
  await d.getByLabel("导入最大颜色数").fill("8");
  await d.getByRole("button", { name: "确认裁剪并生成拼豆图" }).click();
  await p.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
  await p.getByText("已自动保存", { exact: true }).waitFor();
}
try {
  await p.goto(base);
  await p.getByText("已自动保存", { exact: true }).waitFor();
  const source = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 2601;
    c.height = 37;
    const g = c.getContext("2d");
    for (let x = 0; x < c.width; x++) {
      g.fillStyle = `rgb(${x % 256},${(x * 7) % 256},${(x * 31) % 256})`;
      g.fillRect(x, 0, 1, 37);
    }
    return c.toDataURL();
  });
  await p
    .getByTestId("image-input")
    .setInputFiles({
      name: "large-no-resample.png",
      mimeType: "image/png",
      buffer: Buffer.from(source.split(",")[1], "base64"),
    });
  await generate();
  assert.equal((await project()).source, source);
  await p.reload();
  await p.getByText("已自动保存", { exact: true }).waitFor();
  assert.equal((await project()).source, source);
  r.checks.push({
    name: "超过2400px的原图导入及刷新后字节不变",
    width: 2601,
    height: 37,
  });
  await p
    .getByTestId("image-input")
    .setInputFiles("tests/fixtures/synthetic-illustration.png");
  await generate();
  const original = await project();
  await btn("编辑缩放比例").click();
  await p.getByLabel("缩放百分比").fill("50");
  await p.getByLabel("缩放百分比").press("Enter");
  await btn("手动裁剪").click();
  await btn("自动裁剪空白").click();
  const box = p.locator(".canvas-crop-selection"),
    before = await box.boundingBox();
  await p.mouse.move(
    before.x + before.width * 0.5,
    before.y + before.height * 0.4,
  );
  await p.mouse.down();
  await p.mouse.move(
    before.x + before.width * 0.5 + 14,
    before.y + before.height * 0.4,
    { steps: 5 },
  );
  await p.mouse.up();
  const moved = await box.boundingBox();
  assert.equal(moved.width, before.width);
  assert.notEqual(moved.x, before.x);
  await btn("自动裁剪空白").click();
  await p.screenshot({
    path: dir + "/canvas-crop.png",
    animations: "disabled",
  });
  await btn("确认裁剪").click();
  const cropped = await project();
  assert(cropped.width < 32 && cropped.height <= 32);
  await btn("撤销").click();
  assert.deepEqual((await project()).patternRle, original.patternRle);
  r.checks.push({
    name: "画布内八把手裁剪、选框平移、自动去空白、应用与撤销",
    crop: [cropped.width, cropped.height],
  });
  await btn("手型").click();
  await p.locator(".top-toolbar").evaluate((e) => (e.scrollLeft = 0));
  await p.locator(".settings-panel").evaluate((e) => (e.scrollTop = 0));
  if (await btn("关闭提示").count()) await btn("关闭提示").click();
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await p.screenshot({
    path: "verification/v1.1-comparison/local-uploaded-32-8.png",
    animations: "disabled",
  });
  await btn("画笔").click();
  await p.screenshot({ path: dir + "/brush-dock.png", animations: "disabled" });
  await btn("手型").click();
  await btn("下载图纸").click();
  let d = p.getByRole("dialog");
  await p.screenshot({
    path: dir + "/export-confirm.png",
    animations: "disabled",
  });
  await d.getByLabel("导出内容", { exact: true }).selectOption("palette");
  await d.getByRole("button", { name: "确认并生成图纸" }).click();
  await p.getByRole("dialog", { name: "导出完成" }).waitFor();
  const event = p.waitForEvent("download");
  await btn("下载文件").click();
  const download = await event,
    file = dir + "/downloads/final-palette.zip";
  await download.saveAs(file);
  const files = unzipSync(fs.readFileSync(file)),
    png = Buffer.from(
      Object.entries(files).find(([n]) => n.endsWith(".png"))[1],
    );
  assert.equal(png.readUInt32BE(16), 1400);
  assert.equal(png.readUInt32BE(20), 624);
  fs.writeFileSync(dir + "/downloads/final-palette.png", png);
  r.checks.push({
    name: "最终生产构建的独立色卡实际下载",
    width: 1400,
    height: 624,
  });
  assert.equal(r.errors.length, 0);
  assert.equal(r.externalRequests.length, 0);
  r.status = "passed";
} catch (e) {
  r.status = "failed";
  r.failure = e.stack;
  console.error(e);
  await p.screenshot({ path: dir + "/final-affected-failure.png" });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    dir + "/final-affected-results.json",
    JSON.stringify(r, null, 2),
  );
  console.log(r);
  await b.close();
}
