import { zipSync, strToU8 } from "fflate";
import {
  listPages,
  listSpecification,
  listText,
  type BeadList,
} from "./bead-list";
import { MATERIAL_CATALOG, PURCHASE_NOTICE } from "./material-catalog";

export async function renderListImages(
  list: BeadList,
  signal: AbortSignal,
  onProgress: (n: number) => void,
) {
  const pages = listPages(list),
    files: Record<string, Uint8Array> = {};
  if (!list.sizeMm || !pages.length)
    throw Error("请先选择豆子规格并绘制有效格子");
  await document.fonts.ready;
  for (const page of pages) {
    if (signal.aborted) throw Error("已取消生成清单图片");
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1900;
    const g = canvas.getContext("2d");
    if (!g) throw Error("无法创建清单图片，请重试");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.textBaseline = "top";
    const text = (
      s: string,
      x: number,
      y: number,
      size = 25,
      color = "#253d36",
      weight = 400,
    ) => {
      g.font = `${weight} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      g.fillStyle = color;
      g.fillText(s, x, y);
    };
    const wrap = (
      s: string,
      x: number,
      y: number,
      width: number,
      size = 23,
      line = 32,
    ) => {
      g.font = `${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      let row = "",
        top = y;
      for (const c of s) {
        if (g.measureText(row + c).width > width && row) {
          text(row, x, top, size);
          top += line;
          row = "";
        }
        row += c;
      }
      if (row) text(row, x, top, size);
      return top + line;
    };
    text("用豆清单", 56, 42, 42, "#176d57", 700);
    text(`第 ${page.page} / ${pages.length} 页`, 1000, 55, 24);
    let top = wrap(list.name, 56, 105, 1128, 28, 36);
    top = wrap(listSpecification(list), 56, top + 12, 1128, 24);
    text(
      `图纸 ${list.width} × ${list.height} 格   ·   ${list.colorCount}色   ·   实际总用量 ${list.total.toLocaleString()} 颗`,
      56,
      top + 12,
      26,
      "#253d36",
      600,
    );
    text(
      list.reserve
        ? `备用量 ${list.reserve}% · 每色向上取整 · 建议采购合计 ${list.purchaseTotal.toLocaleString()} 颗`
        : "未加备用量 · 一格一颗 · 透明格和空白格不计入",
      56,
      top + 54,
      23,
    );
    const rowTop = Math.max(340, top + 110);
    for (let col = 0; col < 2; col++) {
      const x = 56 + col * 576;
      text("色号", x + 46, rowTop - 40, 23);
      text("实际颗数", x + 185, rowTop - 40, 23);
      if (list.reserve) text("建议采购", x + 350, rowTop - 40, 23);
    }
    page.rows.forEach((r, i) => {
      const col = Math.floor(i / 20),
        y = rowTop + (i % 20) * 50,
        x = 56 + col * 576;
      g.fillStyle = i % 2 ? "#f3f8f5" : "#fff";
      g.fillRect(x - 8, y - 6, 548, 48);
      g.fillStyle = r.hex;
      g.fillRect(x, y + 2, 30, 30);
      g.strokeStyle = "#b4c6bc";
      g.strokeRect(x, y + 2, 30, 30);
      text(r.code, x + 46, y, 27, "#253d36", 600);
      text(r.count.toLocaleString(), x + 185, y, 27);
      if (list.reserve) text(r.purchase.toLocaleString(), x + 350, y, 27);
    });
    let footer = rowTop + 1014;
    footer = wrap(PURCHASE_NOTICE, 56, footer, 1128, 23);
    footer = wrap(MATERIAL_CATALOG.screenNotice, 56, footer + 8, 1128, 21, 29);
    footer = wrap(
      "色号核对：公开仓库逐项对应；2.6mm：商家公开规格；厂家认证色卡未取得。",
      56,
      footer + 4,
      1128,
      20,
      27,
    );
    wrap(
      `数据版本：${list.paletteVersion} / ${list.catalogRevision}`,
      56,
      footer + 4,
      1128,
      17,
      24,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (v) => (v ? resolve(v) : reject(Error("清单图片编码失败"))),
        "image/png",
      ),
    );
    files[`用豆清单_${String(page.page).padStart(2, "0")}.png`] =
      new Uint8Array(await blob.arrayBuffer());
    canvas.width = canvas.height = 1;
    onProgress(page.page / pages.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  if (signal.aborted) throw Error("已取消生成清单图片");
  if (pages.length === 1)
    return {
      blob: new Blob([Object.values(files)[0] as Uint8Array<ArrayBuffer>], {
        type: "image/png",
      }),
      extension: "png",
    };
  files["清单数据.json"] = strToU8(JSON.stringify(list, null, 2));
  files["清单说明.txt"] = strToU8(listText(list));
  return {
    blob: new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], {
      type: "application/zip",
    }),
    extension: "zip",
  };
}
