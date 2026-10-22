/// <reference lib="webworker" />
import { dominantBackgroundMask } from "./background-core";
const w = self as unknown as DedicatedWorkerGlobalScope;
w.onmessage = ({ data }) => {
  try {
    const pixels = data.pixels as Uint8ClampedArray,
      mask = dominantBackgroundMask(pixels, data.width, data.height);
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) pixels.fill(0, i * 4, i * 4 + 4);
    w.postMessage({ pixels }, [pixels.buffer]);
  } catch (e) {
    w.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
