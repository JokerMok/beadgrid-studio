// Public acceptance: only two explicit disposable QA consumers, no unrelated product writes.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
const base = "https://pindou.shizibandu.icu",
  root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "verification/accounts-integration-20261022"),
  priv = path.join(root, ".local-public/account-integration");
const qa = JSON.parse(
  fs.readFileSync(
    process.env.BEADGRID_QA_FILE || path.join(priv, "qa-accounts.json"),
  ),
);
if (
  ![qa.a.username, qa.b.username].every((s) =>
    /^qa_beadgrid_20261022_[ab]_/.test(s),
  )
)
  throw Error("Dedicated QA identities required");
fs.mkdirSync(path.join(out, "downloads"), { recursive: true });
const b = await chromium.launch({ headless: true }),
  report = {
    date: new Date().toISOString(),
    checks: [],
    downloads: [],
    errors: [],
    badRequests: [],
    notes: [],
    status: "running",
  };
const mark = (s) => {
  report.checks.push(s);
  console.log("PASS", s);
  fs.writeFileSync(
    path.join(out, "browser-results.json"),
    JSON.stringify(report, null, 2),
  );
};
const ssh = async (mode) => {
  await promisify(execFile)("ssh", [
    "tencent-main",
    `sudo /srv/apps/zhenyi-accounts/shared/runtime/node-v22.23.3-linux-x64/bin/node --import /srv/apps/zhenyi-accounts/current/node_modules/tsx/dist/loader.mjs /tmp/beadgrid-qa-accounts.mjs ${mode}`,
  ]);
};
const ctx = () =>
  b.newContext({
    viewport: { width: 1488, height: 1056 },
    acceptDownloads: true,
  });
const a = await ctx(),
  c = await ctx();
function watch(p) {
  p.setDefaultTimeout(25000);
  p.on("dialog", (d) => d.accept());
  p.on("pageerror", (e) => report.errors.push(e.message));
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (["localhost", "127.0.0.1"].includes(u.hostname))
      report.badRequests.push(u.origin + u.pathname);
  });
}
const ap = await a.newPage(),
  bp = await c.newPage();
watch(ap);
watch(bp);
const me = async (p) =>
  p.evaluate(async () => {
    const r = await fetch("/api/me");
    return { status: r.status, ...(await r.json()) };
  });
const call = (p, route, body, method) =>
  p.evaluate(
    async ({ route, body, method }) => {
      const r = await fetch("/api" + route, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, ...(await r.json()) };
    },
    { route, body, method },
  );
const saved = async (p) => {
  await p.getByText("已自动保存", { exact: true }).waitFor();
  await p.waitForTimeout(750);
};
async function snap(p) {
  const id = (await me(p)).user?.id;
  return p.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("beadgrid-public-accounts-v1", 1);
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
      }),
    id,
  );
}
const cells = (p) =>
  p.patternRle.flatMap((v, i, r) => (i % 2 ? [] : Array(r[i + 1]).fill(v)));
