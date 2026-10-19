import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PALETTE,
  blank,
  serialize,
  deserialize,
  usage,
  transform,
  connected,
  cropProject,
  remapDisabled,
} from "../src/model.ts";
test("固定221色色卡与项目数据校验", () => {
  assert.equal(PALETTE.length, 221);
  assert.equal(new Set(PALETTE.map((c) => c.code)).size, 221);
  assert.equal(PALETTE[0].hex, "#f9f4ca");
  const p = blank(16, 20);
  p.cells[0] = 0;
  p.cells[31] = 220;
  const raw = serialize(p),
    restored = deserialize(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(restored.cells, p.cells);
  assert.deepEqual(restored.settings, p.settings);
  assert.throws(() => deserialize({ ...raw, paletteVersion: "other" }));
  assert.throws(() => deserialize({ ...raw, patternRle: [0, 321] }));
  assert.throws(() => deserialize({ ...raw, patternRle: [221, 320] }));
  assert.throws(() => deserialize({ ...raw, patternRle: [0, -1] }));
});
test("矩形旋转、翻转与裁剪保持格子、空格和用量语义", () => {
  const p = blank(17, 20);
  p.cells[0] = 5;
  p.cells[18] = 7;
  p.cells[339] = 9;
  let rotated = p;
  for (let i = 0; i < 4; i++) rotated = transform(rotated, "rotate");
  assert.deepEqual(rotated.cells, p.cells);
  for (const k of ["flipX", "flipY"] as const)
    assert.deepEqual(transform(transform(p, k), k).cells, p.cells);
  assert.deepEqual(usage(transform(p, "rotate").cells), usage(p.cells));
  const crop = cropProject(p, { x: 0, y: 0, w: 16, h: 16 });
  assert.equal(
    usage(crop.cells).reduce((a, b) => a + b[1], 0),
    2,
  );
});
test("连通填充只有四邻接；禁色重映射不影响空格与数量", () => {
  const p = blank(16, 16);
  p.cells[0] = 0;
  p.cells[17] = 0;
  p.cells[18] = 1;
  assert.deepEqual([...connected(p.cells, 16, 16, 0)], [0]);
  p.settings.disabled = [0];
  const r = remapDisabled(p);
  assert(!r.cells.includes(0));
  assert.equal(r.cells[19], -1);
  assert.equal(
    usage(r.cells).reduce((a, b) => a + b[1], 0),
    3,
  );
  p.settings.allowed = [0];
  assert.throws(() => remapDisabled(p));
});

test("读取项目保留原更新时间，缺失和非法时间稳定地排在末尾", () => {
  const raw = serialize(blank(16, 16));
  raw.updatedAt = 1700000000123;
  for (let i = 0; i < 3; i++)
    assert.equal(deserialize(raw).updatedAt, raw.updatedAt);
  for (const updatedAt of [
    undefined,
    null,
    "1700000000123",
    -1,
    NaN,
    Infinity,
    8.65e15,
  ])
    assert.equal(deserialize({ ...raw, updatedAt }).updatedAt, 0);
});
