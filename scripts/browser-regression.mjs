import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { unzipSync, strFromU8 } from "fflate";
const base = process.env.TEST_URL || "http://127.0.0.1:5173",
  out = path.resolve("verification");
fs.mkdirSync(path.join(out, "downloads"), { recursive: true });
const result = {
  date: new Date().toISOString(),
  base,
  checks: [],
  consoleErrors: [],
  externalRequests: [],
  conversions: [],
  exports: [],
};
const pass = (name, detail) => {
  result.checks.push({ name, status: "passed", detail });
  console.log("PASS", name, detail ?? "");
};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
context.on("page", (p) =>
  p.on("pageerror", (e) => result.consoleErrors.push(e.message)),
);
page.on("pageerror", (e) => result.consoleErrors.push(e.message));
context.on("request", (r) => {
  if (
    /^https?:/.test(r.url()) &&
    new URL(r.url()).origin !== new URL(base).origin
  )
    result.externalRequests.push(r.url());
});
const readProject = async (p = page) => {
  const promise = p.waitForEvent("download");
  await p.getByRole("button", { name: "导出项目", exact: true }).click();
  const d = await promise;
  const file = path.join(out, "downloads", d.suggestedFilename());
  await d.saveAs(file);
  return JSON.parse(fs.readFileSync(file, "utf8"));
};
const decode = (p) => {
  const a = [];
  for (let i = 0; i < p.patternRle.length; i += 2)
    for (let j = 0; j < p.patternRle[i + 1]; j++) a.push(p.patternRle[i]);
  return a;
};
const total = (p) => decode(p).filter((v) => v >= 0).length;
async function upload(file, w = 24, h = 24, p = page) {
  await p.getByTestId("image-input").setInputFiles(file);
  const dialog = p.getByRole("dialog", { name: "导入与构图" });
  await dialog.waitFor();
  await dialog.getByLabel("导入宽度").fill(String(w));
  await dialog.getByLabel("导入高度").fill(String(h));
  await dialog.locator("input[type=range]").first().fill("8");
  await dialog.getByRole("button", { name: "生成拼豆图" }).click();
  await p
    .getByRole("alert")
    .filter({ hasText: "图纸已生成" })
    .waitFor({ timeout: 60000 });
  return readProject(p);
}
function pngInfo(bytes) {
  let offset = 8,
    meta,
    compressed = [],
    w,
    h;
  while (offset < bytes.length) {
    const n = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8),
      body = bytes.subarray(offset + 8, offset + 8 + n);
    if (type === "IHDR") {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
    }
    if (type === "IDAT") compressed.push(body);
    if (type === "tEXt" && body.toString().startsWith("bead-project\0"))
      meta = JSON.parse(body.subarray(13).toString());
    offset += n + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  assert.equal(raw.length, h * (w * 4 + 1));
  return { width: w, height: h, metadata: meta, raw };
}
async function exportFile(kind, cell = 24, mirror = false, board = 52) {
  await page.getByRole("button", { name: "下载图纸", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出你的拼豆作品" });
  await dialog.getByLabel("导出内容").selectOption(kind);
  await dialog.getByLabel("每格像素").selectOption(String(cell));
  await dialog.getByLabel("常规板尺寸").selectOption(String(board));
  await dialog.getByLabel("镜像导出", { exact: true }).setChecked(mirror);
  const promise = page.waitForEvent("download", { timeout: 60000 });
  await dialog.getByRole("button", { name: "开始导出" }).click();
  await page.getByRole("button", { name: "下载文件", exact: true }).click();
  const d = await promise,
    file = path.join(out, "downloads", d.suggestedFilename());
  await d.saveAs(file);
  return { file, bytes: fs.readFileSync(file) };
}
try {
  await page.goto(base);
  await page.getByText("已自动保存", { exact: true }).waitFor();
  assert(
    await page
      .getByRole("button", { name: "AI 生图", exact: true })
      .isDisabled(),
  );
  await page.screenshot({ path: path.join(out, "desktop.png") });
  pass("桌面工作台、禁用AI状态");
  await page.getByRole("button", { name: "自定义创作", exact: true }).click();
  await page.getByRole("button", { name: "创建空白板" }).click();
  await page.getByTestId("usage-total").filter({ hasText: /^0 / }).waitFor();
  const canvas = page.getByTestId("editor-canvas"),
    rect = await canvas.boundingBox();
  await canvas.click({ position: { x: rect.width / 2, y: rect.height / 2 } });
  await page.getByTestId("usage-total").filter({ hasText: /^1 / }).waitFor();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByTestId("usage-total").filter({ hasText: /^0 / }).waitFor();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByTestId("usage-total").filter({ hasText: /^1 / }).waitFor();
  pass("真实单格绘制、撤销、重做、用量同步");
  await page.getByRole("button", { name: "替换颜色", exact: true }).click();
  await page.getByLabel("原色号", { exact: true }).selectOption("0");
  await page.getByLabel("目标色号", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "替换全部", exact: true }).click();
  let p = await readProject();
  assert.equal(total(p), 1);
  assert(decode(p).includes(1));
  pass("单色替换与数量守恒");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("已自动保存", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("已自动保存", { exact: true }).waitFor();
  const restored = await readProject();
  assert.deepEqual(restored.patternRle, p.patternRle);
  assert.deepEqual(restored.settings, p.settings);
  pass("保存刷新自动恢复，网格与参数一致");
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page.locator(".work-card").first().waitFor();
  assert((await page.locator(".work-card").count()) >= 1);
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  pass("本地作品列表可读");
  const chart = await exportFile("chart", 24),
    chartInfo = pngInfo(chart.bytes);
  assert.equal(chartInfo.metadata.total, 1);
  assert.equal(chartInfo.metadata.usage[0].code, "A2");
  assert.equal(chartInfo.width, 52 * 24 + 128);
  result.exports.push({
    kind: "chart",
    file: path.relative(out, chart.file),
    width: chartInfo.width,
    height: chartInfo.height,
    metadata: chartInfo.metadata,
  });
  pass(
    "实际下载图纸PNG，解码尺寸、色号、数量",
    `${chartInfo.width}×${chartInfo.height}`,
  );
  const mosaic = await exportFile("mosaic", 8),
    mInfo = pngInfo(mosaic.bytes);
  assert.equal(mInfo.width, 416);
  assert.equal(mInfo.height, 416);
  const alphaCount = () => {
    let n = 0;
    for (let y = 0; y < mInfo.height; y++)
      for (let x = 0; x < mInfo.width; x++)
        if (mInfo.raw[y * (mInfo.width * 4 + 1) + 1 + x * 4 + 3] > 0) n++;
    return n;
  };
  assert.equal(alphaCount(), 64);
  pass("纯马赛克PNG空格透明，每格8×8像素");
  const palette = await exportFile("palette", 24),
    pf = unzipSync(palette.bytes);
  assert(pf["色卡用量.png"]);
  assert(strFromU8(pf["用量.csv"]).includes("A2"));
  pass("独立色卡PNG和用量CSV实际下载");
  const mirror = await exportFile("mosaic", 8, true),
    mirrorInfo = pngInfo(mirror.bytes);
  for (let y = 0; y < 416; y += 8)
    for (let x = 0; x < 416; x += 8) {
      const at = y * (416 * 4 + 1) + 1 + x * 4,
        bt = y * (416 * 4 + 1) + 1 + (415 - x) * 4;
      assert.deepEqual(
        mInfo.raw.subarray(at, at + 4),
        mirrorInfo.raw.subarray(bt, bt + 4),
      );
    }
  pass("镜像导出的像素左右反转");
  const board = await exportFile("sections", 16),
    bf = unzipSync(board.bytes),
    manifest = JSON.parse(strFromU8(bf["分板说明.json"]));
  assert.equal(manifest.total, 1);
  assert.equal(manifest.tiles.length, 1);
  assert.equal(pngInfo(Buffer.from(bf["板_1_1.png"])).metadata.total, 1);
  pass("52格分板套装、说明与分区用量一致");
  for (const size of [78, 104]) {
    const assembled = await exportFile("assembly", 16, false, size),
      parts = unzipSync(assembled.bytes),
      plan = JSON.parse(strFromU8(parts["分板说明.json"]));
    assert(parts["拼板总览.png"]);
    assert.equal(plan.board, size);
    assert.equal(plan.total, 1);
    assert.equal(pngInfo(Buffer.from(parts["拼板总览.png"])).metadata.total, 1);
  }
  pass("78与104格拼板套装包含实际总览PNG，分区用量一致");
  for (const name of [
    "solid-blocks",
    "wide-contain",
    "portrait-contain",
    "transparent-edge",
    "gradient",
    "thin-lines",
    "synthetic-illustration",
  ]) {
    p = await upload(
      path.resolve(`tests/fixtures/${name}.png`),
      24,
      name === "gradient" ? 16 : 24,
    );
    const cells = decode(p),
      used = new Map();
    for (const v of cells) {
      assert(v >= -1 && v < 221);
      if (v >= 0) used.set(v, (used.get(v) || 0) + 1);
    }
    assert.equal(cells.length, p.width * p.height);
    assert(used.size <= 8);
    assert.equal(
      [...used.values()].reduce((a, b) => a + b, 0),
      total(p),
    );
    if (
      name === "wide-contain" ||
      name === "portrait-contain" ||
      name === "transparent-edge"
    )
      assert(cells.includes(-1));
    result.conversions.push({
      name,
      width: p.width,
      height: p.height,
      used: used.size,
      total: total(p),
      blank: cells.filter((v) => v < 0).length,
    });
  }
  pass("横图、竖图、透明图、渐变、细线与插画转换，7组数量守恒");
  // Native browser decoding for JPEG/WebP and invalid-file feedback.
  const imageBytes = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 48;
    const g = c.getContext("2d");
    g.fillStyle = "#e04080";
    g.fillRect(0, 0, 64, 48);
    return { jpeg: c.toDataURL("image/jpeg"), webp: c.toDataURL("image/webp") };
  });
  for (const [format, url] of Object.entries(imageBytes)) {
    const file = path.join(out, `input.${format}`);
    fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    const q = await upload(file, 32, 24);
    assert(total(q) > 0);
  }
  pass("JPEG、WebP真实浏览器导入");
  await page.getByTestId("image-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("broken"),
  });
  await page.getByRole("alert").filter({ hasText: "图片解码失败" }).waitFor();
  await page.getByTestId("image-input").setInputFiles({
    name: "wrong.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  await page.getByRole("alert").filter({ hasText: "仅支持" }).waitFor();
  pass("损坏图片与不支持格式反馈");
  const backup = await readProject();
  await page.getByRole("button", { name: "清除画面", exact: true }).click();
  await page.getByTestId("project-input").setInputFiles({
    name: "restore.bead.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page
    .getByTestId("usage-total")
    .filter({ hasText: new RegExp("^" + total(backup).toLocaleString() + " ") })
    .waitFor();
  assert.deepEqual((await readProject()).patternRle, backup.patternRle);
  pass("可编辑项目文件导入恢复");
  await page.getByRole("button", { name: "图纸调节", exact: true }).click();
  await page.getByLabel("亮度", { exact: true }).fill("20");
  await page
    .getByRole("button", { name: "应用并重新生成", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "图纸已生成" }).waitFor();
  pass("图纸亮度调节与重新生成");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  assert(
    await page
      .getByRole("heading", { name: "待开发", exact: true })
      .isVisible(),
  );
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  pass("更多功能保留待开发状态");
  // The isolated local test accounts have no relationship to original site credentials.
  const suffix = Date.now().toString(36),
    accountA = "qa_a_" + suffix,
    accountB = "qa_b_" + suffix,
    testPassword = "LocalQaOnly_39284";
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("账号", { exact: true }).fill(accountA);
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "账号已创建" }).waitFor();
  await page.getByRole("button", { name: "保存至账号", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "作品已保存" }).waitFor();
  const myProject = await readProject();
  const own = await context.request.get(base + "/api/works/" + myProject.id);
  assert.equal(own.status(), 200);
  const contextB = await browser.newContext({
      viewport: { width: 900, height: 800 },
    }),
    pageB = await contextB.newPage();
  await pageB.goto(base);
  await pageB.getByRole("button", { name: "登录 / 注册" }).click();
  await pageB.getByRole("button", { name: "注册", exact: true }).click();
  await pageB.getByLabel("账号", { exact: true }).fill(accountB);
  await pageB.getByLabel("密码", { exact: true }).fill(testPassword);
  await pageB.getByRole("button", { name: "创建账号", exact: true }).click();
  await pageB.getByRole("alert").filter({ hasText: "账号已创建" }).waitFor();
  assert.equal(
    (await contextB.request.get(base + "/api/works/" + myProject.id)).status(),
    404,
  );
  assert.equal(
    (
      await contextB.request.delete(base + "/api/works/" + myProject.id)
    ).status(),
    404,
  );
  assert.equal((await contextB.request.get(base + "/api/works")).status(), 200);
  assert.equal(
    (await (await contextB.request.get(base + "/api/works")).json()).works
      .length,
    0,
  );
  const invalid = await contextB.request.put(
    base + "/api/works/" + myProject.id,
    { data: { project: { ...myProject, patternRle: [999, 1] } } },
  );
  assert.equal(invalid.status(), 400);
  await contextB.close();
  pass("两个账号真实注册，服务端作品读取/删除隔离与非法网格拒绝");
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("账号", { exact: true }).fill(accountA);
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "登录成功" }).waitFor();
  pass("退出后重新登录，密码校验和会话可用");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, "mobile.png") });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "设置与用量", exact: true }).click();
  assert(await page.getByTestId("usage-total").isVisible());
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  const mp = await upload(
    path.resolve("tests/fixtures/transparent-edge.png"),
    24,
    24,
  );
  assert(total(mp) > 0);
  const mc = page.getByTestId("editor-canvas"),
    mb = await mc.boundingBox();
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await mc.click({ position: { x: mb.width / 2, y: mb.height / 2 } });
  await page.getByRole("button", { name: "下载图纸", exact: true }).click();
  assert(
    await page
      .getByRole("button", { name: "开始导出", exact: true })
      .isVisible(),
  );
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.screenshot({ path: path.join(out, "mobile-edited.png") });
  const mobileFile = await exportFile("mosaic", 8, false);
  assert.equal(pngInfo(mobileFile.bytes).metadata.width, 24);
  pass("390px手机宽度导入、编辑、设置与实际下载可用");
  await page.setViewportSize({ width: 820, height: 1180 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: path.join(out, "tablet.png") });
  pass("820px平板布局无横向溢出");
  assert.equal(result.externalRequests.length, 0);
  assert.equal(result.consoleErrors.length, 0);
  pass("运行期间无外部域名请求，无浏览器脚本错误");
  result.status = "passed";
} catch (e) {
  result.status = "failed";
  result.error = String(e.stack || e);
  console.error(e);
  await page
    .screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(out, "browser-results.json"),
    JSON.stringify(result, null, 2),
  );
  await browser.close();
}