const total = (p) => cells(p).filter((v) => v >= 0).length;
async function login(p, user, register = false) {
  await p.goto(base + "/auth/login?switch=1");
  if (register) {
    await p.getByRole("link", { name: "立即注册", exact: true }).click();
    await p.locator("#username").fill(user.username);
    await p.locator("#name").fill("拼豆专用验收B");
    await p.locator("#password").fill(user.password);
    await p.locator("#confirm").fill(user.password);
    await p.getByRole("button", { name: "注册", exact: true }).click();
  } else {
    await p.locator("#username").fill(user.username);
    await p.locator("#password").fill(user.password);
    await p.getByRole("button", { name: "登录", exact: true }).click();
  }
  await p.waitForURL(
    (u) => u.origin === base || (register && u.pathname.includes("/login/")),
    { timeout: 30000 },
  );
  if (new URL(p.url()).origin !== base) {
    await p.locator("#username").fill(user.username);
    await p.locator("#password").fill(user.password);
    await p.getByRole("button", { name: "登录", exact: true }).click();
    await p.waitForURL((u) => u.origin === base);
  }
  await saved(p);
  const r = await me(p);
  assert.equal(r.status, 200);
  assert.ok(r.user?.uid, await p.title());
  return r.user;
}
async function downloaded(p, trigger, name) {
  const event = p.waitForEvent("download");
  await trigger();
  const d = await event;
  assert.equal(await d.failure(), null);
  const file = path.join(out, "downloads", name || d.suggestedFilename());
  await d.saveAs(file);
  const data = fs.readFileSync(file);
  assert.ok(data.length > 20);
  report.downloads.push({ name: path.basename(file), bytes: data.length });
  return data;
}
async function png(p, data) {
  assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return p.evaluate(
    async (bytes) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const r = { width: image.width, height: image.height };
      image.close();
      return r;
    },
    [...data],
  );
}
const projectMenu = async (p, label) => {
  await p.getByLabel("作品菜单", { exact: true }).click();
  await p.getByRole("button", { name: label, exact: true }).click();
};
async function exportKind(p, kind) {
  await p.getByLabel("下载图纸", { exact: true }).click();
  const d = p
    .getByRole("dialog")
    .filter({ has: p.getByLabel("导出内容", { exact: true }) });
  if (kind) await d.getByLabel("导出内容", { exact: true }).selectOption(kind);
  await d.getByRole("button", { name: "确认并生成图纸", exact: true }).click();
  const ready = p.getByRole("dialog", { name: "导出完成", exact: true });
  await ready.waitFor();
  const bytes = await downloaded(
    p,
    () => ready.getByRole("button", { name: "下载文件", exact: true }).click(),
    kind + "." + (["palette", "sections"].includes(kind) ? "zip" : "png"),
  );
  await ready
    .getByRole("button", { name: "关闭／取消未完成任务", exact: true })
    .click();
  return bytes;
}
let au, bu, current;
try {
  if (!process.env.BEADGRID_RESUME) {
    await ap.goto(base);
    await saved(ap);
    assert.match(
      await ap.getByLabel("作品名称", { exact: true }).inputValue(),
      /雷电将军/,
    );
    // Seed only a legacy fixture to verify the one-time public-origin reset and unrelated storage preservation.
    await ap.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("xing-local-v1", 1);
          r.onupgradeneeded = () => {
            r.result.createObjectStore("meta");
            r.result.createObjectStore("projects", { keyPath: "id" });
          };
          r.onsuccess = () => {
            const db = r.result,
              t = db.transaction("meta", "readwrite");
            t.objectStore("meta").put(
              { id: "old-account-project", name: "旧账号不可回显" },
              "draft",
            );
            t.oncomplete = () => {
              db.close();
              localStorage.removeItem("beadgrid-cache-epoch");
              localStorage.setItem("beadgrid-auth-change", "old");
              localStorage.setItem("unrelated-test-marker", "keep");
              resolve();
            };
            t.onerror = () => reject(t.error);
          };
        }),
    );
    await ap.reload();
    await saved(ap);
    assert.match(
      await ap.getByLabel("作品名称", { exact: true }).inputValue(),
      /雷电将军/,
    );
    assert.equal(
      await ap.evaluate(() => localStorage.getItem("unrelated-test-marker")),
      "keep",
    );
    assert.ok(
      await ap.evaluate(async () =>
        (await indexedDB.databases()).some(
          (v) => v.name === "beadgrid-quarantined-legacy-backup-v1",
        ),
      ),
    );
    mark("旧拼豆缓存隔离备份并失效，不恢复旧账号作品；其他存储标记保留");
    await ap.getByRole("button", { name: "登录 / 注册", exact: true }).click();
    await ap
      .getByRole("link", { name: "登录／注册公共账号", exact: true })
      .click();
    await ap.locator("#username").fill(qa.a.username);
    await ap.locator("#password").fill(qa.a.password);
    await ap.getByRole("button", { name: "登录", exact: true }).click();
    await ap.waitForURL((u) => u.origin === base);
    await saved(ap);
    au = (await me(ap)).user;
    assert.ok(au.uid);
    mark("已有公共消费者A从拼豆入口授权登录、精确回调与刷新恢复");
    const sessionA = await a.cookies(base);
    assert.ok(
      sessionA.some(
        (v) =>
          v.name === "__Host-beadgrid_session" &&
          v.secure &&
          v.httpOnly &&
          v.sameSite === "Lax" &&
          v.domain === "pindou.shizibandu.icu",
      ),
    );

    const registered = path.join(priv, "b-registered.json");
    if (!fs.existsSync(registered)) {
      bu = await login(bp, qa.b, true);
      fs.writeFileSync(
        registered,
        JSON.stringify({ registeredAt: new Date().toISOString(), uid: bu.uid }),
        { mode: 0o600 },
      );
      mark("新消费者B在正式统一认证页面实际注册并回到拼豆");
    } else {
      bu = await login(bp, qa.b);
      mark("专用消费者B登录；首次统一注册证据保留");
    }
    assert.notEqual(au.uid, bu.uid);
    await ssh("grant-a");
    await ssh("grant-b");
    assert.equal((await me(ap)).user.exportAccess, true);
    assert.equal((await me(bp)).user.freeCredits >= 5, true);
    mark(
      "统一后台同一业务服务开通A拼豆会员、B拼豆次数，真实中心读取；运营审计保留",
    );
    await ap
      .getByTestId("image-input")
      .setInputFiles(path.join(root, "src/assets/raiden-shogun.png"));
    const imp = ap.getByRole("dialog", { name: "上传图片并设置板子" });
    await imp.getByRole("button", { name: "长边100格", exact: true }).click();
    await ap.waitForFunction(
      () =>
        document.querySelector(".import-preview-viewport")?.dataset.state ===
        "ready",
    );
    await imp.getByRole("button", { name: "确认生成", exact: true }).click();
    await imp.waitFor({ state: "hidden" });
    await saved(ap);
    const generated = await snap(ap);
    assert.equal(Math.max(generated.width, generated.height), 100);
    assert.ok(generated.generationBase);
    await ap
      .getByLabel("作品名称", { exact: true })
      .fill("qa-public-A-雷电将军");
    await saved(ap);
    const pos = await ap
      .getByTestId("editor-canvas")
      .evaluate((e) => ({
        r: e.getBoundingClientRect().toJSON(),
        x: +e.dataset.gridX,
        y: +e.dataset.gridY,
        cell: +e.dataset.cellSize,
      }));
    const x = pos.r.x + pos.x + pos.cell * 0.5,
      y = pos.r.y + pos.y + pos.cell * 0.5;
    await ap.getByRole("button", { name: "画笔", exact: true }).click();
    await ap.mouse.click(x, y);
    await saved(ap);
    const drawn = await snap(ap);
    assert.notDeepEqual(cells(drawn), cells(generated));
    await ap.getByRole("button", { name: "橡皮", exact: true }).click();
    await ap.mouse.click(x, y);
    await saved(ap);
    assert.equal(cells(await snap(ap))[0], -1);
    await ap.getByRole("button", { name: "撤销", exact: true }).click();
    await saved(ap);
    assert.deepEqual(cells(await snap(ap)), cells(drawn));
    await ap.getByRole("button", { name: "重做", exact: true }).click();
    await saved(ap);
    mark("真实雷电原图上传、长边网格转换、画笔橡皮与撤销重做");
    current = await snap(ap);
    const save = await call(
      ap,
      "/works/" + current.id,
      { project: current, expectedUserId: au.id },
      "PUT",
    );
    assert.equal(save.status, 200);
    const isolation = await call(bp, "/works/" + current.id);
    assert.equal(isolation.status, 404);
    assert.equal(
      (
        await call(
          bp,
          "/works/" + current.id,
          { project: current, expectedUserId: au.id },
          "PUT",
        )
      ).status,
      412,
    );
    assert.equal((await call(bp, "/works")).works.length, 0);
    await ap.reload();
    await saved(ap);
    assert.deepEqual(cells(await snap(ap)), cells(current));
    mark("A/B服务端作品与UID隔离，越权读写拒绝，编辑草稿刷新一致");
    await ap.screenshot({
      path: path.join(out, "desktop.png"),
      fullPage: true,
    });
    await ap.getByRole("button", { name: "用豆清单", exact: true }).click();
    const list = ap.getByRole("dialog", { name: "用豆清单", exact: true });
    await list.waitFor();
    await ap.screenshot({
      path: path.join(out, "bead-list.png"),
      fullPage: true,
    });
    const csv = await downloaded(
      ap,
      () => list.getByRole("button", { name: "下载 CSV", exact: true }).click(),
      "bead-list.csv",
    );
    assert.ok(csv.toString("utf8").includes("MARD"));
    const images = await downloaded(
      ap,
      () =>
        list.getByRole("button", { name: "下载清单图片", exact: true }).click(),
      "bead-list-images.zip",
    );
    if (images[0] === 137) await png(ap, images);
    else {
      const parts = unzipSync(images);
      assert.ok(Object.keys(parts).some((n) => n.endsWith(".png")));
      for (const [name, data] of Object.entries(parts))
        if (name.endsWith(".png")) await png(ap, Buffer.from(data));
    }
    await ap.getByLabel("关闭弹窗", { exact: true }).click();
    mark("用豆清单CSV和清单图片实际收到并解码");
  } else {
    const previous = JSON.parse(
      fs.readFileSync(path.join(out, "browser-results.json")),
    );
    report.checks = previous.checks;
    report.downloads = previous.downloads;
    report.notes.push(
      "续测：前序已通过的注册、上传、编辑、隔离和清单不重复执行",
    );
    au = await login(ap, qa.a);
    bu = await login(bp, qa.b);
    await projectMenu(ap, "我的作品");
    const row = ap
      .locator(".cloud-works > div")
      .filter({ hasText: "qa-public-A-雷电将军" })
      .first();
    await row.getByRole("button", { name: "打开", exact: true }).click();
    await ap
      .getByRole("dialog", { name: "我的作品", exact: true })
      .waitFor({ state: "hidden" });
    await saved(ap);
    current = await snap(ap);
    assert.equal(current.name, "qa-public-A-雷电将军");
    mark("独立浏览器登录，从云作品真实打开雷电图纸与生成基准");
  }
  for (const kind of ["chart", "mosaic", "palette", "assembly", "sections"]) {
    const data = await exportKind(ap, kind);
    if (data[0] === 137)
      report.downloads.at(-1).dimensions = await png(ap, data);
    else {
      const files = unzipSync(data);
      assert.ok(Object.keys(files).some((n) => n.endsWith(".png")));
      for (const [name, part] of Object.entries(files))
        if (name.endsWith(".png")) await png(ap, Buffer.from(part));
    }
  }
  mark(
    "完整图纸、马赛克、色卡、物理拼板及分区实际下载解码，免次权限未消耗普通次数",
  );
  assert.equal((await me(ap)).user.freeCredits, 0);
  const project = await downloaded(
    ap,
    () => projectMenu(ap, "导出项目"),
    "raiden.bead.json",
  );
  assert.deepEqual(cells(JSON.parse(project.toString("utf8"))), cells(current));
  mark("可编辑项目文件实际下载，网格与当前编辑一致");
  // Verify product logout is local, and switching clears A before B content is restored.
  await ap.getByRole("button", { name: /账号：/ }).click();
  await ap.getByRole("button", { name: "退出当前拼豆", exact: true }).click();
  await saved(ap);
  assert.equal((await me(ap)).user, null);
  assert.notEqual((await snap(ap)).id, current.id);
  await login(ap, qa.b);
  assert.notEqual((await snap(ap)).id, current.id);
  assert.ok(!(await call(ap, "/works")).works.some((w) => w.id === current.id));
  mark("退出和切换公共账号清除旧界面/撤销/作品列表，未自动上传A草稿到B");
  // Ordinary quota: same external request, no duplicate charge; cancellation is idempotent.
  const startQuota = (await me(bp)).user.freeCredits,
    body = {
      requestKey: randomUUID(),
      fingerprint: "f".repeat(64),
      kind: "chart",
      expectedUserId: bu.id,
    };
  const rs = await Promise.all(
    Array.from({ length: 3 }, () => call(bp, "/exports/reserve", body)),
  );
  assert.ok(rs.every((r) => r.id === rs[0].id));
  assert.equal((await me(bp)).user.freeCredits, startQuota - 1);
  await Promise.all(
    Array.from({ length: 2 }, () =>
      call(bp, "/exports/" + rs[0].id + "/cancel", { expectedUserId: bu.id }),
    ),
  );
  assert.equal((await me(bp)).user.freeCredits, startQuota);
  mark("真实中心并发同号仅预占1次，重复取消仅返还1次");
  // A separately held task is left for service-key recovery after local logout.
  const held = await call(bp, "/exports/reserve", {
    ...body,
    requestKey: randomUUID(),
    fingerprint: "e".repeat(64),
  });
  await call(bp, "/logout", {});
  report.pendingLogoutJob = {
    id: held.id,
    expires: held.expires,
    startingQuota: startQuota,
  };
  mark("退出后待恢复任务已持久化，等待中心真实预占到期后核对");
  await login(ap, qa.a);
  await ssh("expire-a");
  await ap.waitForTimeout(3800);
  const expired = (await me(ap)).user;
  assert.equal(expired.status, "expired");
  assert.equal(expired.exportAccess, false);
  assert.equal(expired.freeCredits, 0);
  assert.equal(
    (
      await call(ap, "/exports/reserve", {
        ...body,
        requestKey: randomUUID(),
        fingerprint: "d".repeat(64),
        expectedUserId: expired.id,
      })
    ).status,
    403,
  );
  assert.equal((await call(ap, "/works/" + current.id)).status, 200);
  mark("仅QA账号按真实服务端3秒到期，会员降级/次数独立，账号和作品仍可访问");
  await ssh("grant-a");
  const center = await a.newPage();
  watch(center);
  await center.goto(
    "https://accounts.shizibandu.icu/?product=beadgrid&tab=security",
  );
  if (await center.getByRole("link", { name: /登录/ }).count())
    await center.getByRole("link", { name: /登录/ }).first().click();
  await center.waitForTimeout(1000);
  report.centerPath =
    new URL(center.url()).origin + new URL(center.url()).pathname;
  await center.screenshot({
    path: path.join(out, "public-center.png"),
    fullPage: true,
  });
  await center.close();
  await ap.getByRole("button", { name: /账号：/ }).click();
  await ap.screenshot({ path: path.join(out, "account.png"), fullPage: true });
  await ap.getByLabel("关闭弹窗", { exact: true }).click();
  await a.storageState({ path: path.join(priv, "a-session.json") });
  fs.chmodSync(path.join(priv, "a-session.json"), 0o600);
  await c.storageState({ path: path.join(priv, "b-session.json") });
  fs.chmodSync(path.join(priv, "b-session.json"), 0o600);
  report.accountA = { id: au.id, uid: au.uid, projectId: current.id };
  report.accountB = { id: bu.id, uid: bu.uid };
  assert.deepEqual(report.badRequests, []);
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack).replace(
    /([?&](?:code|state|nonce)=)[^&\s\"']+/g,
    "$1[redacted]",
  );
  console.error(report.error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(out, "browser-results.json"),
    JSON.stringify(report, null, 2),
  );
  await b.close();
}
