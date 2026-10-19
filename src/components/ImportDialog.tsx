import { useState, useRef, useEffect, useMemo, type PointerEvent } from "react";
import {
  ArrowsOut,
  Hand,
  Crop,
  ArrowCounterClockwise,
  LockSimple,
  LockSimpleOpen,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Spinner,
} from "@phosphor-icons/react";
import Dialog from "./Dialog";
import MaterialSettings from "./MaterialSettings";
import ImportPreview from "./ImportPreview";
import { analyseGrid } from "../reference-detection";
import type { SourceAlignment } from "../reference-recognition";
import { PALETTE, usage, type Settings } from "../model";
import { verifiedMaterial } from "../material-catalog";
import {
  convertImage,
  conversionError,
  conversionKey,
  matchesConversion,
  type ConversionResult,
} from "../image-conversion";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
type PreviewTask = {
  source: string;
  key: string;
  controller: AbortController;
  promise: Promise<ConversionResult>;
};

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
  onGenerate: (
    s: Settings,
    preview: ConversionResult,
    signal: AbortSignal,
  ) => Promise<void>;
}) {
  const [s, setS] = useState(() => structuredClone(initial));
  const [error, setError] = useState("");
  const [dimensions, setDimensions] = useState({ w: 1, h: 1 });
  const [frameSize, setFrameSize] = useState({ w: 500, h: 360 });
  const [viewZoom, setViewZoom] = useState(1),
    [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false),
    [dragging, setDragging] = useState(false);
  const [autoColors, setAutoColors] = useState(false);
  const [locked, setLocked] = useState(false),
    lockRatio = useRef(initial.width / initial.height);
  const [ready, setReady] = useState(false),
    [submitting, setSubmitting] = useState(false);
  const [analysing, setAnalysing] = useState(false),
    [gridMessage, setGridMessage] = useState("");
  const [preview, setPreview] = useState<{
    result: ConversionResult | null;
    pending: boolean;
    progress: number;
    error: string;
  }>({ result: null, pending: true, progress: 0, error: "" });
  const image = useRef<HTMLImageElement>(null),
    frame = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const active = useRef<PreviewTask | null>(null),
    completed = useRef<ConversionResult | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    disposed = useRef(false),
    submitController = useRef<AbortController | null>(null);
  const drag = useRef<{
    handle: string;
    x: number;
    y: number;
    crop: Settings["crop"];
    pan: typeof viewPan;
  } | null>(null);
  const key = conversionKey(s),
    invalid = conversionError(s);
  const desired = useRef({ source, key });
  desired.current = { source, key };
  const update = (v: Partial<Settings>) => {
    setError("");
    setS((p) => ({ ...p, ...v }));
  };
  const currentResult =
    preview.result && matchesConversion(preview.result, source, s)
      ? preview.result
      : null;
  const counts = useMemo(
    () => (currentResult ? usage(currentResult.cells) : null),
    [currentResult],
  );
  const total = counts?.reduce((n, [, count]) => n + count, 0);
  const material = verifiedMaterial(s.materialSpec);
  const pending =
    ready &&
    !invalid &&
    (preview.pending || (!currentResult && !preview.error));

  function startPreview(
    snapshot: Settings,
    retry = false,
  ): Promise<ConversionResult> {
    const nextKey = conversionKey(snapshot);
    if (
      !retry &&
      completed.current &&
      matchesConversion(completed.current, source, snapshot)
    ) {
      setPreview({
        result: completed.current,
        pending: false,
        progress: 100,
        error: "",
      });
      return Promise.resolve(completed.current);
    }
    if (
      !retry &&
      active.current?.key === nextKey &&
      active.current.source === source
    )
      return active.current.promise;
    active.current?.controller.abort();
    const controller = new AbortController();
    const isLatest = () =>
      !disposed.current &&
      desired.current.source === source &&
      desired.current.key === nextKey &&
      !controller.signal.aborted;
    setPreview((p) => ({ ...p, pending: true, progress: 0, error: "" }));
    const promise = convertImage(source, snapshot, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (isLatest()) setPreview((p) => ({ ...p, progress }));
      },
    })
      .then((result) => {
        if (isLatest()) {
          completed.current = result;
          setPreview({ result, pending: false, progress: 100, error: "" });
        }
        return result;
      })
      .catch((e) => {
        if (isLatest())
          setPreview((p) => ({
            ...p,
            pending: false,
            error: e instanceof Error ? e.message : String(e),
          }));
        throw e;
      })
      .finally(() => {
        if (active.current?.controller === controller) active.current = null;
      });
    active.current = { source, key: nextKey, controller, promise };
    return promise;
  }
  useEffect(() => {
    active.current?.controller.abort();
    active.current = null;
    if (timer.current) clearTimeout(timer.current);
    setPreview((p) => ({
      ...p,
      pending: ready && !invalid,
      progress: 0,
      error: invalid,
    }));
    if (ready && !invalid && !dragging) {
      timer.current = setTimeout(() => {
        timer.current = null;
        void startPreview(s).catch(() => {});
      }, 220);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [source, key, ready, dragging]);
  useEffect(
    () => () => {
      disposed.current = true;
      active.current?.controller.abort();
      submitController.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const ro = new ResizeObserver(([entry]) =>
      setFrameSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    if (frame.current) ro.observe(frame.current);
    return () => ro.disconnect();
  }, []);
  // Preserve the existing local color-cap heuristic; this is not AI analysis.
  useEffect(() => {
    if (!autoColors || !ready || !image.current || invalid) return;
    const crop = s.fit === "crop" ? s.crop : { x: 0, y: 0, w: 1, h: 1 };
    const scale = 96 / Math.max(crop.w * dimensions.w, crop.h * dimensions.h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.w * dimensions.w * scale));
    canvas.height = Math.max(1, Math.round(crop.h * dimensions.h * scale));
    const context = canvas.getContext("2d")!;
    context.drawImage(
      image.current,
      crop.x * dimensions.w,
      crop.y * dimensions.h,
      crop.w * dimensions.w,
      crop.h * dimensions.h,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    canvas.width = canvas.height = 0;
    const colors = new Set<string>();
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] >= 32)
        colors.add(
          `${pixels[i] >> 4}-${pixels[i + 1] >> 4}-${pixels[i + 2] >> 4}`,
        );
    const target = clamp(Math.round(18 + Math.sqrt(colors.size) * 6), 24, 160);
    const limit = [24, 32, 48, 64, 80, 96, 128, 160].reduce(
      (a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a),
      24,
    );
    setS((previous) =>
      previous.limit === limit ? previous : { ...previous, limit },
    );
  }, [autoColors, ready, s.crop, s.fit, dimensions]);
  function close() {
    disposed.current = true;
    active.current?.controller.abort();
    submitController.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    onClose();
  }
  async function confirm() {
    if (invalid || !ready || submitting) return;
    const snapshot = structuredClone(s),
      controller = new AbortController();
    submitController.current = controller;
    if (timer.current) clearTimeout(timer.current);
    setSubmitting(true);
    setError("");
    try {
      const result = await startPreview(snapshot);
      controller.signal.throwIfAborted();
      if (
        disposed.current ||
        desired.current.key !== conversionKey(snapshot) ||
        !matchesConversion(result, source, snapshot)
      )
        throw Error("参数已变化，请等待最新预览");
      await onGenerate(snapshot, result, controller.signal);
    } catch (e) {
      if (!disposed.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!disposed.current) setSubmitting(false);
    }
  }
  function dimension(axis: "width" | "height", value: number) {
    const patch = { [axis]: value } as Partial<Settings>;
    if (locked && Number.isInteger(value) && value >= 16 && value <= 1000) {
      let w = axis === "width" ? value : Math.round(value * lockRatio.current);
      let h = axis === "height" ? value : Math.round(value / lockRatio.current);
      if (h > 1000) {
        h = 1000;
        w = Math.round(h * lockRatio.current);
      }
      if (w > 1000) {
        w = 1000;
        h = Math.round(w / lockRatio.current);
      }
      if (h < 16) {
        h = 16;
        w = Math.round(h * lockRatio.current);
      }
      if (w < 16) {
        w = 16;
        h = Math.round(w / lockRatio.current);
      }
      patch.width = clamp(w, 16, 1000);
      patch.height = clamp(h, 16, 1000);
    }
    update(patch);
  }
  function numericCrop(axis: keyof Settings["crop"], percent: number) {
    if (!Number.isFinite(percent)) return;
    const c = { ...s.crop },
      minW = 1 / dimensions.w,
      minH = 1 / dimensions.h;
    c[axis] =
      axis === "x"
        ? clamp(percent / 100, 0, 1 - c.w)
        : axis === "y"
          ? clamp(percent / 100, 0, 1 - c.h)
          : axis === "w"
            ? clamp(percent / 100, minW, 1 - c.x)
            : clamp(percent / 100, minH, 1 - c.y);
    update({ crop: c });
  }
  async function detect(imageElement = image.current) {
    if (!imageElement || analysing) return;
    setAnalysing(true);
    try {
      const guess = await analyseGrid(imageElement),
        a = guess.alignment;
      if (disposed.current) return;
      if (!a) {
        setGridMessage("未检测到稳定网格，请手动调整格距和起点。");
        update({ mode: "recognize", fit: "contain" });
      } else {
        update({
          mode: "recognize",
          fit: "contain",
          width: clamp(a.columns, 16, 1000),
          height: clamp(a.rows, 16, 1000),
          sourceAlignment: {
            ...a,
            columns: Math.min(1000, a.columns),
            rows: Math.min(1000, a.rows),
          },
        });
        setGridMessage(`已检测网格：${a.columns} × ${a.rows} 格`);
      }
    } catch (e) {
      if (!disposed.current) setError(String(e));
    } finally {
      if (!disposed.current) setAnalysing(false);
    }
  }
  function align(axis: keyof SourceAlignment, value: number) {
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
        [axis]: value,
      },
    });
  }
  const ratio =
    Math.min(
      (frameSize.w - 32) / dimensions.w,
      (frameSize.h - 32) / dimensions.h,
    ) * viewZoom;
  const displayW = dimensions.w * ratio,
    displayH = dimensions.h * ratio;
  const left = (frameSize.w - displayW) / 2 + viewPan.x,
    top = (frameSize.h - displayH) / 2 + viewPan.y;
  const fitView = () => {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  };
  function down(e: PointerEvent, handle: string) {
    if (submitting || !ready || (s.fit !== "crop" && handle !== "pan")) return;
    e.preventDefault();
    e.stopPropagation();
    frame.current?.setPointerCapture(e.pointerId);
    const action = panMode ? "pan" : handle;
    drag.current = {
      handle: action,
      x: e.clientX,
      y: e.clientY,
      crop: { ...s.crop },
      pan: viewPan,
    };
    if (action !== "pan") setDragging(true);
  }
  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.handle === "pan") {
      setViewPan({
        x: d.pan.x + e.clientX - d.x,
        y: d.pan.y + e.clientY - d.y,
      });
      return;
    }
    const dx = (e.clientX - d.x) / displayW,
      dy = (e.clientY - d.y) / displayH;
    const minW = Math.min(16, dimensions.w) / dimensions.w,
      minH = Math.min(16, dimensions.h) / dimensions.h;
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
  function endDrag() {
    drag.current = null;
    setDragging(false);
  }
  const previewError = invalid || preview.error;
  return (
    <Dialog title="上传图片并设置板子" onClose={close} wide>
      <div className="import-body">
        <div className="upload-title-row">
          <span title={name}>
            {name}{" "}
            {ready && (
              <>
                · {dimensions.w} × {dimensions.h} px
              </>
            )}
          </span>
          <span className="micro">本地处理，不上传原图</span>
          <button disabled={submitting} onClick={() => file.current?.click()}>
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
              try {
                const { readImage } = await import("../storage"),
                  url = await readImage(f);
                if (disposed.current) return;
                close();
                window.dispatchEvent(
                  new CustomEvent("xing-replace-upload", {
                    detail: { source: url, name: f.name },
                  }),
                );
              } catch (e) {
                if (!disposed.current)
                  setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        </div>
        <div className="import-workspace">
          <section className="import-pane" aria-label="原图裁剪">
            <div className="import-pane-title">
              <h3>原图裁剪</h3>
              <span>
                {s.fit === "crop" ? "保留选框内的内容" : "完整置入，不拉伸"}
              </span>
            </div>
            <div
              className="source-crop-frame"
              ref={frame}
              onPointerDown={(e) => down(e, "pan")}
              onPointerMove={move}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
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
                  onError={() => {
                    setReady(false);
                    setError("图片解码失败，请换一张图片");
                  }}
                  onLoad={(e) => {
                    setDimensions({
                      w: e.currentTarget.naturalWidth,
                      h: e.currentTarget.naturalHeight,
                    });
                    fitView();
                    setReady(true);
                    if (s.mode === "recognize" && !s.sourceAlignment)
                      void detect(e.currentTarget);
                  }}
                />
                {s.fit === "crop" && (
                  <div
                    className="source-crop-box"
                    data-crop={JSON.stringify(s.crop)}
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
                          disabled={submitting}
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
                {panMode
                  ? "拖动平移视图"
                  : s.fit === "crop"
                    ? "拖动选框和边缘把手"
                    : "原图完整置入"}
              </span>
            </div>
            <div className="import-view-tools">
              <button
                className={!panMode ? "active" : ""}
                disabled={submitting}
                onClick={() => setPanMode(false)}
                title="移动和调整裁剪框"
              >
                <Crop size={17} />
                裁剪
              </button>
              <button
                className={panMode ? "active" : ""}
                disabled={submitting}
                onClick={() => setPanMode(true)}
                title="平移原图查看区域"
              >
                <Hand size={17} />
                移图
              </button>
              <button
                className="icon-button"
                aria-label="缩小原图视图"
                title="缩小原图视图"
                disabled={submitting || viewZoom <= 1}
                onClick={() => setViewZoom((v) => Math.max(1, v / 1.4))}
              >
                <MagnifyingGlassMinus size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="放大原图视图"
                title="放大原图视图"
                disabled={submitting || viewZoom >= 8}
                onClick={() => setViewZoom((v) => Math.min(8, v * 1.4))}
              >
                <MagnifyingGlassPlus size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="适应原图窗口"
                title="适应原图窗口"
                onClick={fitView}
              >
                <ArrowsOut size={18} />
              </button>
            </div>
            <div className="import-crop-options">
              <button
                disabled={submitting}
                className={s.fit === "crop" ? "active" : ""}
                onClick={() => update({ fit: "crop" })}
              >
                自由裁剪
              </button>
              <button
                disabled={submitting}
                className={s.fit === "contain" ? "active" : ""}
                onClick={() =>
                  update({
                    fit: "contain",
                    zoom: 1,
                    panX: 0,
                    panY: 0,
                    alignX: 0,
                    alignY: 0,
                  })
                }
              >
                原图完整置入
              </button>
              <button
                disabled={submitting}
                title="重置取景范围和构图位置"
                onClick={() => {
                  update({
                    crop: { x: 0, y: 0, w: 1, h: 1 },
                    zoom: 1,
                    panX: 0,
                    panY: 0,
                  });
                  fitView();
                }}
              >
                <ArrowCounterClockwise size={16} />
                重置裁剪
              </button>
            </div>
          </section>
          <ImportPreview
            result={preview.result}
            pending={pending}
            progress={preview.progress}
            error={previewError}
            onRetry={() => {
              if (ready && !invalid) void startPreview(s, true).catch(() => {});
            }}
          />
        </div>
        <p className="import-composition-hint">
          放大主体可改善局部细节；增加格数会增大成品尺寸和用豆量。
        </p>
        <fieldset className="import-settings" disabled={submitting}>
          <section className="import-grid-settings">
            <div className="import-section-title">
              <h3>输出网格</h3>
              <button
                className={"icon-button " + (locked ? "active" : "")}
                disabled={
                  !Number.isFinite(s.width / s.height) ||
                  s.width < 16 ||
                  s.height < 16
                }
                aria-label="锁定网格宽高比例"
                aria-pressed={locked}
                title={locked ? "解除网格比例锁定" : "按当前宽高比例锁定"}
                onClick={() => {
                  lockRatio.current = s.width / s.height || 1;
                  setLocked(!locked);
                }}
              >
                {locked ? (
                  <LockSimple size={18} />
                ) : (
                  <LockSimpleOpen size={18} />
                )}
              </button>
            </div>
            <div className="dimensions">
              <label>
                宽度
                <input
                  aria-label="导入宽度"
                  type="number"
                  min="16"
                  max="1000"
                  value={s.width || ""}
                  onChange={(e) => dimension("width", +e.target.value)}
                />
                <span>格</span>
              </label>
              <b>×</b>
              <label>
                高度
                <input
                  aria-label="导入高度"
                  type="number"
                  min="16"
                  max="1000"
                  value={s.height || ""}
                  onChange={(e) => dimension("height", +e.target.value)}
                />
                <span>格</span>
              </label>
            </div>
            <div className="import-size-presets">
              {[52, 78, 104, 120].map((n) => (
                <button
                  key={n}
                  onClick={() =>
                    locked
                      ? dimension("width", n)
                      : update({ width: n, height: n })
                  }
                >
                  {n}
                </button>
              ))}
              <span>{locked ? "已锁定比例" : "宽高独立 · 16–1000格"}</span>
            </div>
          </section>
          <section className="import-color-settings">
            <h3>最大颜色数</h3>
            <div className="import-color-limit">
              <input
                type="range"
                aria-label="导入最大颜色数"
                min="3"
                max={PALETTE.length}
                value={s.limit}
                onChange={(e) => {
                  setAutoColors(false);
                  update({ limit: +e.target.value });
                }}
              />
              <input
                type="number"
                aria-label="最大颜色数数值"
                min="3"
                max={PALETTE.length}
                value={s.limit || ""}
                onChange={(e) => {
                  setAutoColors(false);
                  update({ limit: +e.target.value });
                }}
              />
            </div>
            <p className="micro">
              最多 {PALETTE.length} 色；实际颜色数取决于最新预览。
            </p>
            <p className="micro">裁剪决定保留内容；网格决定行列和细节。</p>
          </section>
          <section className="import-material">
            <h3>豆子规格</h3>
            <MaterialSettings
              settings={s}
              onChange={update}
              width={s.width}
              height={s.height}
              compact
            />
          </section>
        </fieldset>
        <div
          className={
            "import-summary" +
            (currentResult && !pending && !previewError ? "" : " outdated")
          }
          aria-label="制作信息"
        >
          <div>
            <span>预计成品尺寸</span>
            <strong>
              {material && !invalid
                ? `${((s.width * material.beadSizeMm) / 10).toFixed(1)} × ${((s.height * material.beadSizeMm) / 10).toFixed(1)} cm`
                : "请先选择有效规格"}
            </strong>
          </div>
          <div>
            <span>实际使用颜色</span>
            <strong>
              {currentResult && !pending && !previewError
                ? counts!.length
                : "—"}
              <small>色</small>
            </strong>
          </div>
          <div>
            <span>有效用豆量</span>
            <strong>
              {currentResult && !pending && !previewError
                ? total!.toLocaleString()
                : "—"}
              <small>颗</small>
            </strong>
          </div>
          <p>按格数与豆子尺寸估算，未计板间隙及熨烫收缩</p>
        </div>
        <details className="import-advanced">
          <summary>高级参数与精确裁剪</summary>
          <fieldset disabled={submitting}>
            <div className="import-advanced-grid">
              <section>
                <h3>裁剪范围（原图百分比）</h3>
                <div className="import-crop-numbers">
                  {(
                    [
                      ["x", "左侧"],
                      ["y", "顶部"],
                      ["w", "区域宽"],
                      ["h", "区域高"],
                    ] as const
                  ).map(([axis, label]) => (
                    <label key={axis}>
                      {label}
                      <input
                        aria-label={"裁剪" + label + "百分比"}
                        type="number"
                        disabled={s.fit !== "crop"}
                        min="0"
                        max="100"
                        step=".1"
                        value={Math.round(s.crop[axis] * 100000) / 1000}
                        onChange={(e) => numericCrop(axis, +e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <p className="micro">
                  当前保留{" "}
                  {Math.round((s.fit === "crop" ? s.crop.w : 1) * dimensions.w)}{" "}
                  ×{" "}
                  {Math.round((s.fit === "crop" ? s.crop.h : 1) * dimensions.h)}{" "}
                  px；数值与选框同步。
                </p>
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
                  构图缩放 · {Math.round(s.zoom * 100)}%
                  <input
                    aria-label="构图缩放"
                    type="range"
                    min="1"
                    max="4"
                    step=".01"
                    value={s.zoom}
                    onChange={(e) => update({ zoom: +e.target.value })}
                  />
                </label>
                {(["panX", "panY"] as const).map((axis, i) => (
                  <label className="field" key={axis}>
                    {i ? "构图垂直位置" : "构图水平位置"}
                    <input
                      type="range"
                      min="-.5"
                      max=".5"
                      step=".01"
                      value={s[axis]}
                      onChange={(e) => update({ [axis]: +e.target.value })}
                    />
                  </label>
                ))}
              </section>
              <section>
                <h3>转换与边缘</h3>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={autoColors}
                    onChange={(e) => setAutoColors(e.target.checked)}
                  />
                  自动适配最大颜色数
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!s.merge}
                    onChange={(e) =>
                      update({ merge: e.target.checked ? 1 : 0 })
                    }
                  />
                  自动合并少量杂色
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!s.similar}
                    onChange={(e) => update({ similar: e.target.checked })}
                  />
                  相似色号合并
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={s.removeLight}
                    onChange={(e) => update({ removeLight: e.target.checked })}
                  />
                  仅移除白色／浅色边缘
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={s.smallCleanup}
                    onChange={(e) => update({ smallCleanup: e.target.checked })}
                  />
                  104格以内小图精细清理
                </label>
                <label className="field">
                  边缘强化 · {s.edges}%
                  <input
                    aria-label="边缘强化"
                    type="range"
                    min="0"
                    max="100"
                    value={s.edges}
                    onChange={(e) => update({ edges: +e.target.value })}
                  />
                </label>
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
                <p className="micro">
                  高级参数参与同一预览链路；图纸亮度等调节仍在生成后单独处理。
                </p>
              </section>
              <section className="source-recognition-fields">
                <h3>已有图纸识别与对齐</h3>
                <button disabled={analysing} onClick={() => void detect()}>
                  {analysing ? "正在分析网格…" : "自动检测原图网格"}
                </button>
                <p className="micro">
                  {gridMessage || "用于已有像素图或色号图，不做人物主体识别。"}
                </p>
                {s.mode === "recognize" && (
                  <>
                    {(
                      [
                        ["cell", "原图格距（像素）"],
                        ["originX", "原图起点 X"],
                        ["originY", "原图起点 Y"],
                        ["columns", "原图列数"],
                        ["rows", "原图行数"],
                      ] as const
                    ).map(([axis, label]) => (
                      <label className="field" key={axis}>
                        {label}
                        <input
                          aria-label={label}
                          type="number"
                          step={
                            axis === "columns" || axis === "rows" ? "1" : ".01"
                          }
                          value={
                            s.sourceAlignment?.[axis] ??
                            (axis === "cell"
                              ? dimensions.w / s.width
                              : axis === "columns"
                                ? s.width
                                : axis === "rows"
                                  ? s.height
                                  : 0)
                          }
                          onChange={(e) => align(axis, +e.target.value)}
                        />
                      </label>
                    ))}
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!s.skipCheckerboard}
                        onChange={(e) =>
                          update({ skipCheckerboard: e.target.checked })
                        }
                      />
                      忽略烘焙的灰白棋盘底
                    </label>
                  </>
                )}
              </section>
            </div>
          </fieldset>
        </details>
        {error && (
          <p className="error import-error" role="alert">
            {error}
          </p>
        )}
        {invalid && (
          <p className="error import-error" role="alert">
            {invalid}
          </p>
        )}
      </div>
      <footer className="import-footer">
        <span className="micro">
          {submitting ? (
            <>
              <Spinner className="spin" size={15} />
              正在等待最新结果并生成…
            </>
          ) : pending ? (
            "确认时会等待当前参数的最新预览"
          ) : previewError ? (
            "请修正参数或重试预览"
          ) : (
            "预览与确认生成使用同一份网格"
          )}
        </span>
        <button onClick={close}>取消</button>
        <button
          className="primary"
          disabled={submitting || !ready || !!invalid || analysing}
          onClick={() => void confirm()}
        >
          {submitting ? "正在生成…" : "确认生成"}
        </button>
      </footer>
    </Dialog>
  );
}
