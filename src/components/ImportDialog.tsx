import { useState, useRef, useEffect, type PointerEvent } from "react";
import { GridFour, ArrowRight } from "@phosphor-icons/react";
import Dialog from "./Dialog";
import MaterialSettings from "./MaterialSettings";
import { analyseGrid } from "../reference-detection";
import type { SourceAlignment } from "../reference-recognition";
import type { Settings } from "../model";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export default function ImportDialog({
  source,
  name,
  initial,
  onClose,
  onGenerate,
}: {
  source: string;
  name: string;
  initial: Settings;
  onClose: () => void;
  onGenerate: (s: Settings) => void;
}) {
  const [s, setS] = useState(initial),
    [error, setError] = useState(""),
    [dimensions, setDimensions] = useState({ w: 128, h: 128 }),
    [frameSize, setFrameSize] = useState({ w: 720, h: 420 }),
    [viewZoom, setViewZoom] = useState(1),
    [viewPan, setViewPan] = useState({ x: 0, y: 0 }),
    [panMode, setPanMode] = useState(false),
    [autoColors, setAutoColors] = useState(false),
    [analysing, setAnalysing] = useState(false),
    [gridMessage, setGridMessage] = useState("");
  const image = useRef<HTMLImageElement>(null),
    frame = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    drag = useRef<{
      handle: string;
      x: number;
      y: number;
      crop: Settings["crop"];
      pan: { x: number; y: number };
    } | null>(null);
  const update = (v: Partial<Settings>) => setS((p) => ({ ...p, ...v }));
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setFrameSize({ w: r.width, h: r.height });
    });
    if (frame.current) ro.observe(frame.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!autoColors || !image.current) return;
    const crop = s.fit === "crop" ? s.crop : { x: 0, y: 0, w: 1, h: 1 },
      scale = 96 / Math.max(crop.w * dimensions.w, crop.h * dimensions.h),
      c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(crop.w * dimensions.w * scale));
    c.height = Math.max(1, Math.round(crop.h * dimensions.h * scale));
    const g = c.getContext("2d")!;
    g.drawImage(
      image.current,
      crop.x * dimensions.w,
      crop.y * dimensions.h,
      crop.w * dimensions.w,
      crop.h * dimensions.h,
      0,
      0,
      c.width,
      c.height,
    );
    const p = g.getImageData(0, 0, c.width, c.height).data,
      colors = new Set<string>();
    for (let i = 0; i < p.length; i += 4)
      if (p[i + 3] >= 32)
        colors.add(`${p[i] >> 4}-${p[i + 1] >> 4}-${p[i + 2] >> 4}`);
    const target = clamp(Math.round(18 + Math.sqrt(colors.size) * 6), 24, 160),
      limit = [24, 32, 48, 64, 80, 96, 128, 160].reduce(
        (a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a),
        24,
      );
    setS((v) => ({ ...v, limit }));
  }, [autoColors, s.crop, s.fit, dimensions]);
  async function detect(imageElement = image.current) {
    if (!imageElement) return;
    setAnalysing(true);
    try {
      const guess = await analyseGrid(imageElement),
        a = guess.alignment ?? {
          cell: Math.min(dimensions.w / s.width, dimensions.h / s.height),
          originX: 0,
          originY: 0,
          columns: s.width,
          rows: s.height,
          boardX: 0,
          boardY: 0,
        };
      setS((v) => ({
        ...v,
        mode: "recognize",
        fit: "contain",
        width: clamp(a.columns, 16, 1000),
        height: clamp(a.rows, 16, 1000),
        sourceAlignment: {
          ...a,
          columns: Math.min(1000, a.columns),
          rows: Math.min(1000, a.rows),
        },
      }));
      setGridMessage(
        guess.kind === "original"
          ? "未检测到稳定网格，请调整格距和起点后识别。"
          : `已检测${guess.kind === "numbered" ? "带色号网格" : "像素网格"}：${a.columns} × ${a.rows} 格`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setAnalysing(false);
    }
  }
  function align(key: keyof SourceAlignment, value: number) {
    update({
      sourceAlignment: {
        cell: Math.min(dimensions.w / s.width, dimensions.h / s.height),
        originX: 0,
        originY: 0,
        columns: s.width,
        rows: s.height,
        boardX: 0,
        boardY: 0,
        ...s.sourceAlignment,
        [key]: value,
      },
    });
  }
  const ratio =
      Math.min(frameSize.w / dimensions.w, frameSize.h / dimensions.h) *
      viewZoom,
    displayW = dimensions.w * ratio,
    displayH = dimensions.h * ratio,
    left = (frameSize.w - displayW) / 2 + viewPan.x,
    top = (frameSize.h - displayH) / 2 + viewPan.y;
  function down(e: PointerEvent, handle: string) {
    if (s.fit !== "crop" && handle !== "pan") return;
    e.preventDefault();
    e.stopPropagation();
    frame.current?.setPointerCapture(e.pointerId);
    drag.current = {
      handle: panMode ? "pan" : handle,
      x: e.clientX,
      y: e.clientY,
      crop: { ...s.crop },
      pan: viewPan,
    };
  }
  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / displayW,
      dy = (e.clientY - d.y) / displayH;
    if (d.handle === "pan") {
      setViewPan({
        x: d.pan.x + e.clientX - d.x,
        y: d.pan.y + e.clientY - d.y,
      });
      return;
    }
    const minW = Math.min(32, dimensions.w) / dimensions.w,
      minH = Math.min(32, dimensions.h) / dimensions.h;
    let { x, y, w, h } = d.crop;
    if (d.handle === "move") {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      let right = x + w,
        bottom = y + h;
      if (d.handle.includes("w")) x = clamp(x + dx, 0, right - minW);
      if (d.handle.includes("e")) right = clamp(right + dx, x + minW, 1);
      if (d.handle.includes("n")) y = clamp(y + dy, 0, bottom - minH);
      if (d.handle.includes("s")) bottom = clamp(bottom + dy, y + minH, 1);
      w = right - x;
      h = bottom - y;
    }
    update({ crop: { x, y, w, h } });
  }
  return (
    <Dialog title="上传图片并设置板子" onClose={onClose} wide>
      <div className="upload-title-row">
        <span>
          {name} · 原图 {dimensions.w} × {dimensions.h}px · 支持任意长宽比
        </span>
        <p>
          如果想要清晰度可以直接选择原图置入，但相应的尺寸变大也会增加拼豆难度哦
        </p>
        <button className="primary" onClick={() => file.current?.click()}>
          换一张图片
        </button>
        <input
          ref={file}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const { readImage } = await import("../storage");
            try {
              const url = await readImage(f);
              onClose();
              window.dispatchEvent(
                new CustomEvent("xing-replace-upload", {
                  detail: { source: url, name: f.name },
                }),
              );
            } catch (e) {
              setError(String(e));
            }
          }}
        />
      </div>
      <div className="source-upload-layout">
        <div className="source-upload-left">
          <button className="recognition-entry" onClick={() => void detect()}>
            <GridFour size={28} />
            <span>
              <strong>如有带色号图纸，点击这里</strong>
              <small>
                已经转成像素图的图纸也可以尝试用此功能，保留原图色号，专用于识别马赛克图纸和带有色号图纸。
              </small>
            </span>
            <ArrowRight />
          </button>
          <div className="crop-toolbar">
            <button
              className={!panMode ? "active" : ""}
              onClick={() => setPanMode(false)}
            >
              移动选框
            </button>
            <button
              className={panMode ? "active" : ""}
              onClick={() => setPanMode(true)}
            >
              移动视图
            </button>
            <button
              onClick={() => {
                setViewZoom(viewZoom === 1 ? 2 : 1);
                setViewPan({ x: 0, y: 0 });
              }}
            >
              放大裁剪
            </button>
          </div>
          <div
            className="source-crop-frame"
            ref={frame}
            onPointerDown={(e) => down(e, "pan")}
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <div
              className="source-crop-image"
              style={{ left, top, width: displayW, height: displayH }}
            >
              <img
                ref={image}
                src={source}
                draggable={false}
                alt="导入图片预览"
                onLoad={(e) => {
                  setDimensions({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  });
                  setViewPan({ x: 0, y: 0 });
                  if (s.mode === "recognize" && !s.sourceAlignment)
                    void detect(e.currentTarget);
                }}
              />
              {s.fit === "crop" && (
                <div
                  className="source-crop-box"
                  onPointerDown={(e) => down(e, "move")}
                  style={{
                    left: `${s.crop.x * 100}%`,
                    top: `${s.crop.y * 100}%`,
                    width: `${s.crop.w * 100}%`,
                    height: `${s.crop.h * 100}%`,
                  }}
                >
                  {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(
                    (handle) => (
                      <button
                        key={handle}
                        className={"crop-handle " + handle}
                        aria-label={"裁剪把手" + handle}
                        onPointerDown={(e) => down(e, handle)}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
            <span className="crop-ratio-tag">
              {s.fit === "crop" ? "自由比例" : "原图完整置入"}
            </span>
          </div>
          <p className="crop-drag-hint">
            拖动框内移动选区，拖动边框圆点自由调整大小。
          </p>
          <p className="crop-long-hint">
            <strong>拖动白色边框、四角或边中把手即可自由裁剪。</strong>
            裁剪框可拉成长方形，不再限制为正方形；拖动框内可移动整个取景区域。点击预览上方“放大裁剪”可查看细节；放大后可用“移动选框”调整取景；边框超出视野时，用“移动视图”拖动画面，再拖动边框圆点调整大小。
          </p>
          <p className="micro">
            当前区域 {Math.round(s.crop.w * dimensions.w)} ×{" "}
            {Math.round(s.crop.h * dimensions.h)} px
          </p>
        </div>
        <div className="source-upload-right">
          {s.mode === "recognize" && (
            <section className="source-recognition-fields">
              <h3>色块识别与网格对齐</h3>
              <button
                className="soft full"
                disabled={analysing}
                onClick={() => void detect()}
              >
                {analysing ? "正在分析网格…" : "自动检测原图网格"}
              </button>
              <p>
                {gridMessage ||
                  "按原图的方格位置取样，外围网格线与格内文字不会直接参与平均。"}
              </p>
              {(
                [
                  ["cell", "原图格距（像素）"],
                  ["originX", "原图起点 X"],
                  ["originY", "原图起点 Y"],
                  ["columns", "原图列数"],
                  ["rows", "原图行数"],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    aria-label={label}
                    type="number"
                    step={key === "columns" || key === "rows" ? "1" : ".01"}
                    value={
                      s.sourceAlignment?.[key] ??
                      (key === "cell"
                        ? dimensions.w / s.width
                        : key === "columns"
                          ? s.width
                          : key === "rows"
                            ? s.height
                            : 0)
                    }
                    onChange={(e) => align(key, +e.target.value)}
                  />
                </label>
              ))}
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.skipCheckerboard ?? false}
                  onChange={(e) =>
                    update({ skipCheckerboard: e.target.checked })
                  }
                />
                忽略图纸中烘焙的灰白棋盘底
              </label>
              <button onClick={() => update({ mode: "normal", fit: "crop" })}>
                返回普通转换
              </button>
            </section>
          )}
          <section className="import-material">
            <h3>色卡与豆子规格</h3>
            <MaterialSettings
              settings={s}
              onChange={update}
              width={s.width}
              height={s.height}
            />
          </section>
          <section>
            <h3>
              1. 图片处理方式 <small>可随时切换</small>
            </h3>
            <div className="placement-modes">
              <button
                className={s.fit === "crop" ? "active" : ""}
                onClick={() => update({ fit: "crop" })}
              >
                <strong>自由裁剪</strong>
                <small>使用常规板，适合想快速完成此图片</small>
              </button>
              <button
                className={s.fit === "contain" ? "active" : ""}
                onClick={() => {
                  const factor = Math.min(
                    1,
                    1000 / Math.max(dimensions.w, dimensions.h),
                  );
                  update({
                    fit: "contain",
                    width: clamp(Math.round(dimensions.w * factor), 16, 1000),
                    height: clamp(Math.round(dimensions.h * factor), 16, 1000),
                  });
                }}
              >
                <strong>原图完整置入</strong>
                <small>尽可能还原原图（最高尺寸接近100%），难度较高</small>
              </button>
            </div>
          </section>
          <section>
            <h3>
              2. 选择常规板尺寸 <small>52 / 78 / 104</small>
            </h3>
            <div className="source-board-presets">
              {[52, 78, 104].map((n) => (
                <button
                  className={s.width === n && s.height === n ? "active" : ""}
                  key={n}
                  onClick={() => update({ width: n, height: n })}
                >
                  <span>
                    {n}×{n} 常规板
                  </span>
                  <strong>
                    {n} × {n}
                  </strong>
                  {n === 104 && <em>推荐</em>}
                </button>
              ))}
            </div>
            <label className="field">自定义板子尺寸</label>
            <div className="dimensions">
              <label>
                宽
                <input
                  aria-label="导入宽度"
                  type="number"
                  value={s.width}
                  onChange={(e) => update({ width: +e.target.value })}
                />
              </label>
              <span>×</span>
              <label>
                高
                <input
                  aria-label="导入高度"
                  type="number"
                  value={s.height}
                  onChange={(e) => update({ height: +e.target.value })}
                />
              </label>
            </div>
            <p className="micro">宽、高可分别设置，范围16–1000</p>
          </section>
          <section>
            <h3>
              3. 确认最大颜色数 <small>{s.limit} / 221 色</small>
            </h3>
            <input
              aria-label="导入最大颜色数"
              type="range"
              min="3"
              max="221"
              value={s.limit}
              onChange={(e) => {
                setAutoColors(false);
                update({ limit: +e.target.value });
              }}
            />
            <label className="check-box">
              <input
                type="checkbox"
                checked={autoColors}
                onChange={(e) => setAutoColors(e.target.checked)}
              />
              <span>
                <b>自动适配色卡</b>
                <small>
                  自动会根据当前图片去做适配色卡优化，用最少的色卡尽可能还原图片；如果需要高还原度建议还是221色哦，可以自行尝试。
                </small>
              </span>
            </label>
            <label className="check-box">
              <input
                type="checkbox"
                checked={!!s.merge}
                onChange={(e) => update({ merge: e.target.checked ? 1 : 0 })}
              />
              <span>
                <b>自动合并少量杂色</b>
                <small>
                  合并极少色号，并清理相近色造成的孤立杂点；深色线条会优先保留。
                </small>
              </span>
            </label>
            <div className="edge-control">
              <label className="field">
                边缘强化{" "}
                <b>
                  强度{" "}
                  <input
                    className="edge-number"
                    type="number"
                    min="0"
                    max="100"
                    value={s.edges}
                    onChange={(e) =>
                      update({ edges: clamp(+e.target.value, 0, 100) })
                    }
                  />{" "}
                  %
                </b>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={s.edges}
                  onChange={(e) => update({ edges: +e.target.value })}
                />
              </label>
              <p className="micro">
                强化图像轮廓并减少边缘杂色；0%不改变原图纸，建议从30%开始尝试；此功能推荐中小图使用，大图或者人像不建议使用。
              </p>
            </div>
            <label className="check-box">
              <input
                type="checkbox"
                checked={s.similar ?? false}
                onChange={(e) => update({ similar: e.target.checked })}
              />
              <span>
                <b>相似色号合并</b>
                <small>
                  生成后按相似度合并接近色号，减少杂色和工作量；相应的还原度会下降哦～生成后可在右侧继续调整。
                </small>
              </span>
            </label>
            <button
              className="full soft"
              onClick={() => update({ limit: 221 })}
            >
              使用推荐221色
            </button>
            <button
              className="handmade-entry"
              onClick={() =>
                update({ mode: s.mode === "simple" ? "normal" : "simple" })
              }
            >
              <span>
                <strong>识别成手搓图</strong>
                <small>
                  功能待完善，目前处于测试阶段；色号相对简易，可尝试一下。
                </small>
                <small>仅限于104×104以内的小图，测试阶段～</small>
              </span>
              <ArrowRight />
            </button>
            <label className="check-box">
              <input
                type="checkbox"
                checked={s.removeLight}
                onChange={(e) => update({ removeLight: e.target.checked })}
              />
              <span>
                <b>仅移除白色/浅色边缘</b>
                <small>
                  适合白底JPG/JPEG；只移除与图片边缘相连的浅色区域，内部白色拼豆会保留。
                </small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={s.smallCleanup}
                onChange={(e) => update({ smallCleanup: e.target.checked })}
              />
              104格以内小图精细清理
            </label>
            <details>
              <summary>更多构图设置</summary>
              <label className="field">
                转换方式
                <select
                  value={s.mode}
                  onChange={(e) =>
                    update({ mode: e.target.value as Settings["mode"] })
                  }
                >
                  <option value="normal">普通转换</option>
                  <option value="simple">手搓图（最多24色）</option>
                  <option value="recognize">已对齐色号图识别</option>
                </select>
              </label>
              <label className="field">
                透明区域
                <select
                  value={s.alpha}
                  onChange={(e) =>
                    update({ alpha: e.target.value as Settings["alpha"] })
                  }
                >
                  <option value="keep">保留为空格</option>
                  <option value="white">铺白色底</option>
                </select>
              </label>
              <label className="field">
                等比缩放
                <input
                  type="range"
                  min="1"
                  max="4"
                  step=".01"
                  value={s.zoom}
                  onChange={(e) => update({ zoom: +e.target.value })}
                />
              </label>
              {(["panX", "panY"] as const).map((key, i) => (
                <label className="field" key={key}>
                  {i ? "垂直位置" : "水平位置"}
                  <input
                    type="range"
                    min="-.5"
                    max=".5"
                    step=".01"
                    value={s[key]}
                    onChange={(e) => update({ [key]: +e.target.value })}
                  />
                </label>
              ))}
            </details>
            <p className="micro">
              支持PNG、JPG、JPEG、WebP。图片会在浏览器本地裁剪，不上传原图。
            </p>
          </section>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <footer>
        <button onClick={onClose}>返回画板</button>
        <button
          className="primary"
          onClick={() => {
            if (
              s.sourceAlignment &&
              (!Number.isFinite(s.sourceAlignment.cell) ||
                s.sourceAlignment.cell <= 0)
            ) {
              setError("原图格距必须大于0");
              return;
            }
            if (
              ![s.width, s.height].every(
                (n) => Number.isInteger(n) && n >= 16 && n <= 1000,
              )
            ) {
              setError("宽高必须是16～1000之间的整数");
              return;
            }
            onGenerate(s);
          }}
        >
          确认裁剪并生成拼豆图
        </button>
      </footer>
    </Dialog>
  );
}
