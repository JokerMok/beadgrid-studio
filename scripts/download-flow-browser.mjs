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
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "bead-download-")),
  socket = net.createServer().listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = "http://127.0.0.1:" + port;
const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    ENV_FILE: "none",
    DATA_DIR: temp,
    STATIC_DIR: path.resolve(
      root,
      process.env.TEST_BUILD_DIR ||
        (fs.existsSync(
          path.join(root, ".local-public/v16-local/dist/index.html"),
        )
          ? ".local-public/v16-local/dist"
          : "dist"),
    ),
    HOST: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "test",
    SMTP_HOST: "",
    COOKIE_SECURE: "0",
    SIGNUP_MEMBER_DAYS: "0",
    SIGNUP_FREE_CREDITS: "2",
    REWARD_REQUIRE_VERIFIED_EMAIL: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (b) => (log += b));
server.stderr.on("data", (b) => (log += b));
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(base + "/api/health")).ok) break;
  } catch {}
  await pause(40);
}
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1024 },
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
  }),
  report = {
    checks: [],
    errors: [],
    downloads: [],
    date: new Date().toISOString(),
  };
let page;
const mark = (s) => {
  report.checks.push(s);
  console.log("PASS", s);
};
async function file(action, name) {
  const event = page.waitForEvent("download");
  await action();
  const d = await event;
  assert.equal(await d.failure(), null);
  const target = path.join(out, "downloads", name);
  await d.saveAs(target);
  const bytes = fs.readFileSync(target);
  report.downloads.push({ name, bytes: bytes.length });
  return bytes;
}
async function menu(name) {
  await page.getByLabel("作品菜单", { exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
const account = async () =>
  (await (await context.request.get(base + "/api/account")).json()).user;
const ready = async () => {
  await page
    .getByRole("heading", { name: "文件已生成", exact: true })
    .waitFor();
};
function pngMeta(b) {
  let result;
  for (let i = 8; i < b.length; ) {
    const n = b.readUInt32BE(i),
      type = b.subarray(i + 4, i + 8).toString(),
      data = b.subarray(i + 8, i + 8 + n).toString();
    if (type === "tEXt" && data.startsWith("bead-project\0"))
      result = JSON.parse(data.slice(13));
    i += n + 12;
  }
  return result;
}
function csvRows(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
try {
  const r = await context.request.post(base + "/api/register", {
    data: {
      username: "isolated-download-user",
      password: "isolated-download-2026",
    },
  });
  assert.equal(r.status(), 201);
  assert.equal((await account()).freeCredits, 2);
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.getByText("已自动保存", { exact: true }).waitFor();
  await menu("自定义创作");
  await page.getByLabel("新建宽度", { exact: true }).fill("16");
  await page.getByLabel("新建高度", { exact: true }).fill("16");
  await page.getByRole("button", { name: /创建空白板/ }).click();
  await page.getByLabel("下载图纸", { exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "确认并生成图纸", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByLabel("关闭弹窗").click();
  await menu("导出空白模板");
  await page
    .getByRole("button", { name: "确认并生成图纸", exact: true })
    .click();
  await ready();
  assert.equal((await account()).freeCredits, 1);
  const blank = await file(
    () => page.getByRole("button", { name: "下载文件", exact: true }).click(),
    "blank-template.png",
  );
  assert.equal(pngMeta(blank).total, 0);
  assert.deepEqual(pngMeta(blank).usage, []);
  assert.equal((await account()).freeCredits, 1);
  const again = await file(
    () => page.getByRole("link", { name: "再次下载", exact: true }).click(),
    "blank-template-repeat.png",
  );
  assert.deepEqual(again, blank);
  assert.equal((await account()).freeCredits, 1);
  await page
    .getByRole("button", { name: "关闭／取消未完成任务", exact: true })
    .click();
  mark("空白模板独立确认、实际PNG下载、普通用户结算1次、重复下载不再扣次");
  await menu("导出空白模板");
  await page
    .getByRole("button", { name: "确认并生成图纸", exact: true })
    .click();
  await ready();
  assert.equal((await account()).freeCredits, 0);
  await page
    .getByRole("button", { name: "关闭／取消未完成任务", exact: true })
    .click();
  for (let i = 0; i < 30 && (await account()).freeCredits !== 1; i++)
    await pause(40);
  assert.equal((await account()).freeCredits, 1);
  mark("文件尚未提交下载时取消，真实服务端返还预留次数");
  await menu("我的作品");
  await page
    .locator(".work-open")
    .filter({ hasText: "雷电将军" })
    .first()
    .click();
  await page.getByText("已自动保存", { exact: true }).waitFor();
  await pause(700);
  const raw = await page.evaluate(async () => {
    const id = (await (await fetch("/api/me")).json()).user.id;
    return new Promise((resolve) => {
      const r = indexedDB.open("xing-local-v1", 1);
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
      };
    });
  });
  const grid = raw.patternRle.flatMap((v, i, a) =>
      i % 2 ? [] : Array(a[i + 1]).fill(v),
    ),
    palette = JSON.parse(
      fs.readFileSync(path.join(root, "src/palette.json"), "utf8"),
    ),
    counts = new Map();
  for (const n of grid)
    if (n >= 0)
      counts.set(palette[n].code, (counts.get(palette[n].code) || 0) + 1);
  await page.getByRole("button", { name: "用豆清单", exact: true }).click();
  await page.getByRole("button", { name: "复制文字清单", exact: true }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  for (const [code, n] of counts)
    assert.match(text, new RegExp("^" + code + "\\t" + n + "$", "m"));
  const csv = await file(
    () => page.getByRole("button", { name: "下载 CSV", exact: true }).click(),
    "raiden-list.csv",
  );
  const parsed = csvRows(csv.toString("utf8").replace(/^\uFEFF/, "")),
    header = parsed.shift(),
    codeColumn = header.indexOf("色号"),
    countColumn = header.indexOf("实际所需(颗)");
  assert.equal(parsed.length, counts.size);
  for (const row of parsed)
    assert.equal(+row[countColumn], counts.get(row[codeColumn]));
  const retry = await file(
    () =>
      page.getByRole("link", { name: "再次下载当前清单", exact: true }).click(),
    "raiden-list-repeat.csv",
  );
  assert.deepEqual(retry, csv);
  const zip = await file(
      () =>
        page.getByRole("button", { name: "下载清单图片", exact: true }).click(),
      "raiden-list-images.zip",
    ),
    entries = unzipSync(zip),
    manifest = JSON.parse(Buffer.from(entries["清单数据.json"]).toString());
  assert.equal(manifest.total, grid.filter((n) => n >= 0).length);
  assert.equal(manifest.colorCount, counts.size);
  for (const row of manifest.rows)
    assert.equal(row.count, counts.get(row.code));
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.endsWith(".png")) continue;
    await page.evaluate(async (bytes) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      if (image.width !== 1240 || image.height < 1000)
        throw Error("清单图片尺寸异常");
      image.close();
    }, Array.from(bytes));
    fs.writeFileSync(path.join(out, "downloads", "raiden-" + name), bytes);
  }
  await page.screenshot({
    path: path.join(out, "bead-list-complete.png"),
    fullPage: true,
  });
  assert.equal((await account()).freeCredits, 1);
  mark(
    "雷电64色多页清单：页面/真实复制文本/中文CSV/PNG内清单数据与当前网格逐色一致，备用下载可用",
  );
  await page
    .getByRole("link", { name: "再次下载当前清单", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  assert.match(
    await page.evaluate(() => document.activeElement.textContent),
    /打开文件备用保存/,
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "用豆清单" })
    .waitFor({ state: "hidden" });
  await page
    .getByTestId("reference-input")
    .setInputFiles(path.join(root, "tests/fixtures/portrait-contain.png"));
  await page.getByRole("dialog", { name: "描摹参考底图" }).waitFor();
  const before = await page
    .getByRole("checkbox", {
      name: "清除底图主要边缘背景（实验，非AI）",
      exact: true,
    })
    .isChecked();
  assert.equal(before, false);
  await page
    .getByRole("checkbox", {
      name: "清除底图主要边缘背景（实验，非AI）",
      exact: true,
    })
    .check();
  await page.getByRole("dialog", { name: "描摹参考底图" }).waitFor();
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "清除底图主要边缘背景（实验，非AI）",
        exact: true,
      })
      .isChecked(),
    true,
  );
  await page
    .getByRole("checkbox", {
      name: "清除底图主要边缘背景（实验，非AI）",
      exact: true,
    })
    .uncheck();
  await page.getByRole("dialog", { name: "描摹参考底图" }).waitFor();
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "清除底图主要边缘背景（实验，非AI）",
        exact: true,
      })
      .isChecked(),
    false,
  );
  mark("底图实验性去背景真实处理及原始底图还原");
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.stack;
  await page
    ?.screenshot({ path: path.join(out, "download-failure.png") })
    .catch(() => {});
  throw e;
} finally {
  fs.writeFileSync(
    path.join(out, "download-results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  server.kill();
  await once(server, "exit");
  fs.rmSync(temp, { recursive: true, force: true });
}
