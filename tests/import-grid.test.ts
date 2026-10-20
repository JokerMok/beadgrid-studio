import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults, serialize, deserialize, blank } from "../src/model.ts";
import {
  gridFromLongEdge,
  gridFromAxis,
  selectedRatio,
  outputCoverage,
  sourceOutputCoverage,
} from "../src/import-grid.ts";
test("密度快捷档和滑块始终按长边，精确输入仍覆盖16–1000", () => {
  for (const ratio of [1.5, 0.67, 1, 8, 0.1])
    for (const edge of [16, 100, 150, 200, 300, 400, 777, 1000]) {
      const grid = gridFromLongEdge(edge, ratio);
      assert.equal(Math.max(grid.width, grid.height), edge);
      assert.ok(
        grid.width >= 16 &&
          grid.height >= 16 &&
          grid.width <= 1000 &&
          grid.height <= 1000,
      );
    }
  assert.deepEqual(gridFromLongEdge(200, 1.5), { width: 200, height: 133 });
  assert.deepEqual(gridFromLongEdge(200, 2 / 3), { width: 133, height: 200 });
  assert.deepEqual(gridFromAxis("height", 300, 2 / 3), {
    width: 200,
    height: 300,
  });
});
test("取景比例不按透明边界裁切，完整原图与自定义填满的范围分开", () => {
  const s = defaults(200, 200),
    dimensions = { w: 1604, h: 1494 };
  assert.equal(
    selectedRatio(dimensions, { ...s, fit: "contain" }),
    1604 / 1494,
  );
  assert.equal(
    selectedRatio(dimensions, {
      ...s,
      crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.25 },
    }),
    (1604 * 0.5) / (1494 * 0.25),
  );
  assert.deepEqual(outputCoverage(2, 1), { w: 0.5, h: 1 });
  assert.deepEqual(outputCoverage(0.5, 1), { w: 1, h: 0.5 });
});
test("新增网格模式和铺放参数可保存，旧项目不静默改变铺白含义", () => {
  const p = blank(100, 150);
  p.settings = {
    ...p.settings,
    gridSizing: "source",
    placement: "cover",
    padding: "empty",
  };
  const raw = serialize(p);
  assert.deepEqual(deserialize(raw).settings, p.settings);
  delete raw.settings.gridSizing;
  delete raw.settings.placement;
  delete raw.settings.padding;
  raw.settings.alpha = "white";
  const legacy = deserialize(raw);
  assert.equal(legacy.settings.alpha, "white");
  assert.equal(legacy.settings.padding, undefined);
});

test("实际输出范围包含高级构图缩放和偏移，不误标完整保留", () => {
  const s = {
    ...defaults(200, 200),
    fit: "contain" as const,
    placement: "contain" as const,
  };
  assert.deepEqual(sourceOutputCoverage(s, 2), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(sourceOutputCoverage({ ...s, placement: "cover" }, 2), {
    x: 0.25,
    y: 0,
    w: 0.5,
    h: 1,
  });
  assert.deepEqual(sourceOutputCoverage({ ...s, zoom: 2 }, 1), {
    x: 0.25,
    y: 0.25,
    w: 0.5,
    h: 0.5,
  });
});
