import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const dir = "verification/v1.1-comparison",
  reference = fs.readFileSync(
    "verification/v1.1-reference/functions.js",
    "utf8",
  ),
  small = fs
    .readFileSync("verification/v1.1-reference/small-pattern.js", "utf8")
    .replace(/export /g, ""),
  palette = JSON.parse(fs.readFileSync("src/palette.json", "utf8"));
const oracle = `const Se=${JSON.stringify(palette)},rm=Se.map(c=>({r:parseInt(c.hex.slice(1,3),16),g:parseInt(c.hex.slice(3,5),16),b:parseInt(c.hex.slice(5,7),16)})),hm=Se.map((_,i)=>i).filter(i=>Math.min(rm[i].r,rm[i].g,rm[i].b)>=245);const io=url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url});const xdRememberSource=p=>p,xdRememberGeneration=p=>p;${small}\nconst xdIsSmallBoard=isSmallBoard,xdSampleSmallImage=sampleSmallImage,xdCleanSmallPattern=cleanSmallPattern;${reference}\nreturn {run:I1,sample:xdSampleBeadCells,load:io,mask:gm};`;
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://127.0.0.1:5173/");
await page.getByText("已自动保存", { exact: true }).waitFor();
const generated = await page.evaluate(() => {
  const out = {};
  for (const name of ["alpha-white-boundaries", "large-no-resample"]) {
    const c = document.createElement("canvas");
    c.width = name === "large-no-resample" ? 2601 : 63;
    c.height = name === "large-no-resample" ? 37 : 45;
    const g = c.getContext("2d"),
      image = g.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4,
          border = x < 4 || y < 4 || x >= c.width - 4 || y >= c.height - 4;
        if (border) image.data.set([245, 245, 245, 255], i);
        else {
          const value = [234, 235, 244, 245, 254, 255][x % 6],
            alpha = [0, 11, 12, 23, 24, 25, 64, 128, 254, 255][y % 10];
          image.data.set(
            [
              value,
              (x + y) % 3 ? value : (x * 71) % 255,
              (x + y) % 5 ? value : (y * 41) % 255,
              alpha,
            ],
            i,
          );
        }
      }
    g.putImageData(image, 0, 0);
    out[name] = c.toDataURL();
  }
  return out;
});
const results = [];
const fixtures = [
  "solid-blocks",
  "wide-contain",
  "portrait-contain",
  "transparent-edge",
  "gradient",
  "thin-lines",
  "synthetic-illustration",
  "alpha-white-boundaries",
  "large-no-resample",
];
try {
  for (const name of fixtures) {
    const source =
      generated[name] ??
      "data:image/png;base64," +
        fs.readFileSync(`tests/fixtures/${name}.png`).toString("base64");
    for (const limit of [8, 221])
      for (const mode of [
        "normal",
        ...(name === "synthetic-illustration"
          ? ["merge", "edge30", "edge82", "small", "simple"]
          : []),
      ]) {
        const width = name === "synthetic-illustration" ? 32 : 24,
          height = name === "gradient" ? 16 : width,
          settings = {
            width,
            height,
            beadSize: 5,
            smallCleanup: mode === "small",
            limit,
            fit: "contain",
            crop: { x: 0, y: 0, w: 1, h: 1 },
            zoom: 1,
            panX: 0,
            panY: 0,
            removeLight: true,
            alpha: "keep",
            merge: mode === "merge" ? 1 : 0,
            edges: mode === "edge30" ? 30 : mode === "edge82" ? 82 : 0,
            brightness: 0,
            contrast: 0,
            saturation: 0,
            sharpen: 0,
            exposure: 0,
            mode: mode === "simple" ? "simple" : "normal",
            alignX: 0,
            alignY: 0,
            allowed: [],
            disabled: [],
          };
        const comparison = await page.evaluate(
          async ({ oracle, source, settings }) => {
            const ref = new Function(oracle)(),
              image = await ref.load(source),
              refSamples = ref.sample(image, settings.width, settings.height);
            const expected = await ref.run(
              source,
              settings.width,
              settings.height,
              settings.limit,
              {
                removeLightBackground: settings.removeLight,
                mergeRareColors: !!settings.merge,
                edgeStrength: settings.edges,
                simplePattern: settings.mode === "simple",
                smallPatternCleanup: settings.smallCleanup,
              },
            );
            const { readImage } = await import("/src/storage.ts");
            const raw = await (await fetch(source)).blob(),
              retained = await readImage(
                new File([raw], "same-input.png", { type: "image/png" }),
              );
            if (retained !== source)
              throw Error("Original upload bytes were changed");
            const { prepareRaster } = await import("/src/prepare-image.ts");
            const raster = await prepareRaster(source, settings);
            const actual = await new Promise((resolve, reject) => {
              const w = new Worker("/src/convert.worker.ts", {
                type: "module",
              });
              w.onmessage = (e) => {
                if (e.data.error) {
                  reject(Error(e.data.error));
                  w.terminate();
                } else if (e.data.cells) {
                  resolve(e.data);
                  w.terminate();
                }
              };
              w.onerror = (e) => reject(Error(e.message));
              w.postMessage({ raster, settings, trace: true });
            });
            const got = Array.from(actual.cells),
              diff = got.flatMap((v, i) =>
                v !== expected[i]
                  ? [{ index: i, ref: expected[i], local: v }]
                  : [],
              ),
              sampleDiff = Array.from(actual.samples).flatMap((v, i) =>
                v !== refSamples[i]
                  ? [{ index: i, ref: refSamples[i], local: v }]
                  : [],
              );
            const count = (a) => {
              const out = {};
              for (const c of a) if (c >= 0) out[c] = (out[c] || 0) + 1;
              return out;
            };
            return {
              cells: got,
              expected,
              differences: diff.length,
              first: diff.slice(0, 8),
              sampleDifferences: settings.smallCleanup
                ? null
                : sampleDiff.length,
              sampleFirst: settings.smallCleanup ? [] : sampleDiff.slice(0, 8),
              maskDifferences: got.filter(
                (v, i) => (v === -1) !== (expected[i] === -1),
              ).length,
              refCounts: count(expected),
              localCounts: count(got),
            };
          },
          { oracle, source, settings },
        );
        const { cells, expected, ...summary } = comparison;
        results.push({
          name,
          limit,
          mode,
          width,
          height,
          ...summary,
          hash: crypto
            .createHash("sha256")
            .update(JSON.stringify(cells))
            .digest("hex"),
        });
        console.log(
          name,
          limit,
          mode,
          "grid diffs",
          summary.differences,
          "sample diffs",
          summary.sampleDifferences,
        );
      }
  }
  const failed = results.filter((r) => r.differences || r.sampleDifferences);
  fs.writeFileSync(
    dir + "/conversion-parity.json",
    JSON.stringify(
      {
        method:
          "Same Chromium, same input bytes: public pure conversion functions and local HTMLImage/HTMLCanvas preparation plus Worker sampling/matching. No original app account/access code executed.",
        results,
        status: failed.length ? "failed" : "passed",
      },
      null,
      2,
    ),
  );
  assert.equal(failed.length, 0, JSON.stringify(failed.slice(0, 2)));
} finally {
  await browser.close();
}
