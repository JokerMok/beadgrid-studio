import { useEffect, useRef, useState, type PointerEvent } from "react";
import Dialog from "./Dialog";
import { PALETTE, type Project } from "../model";
import { outlineMask } from "../small-pattern";
export default function OutlineDialog({
  project: p,
  onClose,
  onApply,
}: {
  project: Project;
  onClose: () => void;
  onApply: (cells: Int16Array) => void;
}) {
  const [mask, setMask] = useState<Uint8Array>(
      () => new Uint8Array(p.cells.length),
    ),
    [color, setColor] = useState(PALETTE.findIndex((c) => c.code === "H7")),
    [threshold, setThreshold] = useState(100),
    [mode, setMode] = useState<"draw" | "erase" | "pan">("draw"),
    [zoom, setZoom] = useState(1),
    [compare, setCompare] = useState(false),
    [history, setHistory] = useState<Uint8Array[]>([]),
    canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    drag = useRef<{
      x: number;
      y: number;
      mask: Uint8Array;
      original: Uint8Array;
      clientX: number;
      clientY: number;
    } | null>(null),
    [base, setBase] = useState(1);
  const selected = mask.reduce((n, c) => n + c, 0),
    density = Math.max(
      1,
      Math.min(8, Math.floor(2048 / Math.max(p.width, p.height))),
    );
  useEffect(() => {
    if (viewport.current)
      setBase(
        Math.max(
          0.05,
          Math.min(
            12,
            (viewport.current.clientWidth - 24) / p.width,
            (viewport.current.clientHeight - 24) / p.height,
          ),
        ),
      );
  }, [p.width, p.height]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = p.width * density;
    c.height = p.height * density;
    const g = c.getContext("2d")!;
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        const i = y * p.width + x,
          index = !compare && mask[i] ? color : p.cells[i];
        if (index >= 0) {
          g.fillStyle = PALETTE[index].hex;
          g.fillRect(x * density, y * density, density, density);
        }
      }
    if (base * zoom > 9 && density >= 2) {
      g.strokeStyle = "rgba(120,157,149,.28)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= p.width; x++) {
        g.moveTo(x * density + 0.5, 0);
        g.lineTo(x * density + 0.5, c.height);
      }
      for (let y = 0; y <= p.height; y++) {
        g.moveTo(0, y * density + 0.5);
        g.lineTo(c.width, y * density + 0.5);
      }
      g.stroke();
    }
    if (!compare) {
      g.strokeStyle = "#18b991";
      g.lineWidth = Math.max(1, density * 0.12);
      for (let i = 0; i < mask.length; i++)
        if (mask[i])
          g.strokeRect(
            (i % p.width) * density + 0.5,
            Math.floor(i / p.width) * density + 0.5,
            density - 1,
            density - 1,
          );
    }
  }, [p, mask, color, compare, zoom, base, density]);
  const remember = (v: Uint8Array) =>
    setHistory((h) => [...h, v.slice()].slice(-30));
  const point = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          p.width - 1,
          Math.floor(((e.clientX - r.left) / r.width) * p.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          p.height - 1,
          Math.floor(((e.clientY - r.top) / r.height) * p.height),
        ),
      ),
    };
  };
  function paint(
    a: { x: number; y: number },
    b: { x: number; y: number },
    m: Uint8Array,
  ) {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let n = 0; n <= steps; n++) {
      const x = steps ? Math.round(a.x + ((b.x - a.x) * n) / steps) : a.x,
        y = steps ? Math.round(a.y + ((b.y - a.y) * n) / steps) : a.y;
      m[y * p.width + x] = mode === "erase" ? 0 : 1;
    }
    setMask(m.slice());
  }
  function down(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const q = point(e);
    drag.current = {
      ...q,
      mask: mask.slice(),
      original: mask.slice(),
      clientX: e.clientX,
      clientY: e.clientY,
    };
    if (mode !== "pan") {
      e.preventDefault();
      setCompare(false);
      paint(q, q, drag.current.mask);
    }
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    if (mode === "pan") {
      viewport.current!.scrollLeft += d.clientX - e.clientX;
      viewport.current!.scrollTop += d.clientY - e.clientY;
      d.clientX = e.clientX;
      d.clientY = e.clientY;
      return;
    }
    const q = point(e);
    paint(d, q, d.mask);
    d.x = q.x;
    d.y = q.y;
  }
  return (
    <Dialog title="识别 / 手绘边缘，统一色号" wide onClose={onClose}>
      <div className="outline-description">
        只修改选中的边缘格子，内部色块和画板尺寸不变。确认后可撤销。
      </div>
      <div className="outline-settings">
        <label className="field">
          统一边缘色号
          <select
            aria-label="统一边缘色号"
            value={color}
            onChange={(e) => {
              setColor(+e.target.value);
              setCompare(false);
            }}
          >
            {PALETTE.map((c, i) => (
              <option key={c.code} value={i}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="outline-detect">
          <button
            className="primary"
            onClick={() => {
              remember(mask);
              setMask(outlineMask(p.cells, p.width, p.height, threshold));
              setCompare(false);
            }}
          >
            自动识别外围描线
          </button>
          <label className="field">
            描线识别范围
            <input
              aria-label="描线识别范围"
              type="range"
              min="45"
              max="145"
              value={threshold}
              onChange={(e) => setThreshold(+e.target.value)}
            />
          </label>
          <small>识别与外部背景相邻的深色描线。可用画笔补选、橡皮擦除。</small>
        </div>
        <div className="outline-tools">
          {(["draw", "erase", "pan"] as const).map((v, i) => (
            <button
              key={v}
              className={mode === v ? "soft" : ""}
              onClick={() => setMode(v)}
            >
              {["手动绘制边缘", "擦除选取", "移动查看"][i]}
            </button>
          ))}
          <button
            disabled={!history.length}
            onClick={() => {
              setMask(history.at(-1)!);
              setHistory((h) => h.slice(0, -1));
            }}
          >
            撤回上一步
          </button>
          <button
            disabled={!selected}
            onClick={() => {
              remember(mask);
              setMask(new Uint8Array(mask.length));
            }}
          >
            清空选区
          </button>
        </div>
      </div>
      <div className="outline-zoom">
        <button onClick={() => setZoom((z) => Math.max(0.5, z / 1.4))}>
          缩小
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(12, z * 1.4))}>
          放大
        </button>
        <button
          className={compare ? "soft" : ""}
          onClick={() => setCompare(!compare)}
        >
          对照修改前
        </button>
      </div>
      <div className="outline-viewport" ref={viewport}>
        <canvas
          ref={canvas}
          aria-label="边缘选区绘制画板"
          style={{
            width: Math.round(p.width * base * zoom),
            height: Math.round(p.height * base * zoom),
            touchAction: mode === "pan" ? "auto" : "none",
            cursor: mode === "pan" ? "grab" : "crosshair",
          }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => {
            if (drag.current && mode !== "pan") remember(drag.current.original);
            drag.current = null;
          }}
          onPointerCancel={() => (drag.current = null)}
        />
      </div>
      <footer>
        <p role="status">
          {selected
            ? `已选 ${selected} 格 → ${PALETTE[color].code} · ${p.width} × ${p.height} 格`
            : "尚未选取边缘：点击自动识别，或直接在图上描画。"}
        </p>
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          disabled={!selected || p.settings.disabled.includes(color)}
          onClick={() => onApply(p.cells.map((v, i) => (mask[i] ? color : v)))}
        >
          应用统一边缘色号
        </button>
      </footer>
      {p.settings.disabled.includes(color) && (
        <p className="error">此色号已禁用，请选择其他边缘色号。</p>
      )}
    </Dialog>
  );
}
