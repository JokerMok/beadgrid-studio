import { chromium } from "playwright";
import fs from "node:fs";
import { createInflate } from "node:zlib";
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const base = process.env.TEST_URL || "http://127.0.0.1:4173",
  dir = "verification/v1.1-regression",
  b = await chromium.launch({ headless: true }),
  p = await b.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
p.setDefaultTimeout(20000);
const result = { base, checks: [], errors: [] };
p.on("pageerror", (e) => result.errors.push(e.message));
try {
  await p.goto(base);
  await p.getByText("已自动保存", { exact: true }).waitFor();
  const raw = JSON.parse(
    fs.readFileSync(
      dir + "/downloads/synthetic-illustration.bead.json",
      "utf8",
    ),
  );
  Object.assign(raw, {
    id: crypto.randomUUID(),
    name: "大图完整输出回归-500x279-114色",
    width: 500,
    height: 279,
    source: undefined,
    patternRle: [],
  });
  Object.assign(raw.settings, {
    width: 500,
    height: 279,
    limit: 114,
    mode: "normal",
  });
  let last = -2,
    count = 0;
  for (let y = 0; y < 279; y++)
    for (let x = 0; x < 500; x++) {
      const c = (Math.floor(x / 10) + Math.floor(y / 10) * 50) % 114;
      if (c === last) count++;
      else {
        if (count) raw.patternRle.push(last, count);
        last = c;
        count = 1;
      }
    }
  raw.patternRle.push(last, count);
  await p
    .getByTestId("project-input")
    .setInputFiles({
      name: "large.bead.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(raw)),
    });
  await p.waitForFunction(
    (name) => document.querySelector(".project-title input")?.value === name,
    raw.name,
  );
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await p.getByRole("button", { name: "下载图纸", exact: true }).click();
  const d = p.getByRole("dialog");
  assert((await d.innerText()).includes("28,268 × 17,549"));
  await p.screenshot({
    path: dir + "/large-confirm.png",
    animations: "disabled",
  });
  const start = Date.now();
  await d.getByRole("button", { name: "确认并生成图纸" }).click();
  await p.getByRole("button", { name: "取消处理", exact: true }).waitFor();
  await p.screenshot({
    path: dir + "/large-progress.png",
    animations: "disabled",
  });
  await p
    .getByRole("dialog", { name: "导出完成" })
    .waitFor({ timeout: 240000 });
  const event = p.waitForEvent("download");
  await p.getByRole("button", { name: "下载文件", exact: true }).click();
  const dl = await event,
    file = dir + "/downloads/" + dl.suggestedFilename();
  await dl.saveAs(file);
  const bytes = fs.readFileSync(file),
    parts = [];
  let at = 8,
    meta,
    width,
    height;
  while (at < bytes.length) {
    const n = bytes.readUInt32BE(at),
      type = bytes.toString("ascii", at + 4, at + 8),
      body = bytes.subarray(at + 8, at + 8 + n);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    }
    if (type === "tEXt") meta = JSON.parse(body.subarray(13));
    if (type === "IDAT") parts.push(body);
    at += n + 12;
  }
  assert.equal(width, 28268);
  assert.equal(height, 17549);
  assert.equal(meta.total, 139500);
  assert.equal(meta.usage.length, 114);
  let decoded = 0;
  for await (const chunk of Readable.from(parts).pipe(createInflate()))
    decoded += chunk.length;
  assert.equal(decoded, (width * 4 + 1) * height);
  result.checks.push({
    name: "500×279 / 114色实际完整单张PNG下载与流式解码",
    width,
    height,
    bytes: bytes.length,
    decodedBytes: decoded,
    total: meta.total,
    colors: meta.usage.length,
    elapsedSeconds: Math.round((Date.now() - start) / 1000),
    file,
  });
  console.log(result.checks.at(-1));
  // Cancel a much larger export without allocating a full image or changing the project.
  Object.assign(raw, {
    id: crypto.randomUUID(),
    name: "百万格取消回归",
    width: 1000,
    height: 1000,
    patternRle: [1, 1000000],
  });
  Object.assign(raw.settings, { width: 1000, height: 1000 });
  await p
    .getByTestId("project-input")
    .setInputFiles({
      name: "cancel.bead.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(raw)),
    });
  await p.waitForFunction(
    (name) => document.querySelector(".project-title input")?.value === name,
    raw.name,
  );
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await p.getByRole("button", { name: "下载图纸", exact: true }).click();
  await p.getByRole("button", { name: "确认并生成图纸" }).click();
  await p.getByRole("button", { name: "取消处理", exact: true }).click();
  await p.getByRole("alert").filter({ hasText: "已取消" }).waitFor();
  assert((await p.getByLabel("板子宽度").inputValue()) === "1000");
  await p.getByText("已自动保存", { exact: true }).waitFor();
  const event2 = p.waitForEvent("download");
  await p
    .locator(".top-toolbar")
    .getByRole("button", { name: "导出项目", exact: true })
    .click();
  const dl2 = await event2,
    file2 = dir + "/downloads/cancel-restored.bead.json";
  await dl2.saveAs(file2);
  assert.deepEqual(JSON.parse(fs.readFileSync(file2)).patternRle, [1, 1000000]);
  result.checks.push({
    name: "百万格完整导出可取消，网格未改变",
    cells: 1000000,
  });
  assert.equal(result.errors.length, 0);
  result.status = "passed";
} catch (e) {
  result.status = "failed";
  result.failure = e.stack;
  console.error(e);
  await p.screenshot({ path: dir + "/large-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    dir + "/large-export-results.json",
    JSON.stringify(result, null, 2),
  );
  await b.close();
}
