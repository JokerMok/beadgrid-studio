export async function clearEdgeBackground(
  image: CanvasImageSource,
  width: number,
  height: number,
  crop: { x: number; y: number; w: number; h: number },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const scale = Math.min(1, 1600 / Math.max(width * crop.w, height * crop.h)),
    c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width * crop.w * scale));
  c.height = Math.max(1, Math.round(height * crop.h * scale));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(
    image,
    width * crop.x,
    height * crop.y,
    width * crop.w,
    height * crop.h,
    0,
    0,
    c.width,
    c.height,
  );
  const pixels = g.getImageData(0, 0, c.width, c.height).data;
  try {
    const data = await new Promise<Uint8ClampedArray>((resolve, reject) => {
      const w = new Worker(new URL("./background.worker.ts", import.meta.url), {
        type: "module",
      });
      const finish = (err?: unknown, data?: Uint8ClampedArray) => {
        signal?.removeEventListener("abort", abort);
        w.terminate();
        err ? reject(err) : resolve(data!);
      };
      const abort = () =>
        finish(new DOMException("已取消去背景", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      w.onmessage = ({ data }) =>
        data.error ? finish(Error(data.error)) : finish(undefined, data.pixels);
      w.onerror = (e) => finish(Error(e.message));
      w.postMessage({ pixels, width: c.width, height: c.height }, [
        pixels.buffer,
      ]);
    });
    g.putImageData(
      new ImageData(data as Uint8ClampedArray<ArrayBuffer>, c.width, c.height),
      0,
      0,
    );
    return c;
  } catch (e) {
    c.width = c.height = 0;
    throw e;
  }
}
export async function backgroundImageUrl(url: string, signal: AbortSignal) {
  const image = new Image();
  image.src = url;
  await image.decode();
  signal.throwIfAborted();
  const c = await clearEdgeBackground(
    image,
    image.naturalWidth,
    image.naturalHeight,
    { x: 0, y: 0, w: 1, h: 1 },
    signal,
  );
  const result = c.toDataURL("image/png");
  c.width = c.height = 0;
  image.src = "";
  return result;
}
