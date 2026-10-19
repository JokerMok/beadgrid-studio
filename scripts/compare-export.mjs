import { chromium } from "playwright";
import fs from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
const bundle = fs.readFileSync(
  "verification/v1.1-reference/source-main.js",
  "utf8",
);
const ast = ts.createSourceFile(
  "reference.js",
  bundle,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const pick = (name) => {
  const node = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
  );
  if (!node) throw Error("Missing pure helper " + name);
  return node.getText(ast);
};
const clear = fs.readFileSync(
    "verification/v1.1-reference/clear-export.js",
    "utf8",
  ),
  clearAST = ts.createSourceFile(
    "clear.js",
    clear,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  ),
  plan = clearAST.statements
    .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "printLayout")
    .getText(clearAST)
    .replace("export ", ""),
  painter = fs.readFileSync("verification/v1.1-reference/o5.js", "utf8"),
  typography = fs
    .readFileSync("verification/v1.1-reference/export-typography.js", "utf8")
    .replace("export function codeFont", "function xdExportCodeFont");
const oracle = `const Se=palette;${plan};const Fs=printLayout;${pick("Xh")};${typography};${painter};${pick("xdLegendLayout")};${pick("xdExportLegend")};return {layout:Fs,draw:o5,legend:xdExportLegend};`;
const b = await chromium.launch({ headless: true }),
  page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://127.0.0.1:5173");
await page.getByText("已自动保存", { exact: true }).waitFor();
const result = await page.evaluate(async (oracle) => {
  const { blank, PALETTE, usage } = await import("/src/model.ts"),
    { chartLayout } = await import("/src/export-layout.ts"),
    ref = new Function("palette", oracle)(PALETTE),
    plans = [
      [32, 32, 8],
      [52, 52, 1],
      [500, 279, 114],
      [1000, 1000, 221],
    ].map(([w, h, n]) => {
      const a = ref.layout(w, h, n),
        b = chartLayout(w, h, n);
      return {
        input: [w, h, n],
        source: { ...a, tier: a.tier.label },
        local: b,
        equal:
          JSON.stringify({ ...a, tier: a.tier.label }) === JSON.stringify(b),
      };
    }),
    p = blank(32, 32);
  p.name = "同输入图纸对照";
  const colors = [0, 57, 59, 63, 134, 141, 170, 177];
  for (let y = 1; y < 30; y++)
    for (let x = 2; x < 30; x++)
      p.cells[y * 32 + x] = colors[(Math.floor(x / 5) + Math.floor(y / 5)) % 8];
  const counts = new Array(221).fill(0);
  for (const c of p.cells) if (c >= 0) counts[c]++;
  const tests = [];
  for (const custom of [false, true, "palette"]) {
    if (custom === true)
      p.grid = {
        ...p.grid,
        color: "#bada55",
        majorColor: "#bb33dd",
        blockColor: "#0044ff",
      };
    const expected =
      custom === "palette"
        ? ref.legend(counts, p.name, "中（推荐）").canvas
        : ref.draw(
            Array.from(p.cells),
            p.width,
            p.height,
            counts,
            p.name,
            "中（推荐）",
            {
              fine: p.grid.color,
              major: p.grid.majorColor,
              block: p.grid.blockColor,
            },
          ).canvas;
    let bytes = await new Promise((resolve, reject) => {
      const w = new Worker("/src/export.worker.ts", { type: "module" });
      w.onmessage = (e) => {
        if (e.data.error) {
          w.terminate();
          reject(Error(e.data.error));
        }
        if (e.data.done) {
          w.terminate();
          resolve(e.data.bytes);
        }
      };
      w.onerror = (e) => reject(Error(e.message));
      w.postMessage({
        project: p,
        options: {
          kind: custom === "palette" ? "palette" : "chart",
          cell: 0,
          mirror: false,
          board: 52,
        },
      });
    });
    if (custom === "palette") {
      const { unzipSync } = await import("/node_modules/fflate/esm/browser.js");
      const files = unzipSync(bytes);
      bytes = Object.entries(files).find(([n]) => n.endsWith(".png"))[1];
    }
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    await img.decode();
    const actual = document.createElement("canvas");
    actual.width = img.width;
    actual.height = img.height;
    actual.getContext("2d").drawImage(img, 0, 0);
    const a = expected
        .getContext("2d")
        .getImageData(0, 0, expected.width, expected.height).data,
      b = actual
        .getContext("2d")
        .getImageData(0, 0, actual.width, actual.height).data;
    let differences = 0,
      first = [];
    for (let i = 0; i < a.length; i++)
      if (a[i] !== b[i]) {
        differences++;
        if (first.length < 12)
          first.push({
            x: Math.floor(i / 4) % expected.width,
            y: Math.floor(i / 4 / expected.width),
            channel: i % 4,
            source: a[i],
            local: b[i],
          });
      }
    tests.push({
      customGrid: custom,
      width: img.width,
      height: img.height,
      differentBytes: differences,
      first,
      sourcePng: expected.toDataURL(),
      localPng: actual.toDataURL(),
    });
    URL.revokeObjectURL(img.src);
  }
  return { plans, tests };
}, oracle);
for (const t of result.tests) {
  const label =
    t.customGrid === "palette"
      ? "palette"
      : t.customGrid
        ? "custom"
        : "default";
  for (const who of ["source", "local"]) {
    fs.writeFileSync(
      `verification/v1.1-comparison/${who}-chart-${label}.png`,
      Buffer.from(t[who + "Png"].split(",")[1], "base64"),
    );
    delete t[who + "Png"];
  }
}
fs.writeFileSync(
  "verification/v1.1-comparison/export-parity.json",
  JSON.stringify(
    {
      method:
        "Public pure chart layout/painter evaluated locally in the same Chromium, compared to decoded PNG from local streaming Worker. No original authentication or export gate executed. This is code-output comparison, not an original signed-in download.",
      ...result,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(result, null, 2));
await b.close();
assert(result.plans.every((p) => p.equal));
assert(result.tests.every((t) => t.differentBytes === 0));
