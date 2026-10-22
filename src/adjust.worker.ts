/// <reference lib="webworker" />
import { adjustPattern } from "./conversion-core";
import type { Settings } from "./model";
const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = ({
  data,
}: {
  data: {
    cells: Int16Array;
    width: number;
    height: number;
    settings: Settings;
  };
}) => {
  try {
    const cells = adjustPattern(
      data.cells,
      data.width,
      data.height,
      data.settings,
    );
    worker.postMessage({ cells }, [cells.buffer]);
  } catch (e) {
    worker.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
