import {test} from "node:test";
import assert from "node:assert/strict";
import {blank,serialize,deserialize,captureGeneration,restoreGeneration,hasManualEdits,transform,cropProject} from "../src/model.ts";
test("生成基准/候选版本经项目文件恢复，旧文件不伪造；旋转裁剪保持候选一致", () => {
  const p = blank(16, 20);
  p.cells[10] = 3;
  p.generationBase = captureGeneration(p);
  p.variants = {
    active: "normal",
    normal: p.cells.slice(),
    handmade: p.cells.slice(),
  };
  p.cells = p.cells.slice();
  p.cells[11] = 4;
  assert.ok(hasManualEdits(p));
  const read = deserialize(serialize(p));
  assert.deepEqual(read.cells, p.cells);
  assert.deepEqual(restoreGeneration(read).cells, p.generationBase.cells);
  assert.equal(restoreGeneration(read).view, "beads");
  const old = serialize(p);
  delete old.generationBase;
  assert.equal(deserialize(old).generationBase, undefined);
  assert.throws(() => restoreGeneration(deserialize(old)));
  const rotated = transform(p, "rotate");
  assert.equal(rotated.variants!.normal.length, 320);
  assert.deepEqual(
    rotated.variants!.normal,
    transform({ ...p, cells: p.variants.normal, variants: undefined }, "rotate")
      .cells,
  );
  const cropped = cropProject(p, { x: 0, y: 0, w: 16, h: 16 });
  assert.equal(cropped.variants!.handmade.length, 256);
});

test("区域禁色随旋转/裁剪/稳定色号序列化迁移，未命中区域不变", async () => {
  const { applyColorRules, colorAllowed } =
    await import("../src/color-rules.ts");
  const p = blank(20, 16);
  p.cells.fill(0);
  p.colorRules = [{ indices: [0, 1, 21], colors: [0] }];
  const out = applyColorRules(p);
  assert.notEqual(out.cells[0], 0);
  assert.equal(out.cells[2], 0);
  assert.equal(colorAllowed(p, 0, 0), false);
  assert.equal(colorAllowed(p, 2, 0), true);
  assert.deepEqual(deserialize(serialize(p)).colorRules, p.colorRules);
  const t = transform(p, "rotate");
  assert.equal(t.colorRules![0].indices.length, 3);
  assert.ok(
    t.colorRules![0].indices.every((i) => i >= 0 && i < t.cells.length),
  );
  const c = cropProject(p, { x: 1, y: 0, w: 16, h: 16 });
  assert.deepEqual(c.colorRules![0].indices, [0, 16]);
});

test("实验性边缘背景清理保留不连通的同色内部区域，透明格不被当作背景豆色", async () => {
  const { dominantBackgroundMask } = await import("../src/background-core.ts");
  const w = 48,
    h = 48,
    pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4,
        frame = x < 8 || x > 39 || y < 8 || y > 39,
        hole = x > 20 && x < 28 && y > 20 && y < 28;
      pixels.set(frame || hole ? [245, 245, 245, 255] : [40, 30, 100, 255], p);
    }
  const mask = dominantBackgroundMask(pixels, w, h);
  assert.equal(mask[0], 1);
  assert.equal(mask[24 * w + 24], 0);
  assert.equal(mask[12 * w + 12], 0);
  pixels[3] = 0;
  assert.equal(dominantBackgroundMask(pixels, w, h)[0], 0);
});
