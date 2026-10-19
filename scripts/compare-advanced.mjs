import { chromium } from "playwright";
import fs from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
const bundle = fs.readFileSync(
    "verification/v1.1-reference/source-main.js",
    "utf8",
  ),
  ast = ts.createSourceFile(
    "ref.js",
    bundle,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  ),
  get = (n) =>
    ast.statements
      .find((s) => ts.isFunctionDeclaration(s) && s.name?.text === n)
      .getText(ast),
  recognition = fs.readFileSync(
    "verification/v1.1-reference/reference-recognition.js",
    "utf8",
  ),
  ra = ts.createSourceFile(
    "r.js",
    recognition,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  ),
  choose = ra.statements
    .find(
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === "chooseBlockColor",
    )
    .getText(ra)
    .replace("export ", ""),
  detection = fs
    .readFileSync("verification/v1.1-reference/reference-detection.js", "utf8")
    .split("// Match the exact square-cell")[0]
    .replaceAll("export ", ""),
  small = fs
    .readFileSync("verification/v1.1-reference/small-pattern.js", "utf8")
    .replaceAll("export ", "");
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://127.0.0.1:5173");
await page.getByText("已自动保存", { exact: true }).waitFor();
const results = await page.evaluate(
  async ({ choose, detection, small, adjust }) => {
    const { PALETTE, defaults } = await import("/src/model.ts"),
      { chooseBlockColor, recognizeBlocks } =
        await import("/src/reference-recognition.ts"),
      { detectReferenceGrid } = await import("/src/reference-detection.ts"),
      { outlineMask } = await import("/src/small-pattern.ts"),
      { adjustPattern } = await import("/src/conversion-core.ts"),
      referenceChoose = new Function(`${choose};return chooseBlockColor`)(),
      refDetect = new Function(`${detection};return detectReferenceGrid`)(),
      refMask = new Function(`${small};return detectOutlineMask`)(),
      Ts = PALETTE.map((c) =>
        [1, 3, 5].map((p) => parseInt(c.hex.slice(p, p + 2), 16)),
      ),
      referenceAdjust = new Function(
        "Ts",
        `const P2={brightness:0,contrast:0,saturation:0,sharpness:0,exposure:0},F0=(v,a=-100,b=100)=>Math.max(a,Math.min(b,Number(v)||0)),jo=n=>Math.max(0,Math.min(255,Math.round(n)));${adjust};return Zh`,
      )(Ts);
    const checks = [];
    let state = 81;
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    let blockDiff = 0;
    for (let t = 0; t < 50; t++) {
      const data = new Uint8ClampedArray(7 * 7 * 4);
      for (let i = 0; i < 49; i++) {
        const c = Ts[(t + (i % 3) * 35) % 221];
        data.set(
          [
            c[0] + Math.round(rand() * 20),
            c[1],
            c[2],
            i % 11 === 0 ? 11 : Math.round(rand() * 255),
          ],
          i * 4,
        );
      }
      for (const skip of [false, true])
        if (
          JSON.stringify(chooseBlockColor(data, 0, 7, skip)) !==
          JSON.stringify(referenceChoose(data, 0, 7, skip))
        )
          blockDiff++;
    }
    checks.push({
      scope: "7x7 dominant block selection, alpha and checkerboard rules",
      differentBlocks: blockDiff,
    });
    const pattern = Int16Array.from({ length: 32 * 32 }, (_, i) =>
      i % 19 === 0 ? -1 : Math.floor(rand() * 221),
    );
    let maskDiff = 0;
    for (const darkThreshold of [45, 75, 100, 145]) {
      const a = outlineMask(pattern, 32, 32, darkThreshold),
        b = refMask(Array.from(pattern), 32, 32, PALETTE, { darkThreshold });
      maskDiff += a.filter((v, i) => v !== b[i]).length;
    }
    checks.push({
      scope: "Outline mask, border flood and dark threshold",
      differentCells: maskDiff,
    });
    let adjustmentDiff = 0;
    for (const values of [
      {},
      { brightness: 15 },
      { contrast: 32, saturation: -18 },
      { exposure: -22, sharpen: 48 },
      {
        brightness: 31,
        contrast: -34,
        saturation: 40,
        exposure: 16,
        sharpen: 78,
      },
    ]) {
      const s = { ...defaults(32, 32), ...values },
        a = adjustPattern(pattern, 32, 32, s),
        b = referenceAdjust(Array.from(pattern), 32, 32, {
          ...s,
          sharpness: s.sharpen,
        });
      adjustmentDiff += a.filter((v, i) => v !== b[i]).length;
    }
    checks.push({
      scope: "Separate current-grid adjustments including neutral identity",
      differentCells: adjustmentDiff,
    });
    const gridInputs = [];
    const native = new ImageData(32, 32);
    gridInputs.push(native);
    const printed = new ImageData(500, 500);
    for (let y = 0; y < 500; y++)
      for (let x = 0; x < 500; x++) {
        const i = (y * 500 + x) * 4,
          major = x % 50 === 0 || y % 50 === 0,
          c = major
            ? [41, 168, 143]
            : x % 10 === 0 || y % 10 === 0
              ? [220, 220, 220]
              : Ts[(Math.floor(x / 10) + Math.floor(y / 10)) % 221];
        printed.data.set([...c, 255], i);
      }
    gridInputs.push(printed);
    const alignment = gridInputs.map((p) => {
      const a = detectReferenceGrid(p),
        b = refDetect(p);
      return {
        size: [p.width, p.height],
        method: a.method,
        equal: JSON.stringify(a) === JSON.stringify(b),
      };
    });
    checks.push({
      scope: "Native pixel and printed five-cell-line calibration",
      alignment,
    });
    return checks;
  },
  {
    choose,
    detection,
    small,
    adjust: [get("Hh"), get("Sh"), get("Zh")].join("\n"),
  },
);
await browser.close();
fs.writeFileSync(
  "verification/v1.1-comparison/advanced-parity.json",
  JSON.stringify(
    {
      method:
        "Public pure algorithm helpers evaluated in the same Chromium; original account and application gates not executed.",
      results,
    },
    null,
    2,
  ),
);
console.log(results);
assert(
  results.every(
    (r) =>
      (r.differentBlocks ?? r.differentCells ?? 0) === 0 &&
      (!r.alignment || r.alignment.every((a) => a.equal)),
  ),
);
