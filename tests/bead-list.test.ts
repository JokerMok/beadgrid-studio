import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildBeadList,
  listText,
  listCsv,
  listPages,
} from "../src/bead-list.ts";
import {
  blank,
  PALETTE,
  serialize,
  deserialize,
  encodeRle,
  cropProject,
} from "../src/model.ts";
import {
  MATERIAL_CATALOG,
  PURCHASE_NOTICE,
  supportedMaterial,
} from "../src/material-catalog.ts";

test("采购色号全部存在于固定来源仓库，保留原RGB快照", () => {
  const raw = fs.readFileSync(
    new URL(
      "./fixtures/material-catalog/mard-6e269260.csv",
      import.meta.url,
    ),
    "utf8",
  );
  const codes = new Set(
    raw
      .trim()
      .split(/\r?\n/)
      .map((l) => l.split(",")[0]),
  );
  assert(PALETTE.every((c) => codes.has(c.code)));
  assert.equal(PALETTE[0].hex, "#f9f4ca");
});
test("透明空格排除、逐色守恒、数值排序、备用量独立向上取整", () => {
  const p = blank(16, 16);
  p.cells.set([0, 0, 0, 9, 1, -1, 1]);
  const actual = buildBeadList(p),
    extra = buildBeadList(p, "quantity", 10);
  assert.equal(actual.total, 6);
  assert.equal(actual.empty, 250);
  assert.deepEqual(
    actual.rows.map((r) => r.code),
    ["A1", "A2", "A10"],
  );
  assert.deepEqual(
    extra.rows.map((r) => r.count),
    [3, 2, 1],
  );
  assert.deepEqual(
    extra.rows.map((r) => r.purchase),
    [4, 3, 2],
  );
  assert.equal(extra.total, 6);
  assert.equal(extra.purchaseTotal, 9);
  assert.equal(
    listPages(actual)
      .flatMap((p) => p.rows)
      .reduce((s, r) => s + r.count, 0),
    6,
  );
  p.cells.fill(-1);
  assert.equal(buildBeadList(p).total, 0);
  assert.deepEqual(listPages(buildBeadList(p)), []);
});
test("旧项目索引映射不变、旧尺寸不自动变成已核实采购规格", () => {
  const p = blank(16, 16);
  p.cells.set([0, 220, -1, 7]);
  const raw = serialize(p);
  delete (raw as any).paletteCodes;
  delete raw.settings.materialSpec;
  raw.settings.beadSize = 5;
  const restored = deserialize(raw);
  assert.deepEqual(restored.cells, p.cells);
  assert.equal(restored.settings.beadSize, 5);
  assert.equal(restored.settings.materialSpec, undefined);
  assert.equal(buildBeadList(restored).sizeMm, undefined);
  restored.settings.materialSpec = supportedMaterial();
  assert.equal(buildBeadList(restored).sizeMm, 2.6);
});
test("带稳定色号的重排文件按色号恢复，禁用与自选索引同步迁移", () => {
  const p = blank(16, 16);
  p.cells.set([0, 220, -1, 7]);
  const raw = serialize(p);
  raw.paletteCodes.reverse();
  raw.patternRle = encodeRle(p.cells.map((n) => (n < 0 ? -1 : 220 - n)));
  raw.settings = { ...raw.settings, disabled: [220], allowed: [0, 213] };
  const restored = deserialize(raw);
  assert.deepEqual(restored.cells, p.cells);
  assert.deepEqual(restored.settings.disabled, [0]);
  assert.deepEqual(restored.settings.allowed, [220, 7]);
  raw.paletteCodes[0] = "FAKE";
  assert.throws(() => deserialize(raw), /色号映射/);
});
test("清单文本、Excel CSV与分页共享实际用量并保留完整规格，CSV防公式", () => {
  const p = blank(16, 16);
  p.name = '=HYPERLINK("危险", "作品")\n换行';
  p.cells.set(PALETTE.map((_, i) => i));
  const list = buildBeadList(p, "quantity", 5),
    text = listText(list),
    csv = listCsv(list),
    pages = listPages(list);
  assert.equal(list.colorCount, 221);
  assert.equal(list.total, 221);
  assert.equal(pages.length, 6);
  assert.equal(pages.flatMap((p) => p.rows).length, 221);
  assert.equal(
    new Set(pages.flatMap((p) => p.rows.map((r) => r.code))).size,
    221,
  );
  assert(csv.startsWith("\ufeff"));
  assert(csv.includes('"\'=HYPERLINK(""危险"", ""作品"")\n换行"'));
  for (const r of list.rows) {
    assert(text.includes(`${r.code}\t${r.count}\t${r.purchase}`));
    assert(csv.includes(`"${r.code}","${r.count}","5","${r.purchase}"`));
  }
  for (const s of [
    MATERIAL_CATALOG.brand,
    MATERIAL_CATALOG.series,
    PURCHASE_NOTICE,
  ]) {
    assert(text.includes(s));
    assert(csv.includes(s));
  }
});
test("bamboo旧文件独立解码核对，不从预填汇总取值；裁剪统计随网格变化", () => {
  const file = new URL(
    "./fixtures/legacy-200x112.bead.json",
    import.meta.url,
  );
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const independent = new Map<string, number>();
  let empty = 0;
  for (let i = 0; i < raw.patternRle.length; i += 2) {
    const code = raw.patternRle[i];
    const count = raw.patternRle[i + 1];
    if (code < 0) empty += count;
    else {
      const key = PALETTE[code].code;
      independent.set(key, (independent.get(key) || 0) + count);
    }
  }
  const project = deserialize(raw),
    list = buildBeadList(project);
  assert.equal(independent.size, 96);
  assert.equal(
    [...independent.values()].reduce((s, n) => s + n, 0),
    22400,
  );
  assert.equal(list.colorCount, independent.size);
  assert.equal(
    list.total,
    [...independent.values()].reduce((s, n) => s + n, 0),
  );
  assert.equal(list.empty, empty);
  assert.deepEqual(
    new Map(list.rows.map((r) => [r.code, r.count])),
    independent,
  );
  assert.equal(list.sizeMm, undefined);
  assert.equal(
    buildBeadList(cropProject(project, { x: 0, y: 0, w: 16, h: 16 })).total,
    256,
  );
  assert.deepEqual(deserialize(serialize(project)).cells, project.cells);
});
