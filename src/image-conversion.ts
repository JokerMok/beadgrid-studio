import { PALETTE, type Settings } from "./model";
import { prepareRaster } from "./prepare-image";

export type ConversionResult = {
  source: string;
  settingsKey: string;
  width: number;
  height: number;
  cells: Int16Array;
};
export const conversionKey = (settings: Settings) => JSON.stringify(settings);
export function conversionError(s: Settings): string {
  if (
    ![s.width, s.height].every(
      (n) => Number.isInteger(n) && n >= 16 && n <= 1000,
    )
  )
    return "宽高必须是16～1000之间的整数";
  if (!Number.isInteger(s.limit) || s.limit < 3 || s.limit > PALETTE.length)
    return `最大颜色数必须是3～${PALETTE.length}之间的整数`;
  const c = s.crop;
  if (
    !c ||
    ![c.x, c.y, c.w, c.h].every(Number.isFinite) ||
    c.x < 0 ||
    c.y < 0 ||
    c.w <= 0 ||
    c.h <= 0 ||
    c.x + c.w > 1.001 ||
    c.y + c.h > 1.001
  )
    return "裁剪范围无效，请重置裁剪";
  if (
    s.mode === "recognize" &&
    s.sourceAlignment &&
    (!Number.isFinite(s.sourceAlignment.cell) || s.sourceAlignment.cell <= 0)
  )
    return "原图格距必须大于0";
  return "";
}
export function matchesConversion(
  result: ConversionResult,
  source: string,
  settings: Settings,
) {
  return (
    result.source === source &&
    result.settingsKey === conversionKey(settings) &&
    result.width === settings.width &&
    result.height === settings.height &&
    result.cells.length === settings.width * settings.height
  );
}

/** Uses the production rasterizer and conversion worker; cancel also releases the worker. */
export async function convertImage(
  source: string,
  settings: Settings,
  {
    signal,
    onProgress,
  }: { signal: AbortSignal; onProgress?: (progress: number) => void },
): Promise<ConversionResult> {
  const error = conversionError(settings);
  if (error) throw Error(error);
  signal.throwIfAborted();
  const snapshot = structuredClone(settings),
    settingsKey = conversionKey(snapshot);
  onProgress?.(0);
  const raster = await prepareRaster(source, snapshot, signal);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./convert.worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException("转换已取消", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.error) fail(Error(data.error));
      else if (data.cells) {
        if (
          !(data.cells instanceof Int16Array) ||
          data.cells.length !== snapshot.width * snapshot.height ||
          data.cells.some((c: number) => c < -1 || c >= PALETTE.length)
        ) {
          fail(Error("转换结果无效，请重试"));
          return;
        }
        cleanup();
        resolve({
          source,
          settingsKey,
          width: snapshot.width,
          height: snapshot.height,
          cells: data.cells,
        });
      } else onProgress?.(data.progress || 0);
    };
    worker.onerror = (event) => fail(Error("处理失败：" + event.message));
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      worker.postMessage({ raster, settings: snapshot }, [
        raster.pixels.buffer,
      ]);
    } catch (error) {
      fail(error);
    }
  });
}
