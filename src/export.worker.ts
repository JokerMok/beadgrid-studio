/// <reference lib="webworker" />
import { Zlib, zipSync, strToU8 } from "fflate";
import { BRAND, PALETTE, usage, type Project } from "./model";
import { materialSizeLabel } from "./material-catalog";
import { chartLayout, legendLayout, physicalPlan } from "./export-layout";
export type ExportOptions = {
  kind: "chart" | "mosaic" | "palette" | "assembly" | "sections";
  cell: number;
  mirror: boolean;
  board: 52 | 78 | 104;
  assemblyMode?: "full" | "parts";
  regions?: number[];
  codes?: boolean;
  lines?: boolean;
  coordinates?: boolean;
};
const context = self as unknown as DedicatedWorkerGlobalScope;
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c;
}
function crc(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const be = (n: number) => new Uint8Array([n >>> 24, n >>> 16, n >>> 8, n]);
function join(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
function chunk(type: string, data: Uint8Array) {
  const content = join([strToU8(type), data]);
  return join([be(data.length), content, be(crc(content))]);
}
async function png(
  width: number,
  height: number,
  draw: (g: OffscreenCanvasRenderingContext2D, y: number, rows: number) => void,
  progress: (v: number) => void,
  metadata: object,
) {
  const parts: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk(
      "IHDR",
      join([be(width), be(height), new Uint8Array([8, 6, 0, 0, 0])]),
    ),
    chunk("tEXt", strToU8("bead-project\0" + JSON.stringify(metadata))),
  ];
  let compressed = 0;
  const z = new Zlib({ level: 3 }, (data) => {
    compressed += data.length;
    if (compressed > 128 * 1024 * 1024)
      throw Error("单文件超过128MB，请降低每格像素或选择分区导出");
    parts.push(chunk("IDAT", data));
  });
  const stripeHeight = Math.max(1, Math.min(64, Math.floor(1_000_000 / width))),
    tileWidth = Math.min(8192, width),
    canvas = new OffscreenCanvas(tileWidth, stripeHeight),
    g = canvas.getContext("2d", { willReadFrequently: true })!;
  for (let y = 0; y < height; y += stripeHeight) {
    const rows = Math.min(stripeHeight, height - y),
      scanline = new Uint8Array(rows * (width * 4 + 1));
    for (let left = 0; left < width; left += 8192) {
      const count = Math.min(8192, width - left);
      g.resetTransform();
      g.clearRect(0, 0, tileWidth, stripeHeight);
      g.save();
      g.translate(-left, -y);
      draw(g, y, rows);
      g.restore();
      const raw = g.getImageData(0, 0, count, rows).data;
      for (let r = 0; r < rows; r++)
        scanline.set(
          raw.subarray(r * count * 4, (r + 1) * count * 4),
          r * (width * 4 + 1) + 1 + left * 4,
        );
    }
    z.push(scanline, y + rows === height);
    progress((y + rows) / height);
  }
  parts.push(chunk("IEND", new Uint8Array()));
  return join(parts);
}
type Tile = {
  x: number;
  y: number;
  w: number;
  h: number;
  cells: Int16Array;
  name: string;
};
function drawChart(
  g: OffscreenCanvasRenderingContext2D,
  top: number,
  rows: number,
  p: Project,
  t: Tile,
  o: ExportOptions,
  plan: ReturnType<typeof chartLayout>,
  assembly = false,
) {
  const {
      cell,
      margin,
      contentWidth,
      canvasWidth,
      canvasHeight,
      chartWidth,
      chartHeight,
      headerHeight,
    } = plan,
    used = usage(t.cells),
    x0 = margin + (contentWidth - chartWidth) / 2,
    y0 = headerHeight;
  g.fillStyle = "#fff";
  g.fillRect(0, top, canvasWidth, rows);
  g.textAlign = "start";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#1d2745";
  g.font = `800 ${Math.max(28, cell * 0.86)}px Inter, 'Microsoft YaHei', sans-serif`;
  g.fillText(`${BRAND.english}（${BRAND.name}）`, margin, cell * 1.55);
  g.font = `550 ${Math.max(14, cell * 0.44)}px Inter, 'Microsoft YaHei', sans-serif`;
  g.fillStyle = "#64748b";
  g.fillText(
    assembly
      ? t.name.startsWith("拼接板整体")
        ? `原图 ${p.width} × ${p.height} 格 · ${o.board} × ${o.board} 常规板 · ${Math.ceil(p.width / o.board)} 列 × ${Math.ceil(p.height / o.board)} 行，共 ${Math.ceil(p.width / o.board) * Math.ceil(p.height / o.board)} 块`
        : `分区 ${Math.floor(t.y / o.board) * Math.ceil(p.width / o.board) + Math.floor(t.x / o.board) + 1}（第 ${Math.floor(t.y / o.board) + 1} 行、第 ${Math.floor(t.x / o.board) + 1} 列）· 全图坐标 X ${t.x + 1}–${t.x + t.w} / Y ${t.y + 1}–${t.y + t.h}`
      : `${p.name} · ${t.w} × ${t.h} · ${materialSizeLabel(p.settings)} · ${used.reduce((n, c) => n + c[1], 0).toLocaleString()} 颗 · ${plan.tier}`,
    margin,
    cell * 2.55,
  );
  const start = Math.max(0, Math.floor((top - y0) / cell)),
    end = Math.min(t.h, Math.ceil((top + rows - y0) / cell));
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let y = start; y < end; y++)
    for (let x = 0; x < t.w; x++) {
      const index = t.cells[y * t.w + x];
      g.fillStyle = index < 0 ? "#fff" : PALETTE[index].hex;
      g.fillRect(x0 + x * cell, y0 + y * cell, cell + 0.35, cell + 0.35);
      if (index >= 0 && o.codes !== false) {
        const color = PALETTE[index],
          r = parseInt(color.hex.slice(1, 3), 16),
          green = parseInt(color.hex.slice(3, 5), 16),
          b = parseInt(color.hex.slice(5, 7), 16);
        g.fillStyle =
          (r * 0.2126 + green * 0.7152 + b * 0.0722) / 255 > 0.58
            ? "#17213a"
            : "#fff";
        let font = cell * 0.38;
        g.font = `400 ${font}px Arial, sans-serif`;
        const measured = g.measureText(color.code).width;
        if (measured > cell * 0.7) font *= (cell * 0.7) / measured;
        g.font = `400 ${font}px Arial, sans-serif`;
        g.fillText(color.code, x0 + (x + 0.5) * cell, y0 + (y + 0.5) * cell);
      }
    }
  if (o.lines !== false) {
    const original =
        p.grid.color === "#a0c4bc" &&
        (!p.grid.majorColor || p.grid.majorColor === "#29a88f") &&
        (!p.grid.blockColor || p.grid.blockColor === "#29a88f"),
      style = (i: number) => {
        g.strokeStyle = original
          ? i % 5 === 0
            ? "rgba(31,168,137,.52)"
            : "rgba(153,184,177,.30)"
          : i % 10 === 0
            ? p.grid.blockColor || "#29a88f"
            : i % 5 === 0
              ? p.grid.majorColor || "#29a88f"
              : p.grid.color;
        g.globalAlpha = original
          ? 1
          : i % 10 === 0
            ? 0.96
            : i % 5 === 0
              ? 0.8
              : 0.5;
        g.lineWidth =
          !original && i % 10 === 0
            ? Math.max(2, cell * 0.09)
            : i % 5 === 0
              ? Math.max(1, cell * 0.035)
              : Math.max(0.5, cell * 0.016);
      };
    for (let y = 0; y <= t.h; y++) {
      style(y + t.y);
      g.beginPath();
      g.moveTo(x0, y0 + y * cell);
      g.lineTo(x0 + chartWidth, y0 + y * cell);
      g.stroke();
    }
    for (let x = 0; x <= t.w; x++) {
      style(x + t.x);
      g.beginPath();
      g.moveTo(x0 + x * cell, y0);
      g.lineTo(x0 + x * cell, y0 + chartHeight);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  if (assembly) {
    g.strokeStyle = "#df5c55";
    g.lineWidth = Math.max(2, cell * 0.065);
    for (let x = 0; x <= t.w; x++)
      if ((x + t.x) % o.board === 0) {
        g.beginPath();
        g.moveTo(x0 + x * cell, y0);
        g.lineTo(x0 + x * cell, y0 + chartHeight);
        g.stroke();
      }
    for (let y = start; y <= end; y++)
      if ((y + t.y) % o.board === 0) {
        g.beginPath();
        g.moveTo(x0, y0 + y * cell);
        g.lineTo(x0 + chartWidth, y0 + y * cell);
        g.stroke();
      }
  }
  if (o.coordinates !== false) {
    g.fillStyle = "#40506a";
    g.font = `700 ${Math.max(5.75, Math.min(18, cell * 0.34))}px Inter, 'Microsoft YaHei', sans-serif`;
    const step = cell < 16 ? 10 : cell < 28 ? 5 : 1;
    g.textAlign = "center";
    for (let x = 0; x < t.w; x += step) {
      g.fillText(String(x + 1 + t.x), x0 + (x + 0.5) * cell, y0 - cell * 0.48);
      g.fillText(
        String(x + 1 + t.x),
        x0 + (x + 0.5) * cell,
        y0 + chartHeight + cell * 0.48,
      );
    }
    for (let y = Math.max(0, start - 1); y < Math.min(t.h, end + 1); y += 1) {
      if (y % step) continue;
      g.textAlign = "right";
      g.fillText(String(y + 1 + t.y), x0 - cell * 0.28, y0 + (y + 0.5) * cell);
      g.textAlign = "left";
      g.fillText(
        String(y + 1 + t.y),
        x0 + chartWidth + cell * 0.28,
        y0 + (y + 0.5) * cell,
      );
    }
  }
  const legendY = y0 + chartHeight + plan.legendGap;
  g.textAlign = "start";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#1d2745";
  g.font = `800 ${Math.max(20, cell * 0.68)}px Inter, 'Microsoft YaHei', sans-serif`;
  g.fillText("色卡与用量", margin, legendY);
  g.font = `500 ${Math.max(12, cell * 0.4)}px Inter, 'Microsoft YaHei', sans-serif`;
  g.fillStyle = "#64748b";
  g.fillText(
    "格内为色号；此处显示完整颜色名称与所需颗数",
    margin,
    legendY + cell * 0.78,
  );
  const startY = legendY + plan.legendHeaderHeight,
    cardW = contentWidth / plan.columns,
    swatch = cell * 1.3;
  used.forEach(([index, count], i) => {
    const x = margin + (i % plan.columns) * cardW,
      y = startY + Math.floor(i / plan.columns) * plan.legendRowHeight;
    if (y + swatch < top || y > top + rows) return;
    g.fillStyle = PALETTE[index].hex;
    g.fillRect(x, y, swatch, swatch);
    g.strokeStyle = "#d7e4e0";
    g.lineWidth = Math.max(1, cell * 0.025);
    g.strokeRect(x, y, cardW - cell * 0.3, swatch);
    g.fillStyle = "#1d2745";
    g.font = `650 ${Math.max(14, cell * 0.48)}px Inter, sans-serif`;
    g.fillText(
      PALETTE[index].code,
      x + swatch + cell * 0.32,
      y + Math.max(17, cell * 0.48),
    );
    g.fillStyle = "#64748b";
    g.font = `500 ${Math.max(12, cell * 0.39)}px Inter, 'Microsoft YaHei', sans-serif`;
    g.fillText(
      `${PALETTE[index].name} · ${count} 颗`,
      x + swatch + cell * 0.32,
      y + Math.max(35, cell * 1.05),
    );
  });
  g.fillStyle = "#1fa889";
  g.font = `650 ${Math.max(12, cell * 0.38)}px Inter, 'Microsoft YaHei', sans-serif`;
  g.fillText(
    `由 ${BRAND.english}（${BRAND.name}）本地生成 · ${plan.tier} 高清图纸`,
    margin,
    canvasHeight - plan.footerHeight * 0.45,
  );
}
context.onmessage = async ({
  data,
}: {
  data: { project: Project; options: ExportOptions };
}) => {
  try {
    const { project: p, options: o } = data,
      w = p.width,
      h = p.height;
    let cells = new Int16Array(p.cells);
    if (o.mirror) {
      const copy = cells.slice();
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) cells[y * w + x] = copy[y * w + w - 1 - x];
    }
    const allUsage = usage(cells),
      total = allUsage.reduce((n, c) => n + c[1], 0),
      files: Record<string, Uint8Array> = {},
      assembly = o.kind === "assembly" || o.kind === "sections",
      parts = o.kind === "sections" || o.assemblyMode === "parts";
    let tiles: Tile[] = [];
    if (assembly) {
      const plan = physicalPlan(w, h, o.board),
        regions = parts
          ? Array.from({ length: plan.count }, (_, id) => id).filter(
              (id) => o.regions === undefined || o.regions.includes(id),
            )
          : [-1];
      if (!regions.length) throw Error("请至少选择一个分区");
      if (regions.length > 400) throw Error("分区超过400张，请选择78或104格板");
      for (const id of regions) {
        const tx = id < 0 ? 0 : (id % plan.columns) * o.board,
          ty = id < 0 ? 0 : Math.floor(id / plan.columns) * o.board,
          tw = id < 0 ? plan.totalWidth : o.board,
          th = id < 0 ? plan.totalHeight : o.board,
          grid = new Int16Array(tw * th).fill(-1);
        for (let y = 0; y < th; y++)
          for (let x = 0; x < tw; x++) {
            const sx = tx + x - plan.offsetX,
              sy = ty + y - plan.offsetY;
            if (sx >= 0 && sx < w && sy >= 0 && sy < h)
              grid[y * tw + x] = cells[sy * w + sx];
          }
        tiles.push({
          x: tx,
          y: ty,
          w: tw,
          h: th,
          cells: grid,
          name:
            id < 0
              ? `拼接板整体-${o.board}×${o.board}-${plan.count}块`
              : `分区${id + 1}-第${Math.floor(id / plan.columns) + 1}行第${(id % plan.columns) + 1}列`,
        });
      }
      if (parts)
        files["分板说明.json"] = strToU8(
          JSON.stringify(
            {
              ...plan,
              width: w,
              height: h,
              total,
              tiles: tiles.map(({ cells, ...t }) => t),
            },
            null,
            2,
          ),
        );
    } else
      tiles = [
        {
          x: 0,
          y: 0,
          w,
          h,
          cells,
          name:
            o.kind === "mosaic"
              ? "纯马赛克"
              : o.kind === "palette"
                ? "色卡用量"
                : "完整图纸",
        },
      ];
    let bytesTotal = 0;
    for (let t = 0; t < tiles.length; t++) {
      const tile = tiles[t],
        used = usage(tile.cells),
        metadata = {
          width: tile.w,
          height: tile.h,
          originX: tile.x,
          originY: tile.y,
          total: used.reduce((n, c) => n + c[1], 0),
          usage: used.map(([i, count]) => ({ code: PALETTE[i].code, count })),
          mirror: o.mirror,
          paletteVersion: p.paletteVersion,
        };
      let bytes: Uint8Array;
      if (o.kind === "mosaic") {
        const cell =
          o.cell ||
          Math.max(
            1,
            Math.floor((Math.max(w, h) <= 96 ? 4096 : 8192) / Math.max(w, h)),
          );
        bytes = await png(
          w * cell,
          h * cell,
          (g, y, rows) => {
            g.fillStyle = "#fff";
            g.fillRect(0, y, w * cell, rows);
            for (
              let row = Math.max(0, Math.floor(y / cell));
              row < Math.min(h, Math.ceil((y + rows) / cell));
              row++
            )
              for (let x = 0; x < w; x++) {
                const index = cells[row * w + x];
                if (index < 0) continue;
                g.fillStyle = PALETTE[index].hex;
                g.fillRect(x * cell, row * cell, cell, cell);
              }
          },
          (v) => context.postMessage({ progress: Math.round(v * 100) }),
          metadata,
        );
      } else if (o.kind === "palette") {
        // Cache complete cards with padding: clipping a rounded vector path at a strip edge changes antialiasing.
        const plan = legendLayout(used.length),
          cards = new Map<number, OffscreenCanvas>();
        bytes = await png(
          plan.canvasWidth,
          plan.canvasHeight,
          (g, y, rows) => {
            g.fillStyle = "#f7faf9";
            g.fillRect(0, y, plan.canvasWidth, rows);
            g.textAlign = "left";
            g.textBaseline = "alphabetic";
            g.fillStyle = "#18243d";
            g.font = "800 58px Inter, 'Microsoft YaHei', sans-serif";
            g.fillText("色卡与用量", 70, 92);
            g.fillStyle = "#607086";
            g.font = "500 26px Inter, 'Microsoft YaHei', sans-serif";
            g.fillText(
              `${p.name} · ${materialSizeLabel(p.settings)} · ${used.length} 色 · ${total.toLocaleString()} 颗`,
              70,
              142,
            );
            g.font = "500 21px Inter, 'Microsoft YaHei', sans-serif";
            g.fillText(
              "按用量从多到少排列，可单独保存、打印或采购对照",
              70,
              184,
            );
            used.forEach(([i, n], k) => {
              const x = 70 + (k % plan.columns) * 420,
                top = 250 + Math.floor(k / plan.columns) * 88;
              if (top + 76 < y || top > y + rows) return;
              let card = cards.get(i);
              if (!card) {
                card = new OffscreenCanvas(430, 96);
                const cg = card.getContext("2d")!;
                cg.fillStyle = "#f7faf9";
                cg.fillRect(0, 0, 430, 96);
                cg.translate(4, 4);
                cg.textAlign = "left";
                cg.textBaseline = "alphabetic";
                cg.fillStyle = "#fff";
                cg.beginPath();
                cg.roundRect(0, 0, 402, 74, 16);
                cg.fill();
                cg.strokeStyle = "#dce8e4";
                cg.lineWidth = 2;
                cg.stroke();
                cg.fillStyle = PALETTE[i].hex;
                cg.beginPath();
                cg.roundRect(14, 13, 58, 48, 10);
                cg.fill();
                cg.strokeStyle = "#c6d4d0";
                cg.stroke();
                cg.fillStyle = "#1d2943";
                cg.font = "800 24px Inter, sans-serif";
                cg.fillText(PALETTE[i].code, 86, 34);
                cg.fillStyle = "#627086";
                cg.font = "500 18px Inter, 'Microsoft YaHei', sans-serif";
                cg.fillText(PALETTE[i].name, 86, 59);
                cg.fillStyle = "#16213a";
                cg.textAlign = "right";
                cg.font = "800 23px Inter, 'Microsoft YaHei', sans-serif";
                cg.fillText(`${n.toLocaleString()} 颗`, 382, 47);
                cg.textAlign = "left";
                cards.set(i, card);
              }
              g.drawImage(card, x - 4, top - 4);
            });
            g.fillStyle = "#1fa889";
            g.font = "650 20px Inter, 'Microsoft YaHei', sans-serif";
            g.fillText(
              `由 ${BRAND.english}（${BRAND.name}）本地生成 · ${plan.tier} 色卡`,
              70,
              plan.canvasHeight - 45,
            );
          },
          (v) => context.postMessage({ progress: Math.round(v * 100) }),
          metadata,
        );
      } else {
        const plan = chartLayout(tile.w, tile.h, used.length, o.cell || 56);
        bytes = await png(
          plan.canvasWidth,
          plan.canvasHeight,
          (g, y, rows) => drawChart(g, y, rows, p, tile, o, plan, assembly),
          (v) =>
            context.postMessage({
              progress: Math.round(((t + v) / tiles.length) * 100),
              detail: `正在生成${tile.name} · ${plan.canvasWidth} × ${plan.canvasHeight}px`,
            }),
          metadata,
        );
      }
      bytesTotal += bytes.length;
      if (bytesTotal > 128 * 1024 * 1024)
        throw Error(
          "本次导出超过128MB，请明确选择较小分区后重试；没有改变完整图纸输出",
        );
      files[tile.name + ".png"] = bytes;
    }
    if (o.kind === "palette" || parts)
      files["用量.csv"] = strToU8(
        "\ufeff色号,HEX,数量\n" +
          allUsage
            .map(([i, n]) => `${PALETTE[i].code},${PALETTE[i].hex},${n}`)
            .join("\n"),
      );
    if (Object.keys(files).length === 1) {
      const bytes = Object.values(files)[0];
      context.postMessage({ done: true, bytes, extension: "png" }, [
        bytes.buffer,
      ]);
    } else {
      const bytes = zipSync(files, { level: 0 });
      context.postMessage({ done: true, bytes, extension: "zip" }, [
        bytes.buffer,
      ]);
    }
  } catch (e) {
    context.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
