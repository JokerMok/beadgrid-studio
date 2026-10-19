import { useEffect, useRef, useState } from "react";
import {
  ArrowsOut,
  GridFour,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Spinner,
} from "@phosphor-icons/react";
import { rgb } from "../model";
import type { ConversionResult } from "../image-conversion";

export default function ImportPreview({
  result,
  pending,
  progress,
  error,
  onRetry,
}: {
  result: ConversionResult | null;
  pending: boolean;
  progress: number;
  error: string;
  onRetry: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 480, h: 360 });
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [grid, setGrid] = useState(false);
  const drag = useRef<{ x: number; y: number; pan: typeof pan } | null>(null);
  const fit = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(fit, [result?.width, result?.height]);
  useEffect(() => {
    const node = canvas.current;
    if (!result || !node) return;
    node.width = result.width;
    node.height = result.height;
    const context = node.getContext("2d")!;
    const pixels = context.createImageData(result.width, result.height);
    for (let i = 0; i < result.cells.length; i++) {
      const color = result.cells[i];
      if (color < 0) continue;
      const offset = i * 4;
      pixels.data[offset] = rgb[color][0];
      pixels.data[offset + 1] = rgb[color][1];
      pixels.data[offset + 2] = rgb[color][2];
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
  }, [result]);
  const width = result?.width || 1,
    height = result?.height || 1;
  const cell =
    Math.max(0.01, Math.min((size.w - 32) / width, (size.h - 32) / height)) *
    zoom;
  function scale(next: number, anchor?: { x: number; y: number }) {
    next = Math.max(1, Math.min(24, next));
    const factor = next / zoom,
      x = anchor?.x || 0,
      y = anchor?.y || 0;
    setPan({ x: (pan.x - x) * factor + x, y: (pan.y - y) * factor + y });
    setZoom(next);
  }

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      scale(zoom * (event.deltaY < 0 ? 1.18 : 1 / 1.18), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [zoom, pan]);

  return (
    <section className="import-pane import-preview-pane" aria-label="拼豆预览">
      <div className="import-pane-title">
        <h3>拼豆预览</h3>
        <span
          className={
            pending ? "preview-updating" : error ? "error" : "preview-ready"
          }
          role="status"
        >
          {pending ? (
            <>
              <Spinner className="spin" size={14} />
              正在更新预览 {progress > 0 ? `${progress}%` : ""}
            </>
          ) : error ? (
            "预览未完成"
          ) : result ? (
            "预览已更新"
          ) : (
            "等待图片"
          )}
        </span>
      </div>
      <div
        ref={viewport}
        className="import-preview-viewport"
        data-state={
          pending ? "updating" : error ? "error" : result ? "ready" : "empty"
        }
        onPointerDown={(e) => {
          if (!result) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, pan };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d)
            setPan({
              x: d.pan.x + e.clientX - d.x,
              y: d.pan.y + e.clientY - d.y,
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {result ? (
          <div
            className={
              "import-preview-paper" + (pending || error ? " stale" : "")
            }
            style={{
              width: width * cell,
              height: height * cell,
              left: (size.w - width * cell) / 2 + pan.x,
              top: (size.h - height * cell) / 2 + pan.y,
            }}
          >
            <canvas
              ref={canvas}
              aria-label="实际拼豆预览"
              data-settings={result.settingsKey}
            />
            {grid && cell >= 3 && (
              <div
                className="import-preview-grid"
                style={{ backgroundSize: `${cell}px ${cell}px` }}
              />
            )}
          </div>
        ) : (
          <div className="import-preview-empty">
            <GridFour size={36} />
            <p>{error ? "暂时无法生成预览" : "正在准备拼豆预览"}</p>
            <span>与最终图纸使用相同色卡和转换规则</span>
          </div>
        )}
        {(pending || error) && result && (
          <span className="import-preview-stale">
            {error ? "预览失败 · 下方可重试" : "上次预览 · 等待更新"}
          </span>
        )}
      </div>
      <div className="import-view-tools">
        <button
          className="icon-button"
          title="缩小预览"
          aria-label="缩小预览"
          disabled={!result || zoom <= 1}
          onClick={() => scale(zoom / 1.4)}
        >
          <MagnifyingGlassMinus size={18} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          className="icon-button"
          title="放大预览"
          aria-label="放大预览"
          disabled={!result || zoom >= 24}
          onClick={() => scale(zoom * 1.4)}
        >
          <MagnifyingGlassPlus size={18} />
        </button>
        <button
          title="适应预览窗口"
          aria-label="适应预览窗口"
          onClick={fit}
          disabled={!result}
        >
          <ArrowsOut size={17} />
          适应
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={grid}
            onChange={(e) => setGrid(e.target.checked)}
          />
          网格线
        </label>
      </div>
      <p className="import-pane-note">
        {error ? (
          <>
            <span className="error">{error}</span>
            <button onClick={onRetry}>重试预览</button>
          </>
        ) : (
          "拖动平移，滚轮或按钮缩放；放大查看局部细节。"
        )}
      </p>
    </section>
  );
}
