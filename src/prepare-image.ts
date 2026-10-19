import type { Settings } from "./model";
export type Raster = { pixels: Uint8ClampedArray; size: number };
const decode = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error("图片解码失败"));
    image.src = url;
  });
/** HTMLImageElement is intentional: ImageBitmap uses a different Chromium resampling path. */
export async function prepareRaster(
  source: string,
  s: Settings,
): Promise<Raster> {
  let image = await decode(source);
  if (s.fit === "crop" && s.mode !== "recognize") {
    const r = s.crop,
      sw = image.naturalWidth * r.w,
      sh = image.naturalHeight * r.h,
      c = document.createElement("canvas");
    c.width = Math.max(1, Math.min(1600, Math.round(sw)));
    c.height = Math.max(1, Math.round(c.width / (sw / sh)));
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(
      image,
      image.naturalWidth * r.x,
      image.naturalHeight * r.y,
      sw,
      sh,
      0,
      0,
      c.width,
      c.height,
    );
    image = await decode(c.toDataURL("image/png"));
  }
  if (s.mode === "recognize") {
    const a = s.sourceAlignment ?? {
        cell: Math.min(
          image.naturalWidth / s.width,
          image.naturalHeight / s.height,
        ),
        originX: 0,
        originY: 0,
        columns: s.width,
        rows: s.height,
        boardX: 0,
        boardY: 0,
      },
      canvas = document.createElement("canvas");
    canvas.width = s.width * 7;
    canvas.height = s.height * 7;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    const columns = Math.max(0, Math.min(a.columns, s.width - a.boardX)),
      rows = Math.max(0, Math.min(a.rows, s.height - a.boardY));
    for (let row = 0; row < rows; row++)
      for (let start = 0; start < columns; start += 192) {
        const n = Math.min(192, columns - start);
        g.drawImage(
          image,
          a.originX + start * a.cell,
          a.originY + row * a.cell,
          n * a.cell,
          a.cell,
          (a.boardX + start) * 7,
          (a.boardY + row) * 7,
          n * 7,
          7,
        );
      }
    return {
      pixels: g.getImageData(0, 0, canvas.width, canvas.height).data,
      size: 7,
    };
  }
  const small =
      s.smallCleanup &&
      s.mode !== "simple" &&
      Math.max(s.width, s.height) <= 104,
    size = small
      ? 7
      : Math.max(
          2,
          Math.min(5, Math.floor(1600 / Math.max(s.width, s.height))),
        ),
    canvas = document.createElement("canvas");
  canvas.width = s.width * size;
  canvas.height = s.height * size;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingEnabled = !small;
  g.imageSmoothingQuality = "high";
  if (s.alpha === "white") {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
  }
  const ratio = Math.min(
      canvas.width / image.naturalWidth,
      canvas.height / image.naturalHeight,
    ),
    w = image.naturalWidth * ratio * s.zoom,
    h = image.naturalHeight * ratio * s.zoom;
  g.drawImage(
    image,
    (canvas.width - w) / 2 + s.panX * canvas.width + s.alignX * size,
    (canvas.height - h) / 2 + s.panY * canvas.height + s.alignY * size,
    w,
    h,
  );
  return {
    pixels: g.getImageData(0, 0, canvas.width, canvas.height).data,
    size,
  };
}
