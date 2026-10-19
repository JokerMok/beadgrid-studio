/// <reference lib="webworker" />
import { type Settings } from "./model";
import type { Raster } from "./prepare-image";
import {
  sampleCells,
  matchSamples,
  mergeRare,
  enhanceEdges,
  simplify,
} from "./conversion-core";
import { sampleSmallCells, cleanSmallPattern } from "./small-pattern";
import { recognizeBlocks } from "./reference-recognition";
import { mergeSimilar, similarGroups } from "./conversion-core";
const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = ({
  data,
}: {
  data: { raster: Raster; settings: Settings; trace?: boolean };
}) => {
  try {
    const { raster, settings: s } = data,
      w = s.width,
      h = s.height,
      small = s.smallCleanup && s.mode !== "simple" && Math.max(w, h) <= 104;
    const progress = (n: number) => ctx.postMessage({ progress: n });
    if (!raster?.pixels) throw Error("缺少已解码的图片像素");
    if (s.mode === "recognize") {
      const cells = recognizeBlocks(raster.pixels, w, h, s.skipCheckerboard);
      ctx.postMessage({ progress: 100, cells }, [cells.buffer]);
      return;
    }
    const samples = small
        ? sampleSmallCells(raster.pixels, w, h)
        : sampleCells(raster.pixels, w, h, raster.size),
      matched = matchSamples(samples, w, h, s, progress);
    let cells = matched.cells;
    if (s.mode === "simple") cells = simplify(cells, w, h);
    else if (small) cells = cleanSmallPattern(cells, w, h);
    if (s.merge && s.mode !== "simple") cells = mergeRare(cells, w, h);
    if (s.edges > 0 && s.mode !== "simple")
      cells = enhanceEdges(cells, w, h, s.edges);
    if (s.similar) cells = mergeSimilar(cells, similarGroups(cells, 90));
    ctx.postMessage(
      {
        progress: 100,
        cells,
        ...(data.trace
          ? {
              samples,
              mask: matched.mask,
              initial: matched.initial,
              chosen: matched.chosen,
            }
          : {}),
      },
      [cells.buffer],
    );
  } catch (e) {
    ctx.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
