import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';

// A separate browser and fresh storage; never controls the user's open Chrome.
const root = path.resolve(import.meta.dirname, '..');
const runtime = JSON.parse(fs.readFileSync(path.join(root, '.local-public/runtime.json'), 'utf8'));
const url = runtime.publicUrl;
const origin = new URL(url).origin;
const out = path.join(root, 'verification/public-tunnel-20261018');
const downloads = path.join(out, 'downloads');
fs.mkdirSync(downloads, { recursive: true });
const input = process.env.TEST_IMAGE || process.argv[2];
if (!input) throw Error('请通过TEST_IMAGE或第一个参数提供竹林人物回归图片路径');
const palette = JSON.parse(fs.readFileSync(path.join(root, 'src/palette.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/legacy-200x112.bead.json'), 'utf8'));
function decode(project) {
  const cells = [];
  const counts = {};
  for (let i = 0; i < project.patternRle.length; i += 2) {
    const value = project.patternRle[i], count = project.patternRle[i + 1];
    assert(Number.isInteger(count) && count > 0);
    assert(value >= -1 && value < palette.length);
    const code = value === -1 ? null : (project.paletteCodes?.[value] ?? palette[value].code);
    for (let n = 0; n < count; n++) cells.push(code);
    if (code) counts[code] = (counts[code] ?? 0) + count;
  }
  assert.equal(cells.length, project.width * project.height);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { cells, counts, total, empty: cells.length - total, colors: Object.keys(counts).length };
}
const expected = decode(fixture);
const report = {
  date: new Date().toISOString(), url, version: runtime.version,
  input, inputSha256: crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),
  viewport: { width: 1440, height: 1000 },
  parameters: { width: 200, height: 112, fit: 'contain', limit: 221, removeLight: true, merge: false, edges: 0 },
  independentFixture: { total: expected.total, colors: expected.colors, empty: expected.empty },
  steps: [], requests: [], failedRequests: [], badResponses: [], pageErrors: [], consoleErrors: [],
};
const write = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
const mark = (step, details = {}) => { report.steps.push({ step, ...details }); write(); console.log(step, JSON.stringify(details)); };
const browser = await chromium.launch({ headless: true });
report.browser = browser.version();
const context = await browser.newContext({ viewport: report.viewport, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('request', r => { if (/^https?:/.test(r.url())) report.requests.push({ url: r.url(), method: r.method(), type: r.resourceType() }); });
page.on('requestfailed', r => report.failedRequests.push({ url: r.url(), failure: r.failure() }));
page.on('response', r => { if (r.status() >= 400) report.badResponses.push({ url: r.url(), status: r.status() }); });
page.on('pageerror', e => report.pageErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
async function download(button, filename) {
  const pending = page.waitForEvent('download', { timeout: 60000 });
  await button.click();
  const dl = await pending;
  assert.equal(await dl.failure(), null);
  const target = path.join(downloads, filename ?? dl.suggestedFilename());
  await dl.saveAs(target);
  assert(fs.statSync(target).size > 0);
  return { path: target, name: dl.suggestedFilename(), bytes: fs.statSync(target).size };
}
async function projectDownload(name) {
  const saved = await download(page.locator('.top-toolbar').getByRole('button', { name: '导出项目', exact: true }), name);
  return { saved, data: JSON.parse(fs.readFileSync(saved.path, 'utf8')) };
}
function csvRows(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if (c === '\n' && !quoted) { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}
function pngCheck(bytes) {
  const b = Buffer.from(bytes);
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let at = 8, width, height, depth, channels; const idat = [];
  while (at < b.length) {
    const n = b.readUInt32BE(at), type = b.toString('ascii', at + 4, at + 8), data = b.subarray(at + 8, at + 8 + n);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; channels = ({ 2: 3, 6: 4 })[data[9]]; }
    if (type === 'IDAT') idat.push(data);
    at += n + 12;
  }
  assert.equal(depth, 8); assert(channels);
  assert.equal(inflateSync(Buffer.concat(idat)).length, (width * channels + 1) * height);
  return { width, height, bytes: b.length };
}
try {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response.status(), 200);
  await page.getByText('已自动保存', { exact: true }).waitFor();
  mark('public-homepage-rendered');
  await page.getByTestId('image-input').setInputFiles(input);
  const dialog = page.getByRole('dialog', { name: '上传图片并设置板子' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: /^原图完整置入/ }).click();
  for (const [label, value] of [['导入宽度', '200'], ['导入高度', '112']]) {
    await dialog.getByLabel(label, { exact: true }).fill(value);
    await dialog.getByLabel(label, { exact: true }).press('Tab');
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.equal(await dialog.getByLabel(label, { exact: true }).inputValue(), value);
  }
  await dialog.getByLabel('导入最大颜色数').fill('221');
  for (const name of [/自动适配色卡/, /自动合并少量杂色/, /相似色号合并/]) {
    const cb = dialog.getByRole('checkbox', { name });
    if (await cb.count()) await cb.setChecked(false);
  }
  await dialog.getByRole('checkbox', { name: /仅移除白色\/浅色边缘/ }).setChecked(true);
  if (await dialog.getByRole('slider').count() > 1) await dialog.getByRole('slider').nth(1).fill('0');
  await page.screenshot({ path: path.join(out, 'public-upload.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: /生成拼豆图/ }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('alert').filter({ hasText: '图纸已生成' }).waitFor();
  await page.getByText('已自动保存', { exact: true }).waitFor();
  const close = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await close.count()) await close.click();
  const generated = await projectDownload('public-bamboo-200x112.bead.json');
  const actual = decode(generated.data);
  assert.equal(generated.data.width, 200); assert.equal(generated.data.height, 112);
  assert.equal(generated.data.settings.fit, 'contain'); assert.equal(generated.data.settings.limit, 221);
  assert.deepEqual(actual.cells, expected.cells);
  report.generated = { total: actual.total, colors: actual.colors, empty: actual.empty, counts: actual.counts, project: generated.saved };
  mark('uploaded-and-generated', { total: actual.total, colors: actual.colors, empty: actual.empty, fixtureCellDifferences: 0 });
  await page.screenshot({ path: path.join(out, 'public-workbench.png'), animations: 'disabled' });

  await page.getByRole('button', { name: '用豆清单', exact: true }).click();
  const list = page.getByRole('dialog', { name: '用豆清单' });
  await list.waitFor();
  assert.equal(await list.getByLabel('豆子尺寸', { exact: true }).inputValue(), '2.6');
  assert.equal(await list.getByLabel('备用量', { exact: true }).inputValue(), '0');
  const rows = await list.getByTestId('bead-list-table').locator('tbody tr').evaluateAll(elements => elements.map(e => ({ code: e.dataset.code, count: +e.dataset.count, purchase: +e.dataset.purchase })));
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.code, r.count])), actual.counts);
  assert(rows.every(r => r.count === r.purchase));
  report.listSummary = await list.getByTestId('bead-list-summary').innerText();
  await page.screenshot({ path: path.join(out, 'public-bead-list.png'), animations: 'disabled' });
  const csv = await download(list.getByRole('button', { name: '下载 CSV', exact: true }), 'public-bamboo-list.csv');
  const csvBytes = fs.readFileSync(csv.path); assert.equal(csvBytes.subarray(0, 3).toString('hex'), 'efbbbf');
  const parsed = csvRows(csvBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const header = parsed.shift();
  const column = name => header.indexOf(name);
  const csvCounts = Object.fromEntries(parsed.map(r => [r[column('色号')], +r[column('实际所需(颗)')]]));
  assert.deepEqual(csvCounts, actual.counts);
  assert(parsed.every(r => +r[column('实际总用量(颗)')] === actual.total && +r[column('豆子尺寸(mm)')] === 2.6 && +r[column('空格数')] === actual.empty));
  report.csv = { ...csv, rows: parsed.length, utf8Bom: true, matchesGridAndPage: true };
  mark('csv-actually-downloaded', { rows: parsed.length, bytes: csv.bytes });
  const images = await download(list.getByRole('button', { name: '下载清单图片', exact: true }), 'public-bamboo-list.zip');
  const zip = unzipSync(fs.readFileSync(images.path));
  const manifest = JSON.parse(strFromU8(zip['清单数据.json']));
  assert.deepEqual(manifest.rows.map(r => ({ code: r.code, count: r.count, purchase: r.purchase })), rows);
  assert.equal(manifest.total, actual.total); assert.equal(manifest.empty, actual.empty); assert.equal(manifest.sizeMm, 2.6);
  const pngs = Object.entries(zip).filter(([name]) => name.endsWith('.png'));
  assert.equal(pngs.length, Math.ceil(actual.colors / 40));
  report.images = { ...images, matchesGridPageAndCsv: true, pages: pngs.map(([name, bytes]) => {
    const info = pngCheck(bytes); assert.equal(info.width, 1240); assert.equal(info.height, 1900);
    const target = path.join(downloads, name); fs.writeFileSync(target, bytes); return { name, path: target, ...info };
  }) };
  assert(strFromU8(zip['清单说明.txt']).includes(`实际需用${actual.total}颗`));
  mark('list-images-actually-downloaded', { pages: pngs.length, dimensions: '1240×1900', manifestMatches: true });
  await list.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已自动保存', { exact: true }).waitFor();
  const reloaded = await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(reloaded.status(), 200);
  await page.getByText('已自动保存', { exact: true }).waitFor();
  const restored = await projectDownload('public-bamboo-restored.bead.json');
  assert.deepEqual(restored.data.patternRle, generated.data.patternRle);
  assert.deepEqual(restored.data.paletteCodes, generated.data.paletteCodes);
  assert.deepEqual(restored.data.settings.materialSpec, generated.data.settings.materialSpec);
  assert.equal(restored.data.name, generated.data.name);
  mark('saved-and-refresh-restored', { exactGridAndSpecification: true });
  // Same public origin API calls executed inside the real page.
  report.api = await page.evaluate(async () => Promise.all(['/api/health', '/api/me'].map(async route => {
    const res = await fetch(route); return { route, url: res.url, status: res.status, body: await res.json() };
  })));
  assert(report.api.every(r => r.status === 200 && new URL(r.url).origin === origin));
  const external = report.requests.filter(r => new URL(r.url).origin !== origin);
  assert.deepEqual(external, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.badResponses, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.testAccountRequired = false;
  report.status = 'passed';
  mark('public-origin-network-passed', { requests: report.requests.length, localhostRequests: 0, apiErrors: 0, consoleErrors: 0 });
} catch (error) {
  report.status = 'failed'; report.failure = error.stack; process.exitCode = 1;
  console.error(error);
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
} finally { write(); await browser.close(); }
