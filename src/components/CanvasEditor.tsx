import { drawIron } from "../ironing";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { PALETTE, connected, type Project, type Tool } from "../model";
type Props = {
  guest?: boolean;
  project: Project;
  tool: Tool;
  color: number;
  brush: number;
  zoom: number;
  setZoom: (z: number) => void;
  selection: Set<number>;
  setSelection: (s: Set<number>) => void;
  checkpoint: () => void;
  change: (p: Project) => void;
  onCursor: (s: string) => void;
  fitKey: number;
  crop?: {
    rect: { x: number; y: number; w: number; h: number };
    onChange: (rect: { x: number; y: number; w: number; h: number }) => void;
    onAuto: () => void;
    onConfirm: () => void;
    onCancel: () => void;
  };
};
export default function CanvasEditor({
  guest = false,
  project: p,
  tool,
  color,
  brush,
  zoom,
  setZoom,
  selection,
  setSelection,
  checkpoint,
  change,
  onCursor,
  fitKey,
  crop,
}: Props) {
  const regionRules = useMemo(
    () =>
      (p.colorRules || []).map((r) => ({
        colors: new Set(r.colors),
        indices: new Set(r.indices),
      })),
    [p.colorRules],
  );
  const regionAllows = (i: number) =>
    !regionRules.some((r) => r.colors.has(color) && r.indices.has(i));
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    [size, setSize] = useState({ w: 800, h: 650 }),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [path, setPath] = useState<{ x: number; y: number }[]>([]);
  const gesture = useRef<{
      last: { x: number; y: number };
      start: { x: number; y: number };
      pan: { x: number; y: number };
      cells?: Int16Array;
      points: { x: number; y: number }[];
    } | null>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const reference = useRef<HTMLImageElement | null>(null),
    original = useRef<HTMLImageElement | null>(null),
    [loaded, setLoaded] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!p.reference?.url) {
      reference.current = null;
      return;
    }
    const image = new Image();
    image.onload = () => {
      reference.current = image;
      setLoaded((v) => v + 1);
    };
    image.src = p.reference.url;
  }, [p.reference?.url]);
  useEffect(() => {
    original.current = null;
    if (!p.source) return;
    const image = new Image();
    image.onload = () => {
      original.current = image;
      setLoaded((v) => v + 1);
    };
    image.src = p.source;
  }, [p.source]);
  const marginNative = p.grid.coordinates ? 30 : 2,
    long = Math.max(p.width, p.height),
    limit = innerWidth <= 820 ? 12000000 : 64000000,
    maxEdge = innerWidth <= 820 ? 4096 : 8192,
    baseCell = Math.max(
      1,
      Math.min(
        Math.max(24, 860 / long),
        Math.max(
          1,
          Math.min(
            (maxEdge - marginNative * 2) / long,
            Math.sqrt(limit / (p.width * p.height)),
          ),
        ),
        Math.sqrt(limit / (p.width * p.height)) * 0.998,
      ),
    ),
    nativeWidth = Math.round(marginNative * 2 + p.width * baseCell),
    nativeHeight = Math.round(marginNative * 2 + p.height * baseCell),
    displayBase = Math.max(
      80,
      Math.min(size.w - 64, ((size.h - 64) * nativeWidth) / nativeHeight),
    ),
    displayWidth = displayBase * zoom,
    ratio = displayWidth / nativeWidth,
    cell = baseCell * ratio,
    margin = marginNative * ratio;
  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [p.width, p.height]);
  useEffect(() => {
    if (fitKey) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
    }
  }, [fitKey]);
  const origin = {
    x: (size.w - displayWidth) / 2 + pan.x + margin,
    y: (size.h - nativeHeight * ratio) / 2 + pan.y + margin,
  };
  const cropDrag = useRef<{
    edge: string;
    rect: { x: number; y: number; w: number; h: number };
    x: number;
    y: number;
  } | null>(null);
  function cropPoint(e: ReactPointerEvent<HTMLElement>) {
    const r = host.current!.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left - origin.x) / cell),
      y: Math.round((e.clientY - r.top - origin.y) / cell),
    };
  }
  function cropDown(e: ReactPointerEvent<HTMLElement>, edge: string) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    cropDrag.current = { edge, rect: { ...crop!.rect }, ...cropPoint(e) };
  }
  function cropMove(e: ReactPointerEvent<HTMLElement>) {
    const d = cropDrag.current;
    if (!d || !crop) return;
    const q = cropPoint(e),
      r = { ...d.rect },
      clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    if (d.edge === "move") {
      crop.onChange({
        ...d.rect,
        x: clamp(d.rect.x + q.x - d.x, 0, p.width - d.rect.w),
        y: clamp(d.rect.y + q.y - d.y, 0, p.height - d.rect.h),
      });
      return;
    }
    if (d.edge.includes("w")) {
      r.x = clamp(q.x, 0, d.rect.x + d.rect.w - 16);
      r.w = d.rect.x + d.rect.w - r.x;
    }
    if (d.edge.includes("e"))
      r.w = clamp(q.x, d.rect.x + 16, p.width) - d.rect.x;
    if (d.edge.includes("n")) {
      r.y = clamp(q.y, 0, d.rect.y + d.rect.h - 16);
      r.h = d.rect.y + d.rect.h - r.y;
    }
    if (d.edge.includes("s"))
      r.h = clamp(q.y, d.rect.y + 16, p.height) - d.rect.y;
    crop.onChange(r);
  }
  function getPoint(event: { clientX: number; clientY: number }) {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: Math.floor((event.clientX - rect.left - origin.x) / cell),
      y: Math.floor((event.clientY - rect.top - origin.y) / cell),
    };
  }
  function drawBrush(
    cells: Int16Array,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let k = 0; k <= distance; k++) {
      const x = distance
          ? Math.round(from.x + ((to.x - from.x) * k) / distance)
          : to.x,
        y = distance
          ? Math.round(from.y + ((to.y - from.y) * k) / distance)
          : to.y;
      for (let dy = 0; dy < brush; dy++)
        for (let dx = 0; dx < brush; dx++) {
          const nx = x + dx - Math.floor((brush - 1) / 2),
            ny = y + dy - Math.floor((brush - 1) / 2),
            i = ny * p.width + nx;
          if (
            nx >= 0 &&
            ny >= 0 &&
            nx < p.width &&
            ny < p.height &&
            (!selection.size || selection.has(i)) &&
            (tool === "eraser" || regionAllows(i))
          )
            cells[i] = tool === "eraser" ? -1 : color;
        }
    }
  }
  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      gesture.current = null;
      return;
    }
    const point = getPoint(e),
      inside =
        point.x >= 0 && point.y >= 0 && point.x < p.width && point.y < p.height,
      i = point.y * p.width + point.x;
    if (tool === "hand" || e.button === 1) {
      gesture.current = {
        last: point,
        start: { x: e.clientX, y: e.clientY },
        pan,
        points: [],
      };
      return;
    }
    if (!inside) return;
    if (tool === "picker") {
      if (p.cells[i] >= 0) onCursor("pick:" + p.cells[i]);
      return;
    }
    if (tool === "magic") {
      setSelection(connected(p.cells, p.width, p.height, i));
      return;
    }
    if (tool === "lasso" || tool === "rectangle") {
      gesture.current = {
        last: point,
        start: { x: e.clientX, y: e.clientY },
        pan,
        points: [point],
      };
      setPath([point]);
      return;
    }
    if (p.settings.disabled.includes(color) && tool !== "eraser") {
      onCursor("该色号已禁用，请选择其他颜色");
      return;
    }
    checkpoint();
    const cells = p.cells.slice();
    if (tool === "fill") {
      for (const n of connected(cells, p.width, p.height, i))
        if ((!selection.size || selection.has(n)) && regionAllows(n))
          cells[n] = color;
      change({ ...p, cells });
      return;
    }
    drawBrush(cells, point, point);
    gesture.current = {
      last: point,
      start: { x: e.clientX, y: e.clientY },
      pan,
      cells,
      points: [],
    };
    change({ ...p, cells });
  }
  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (pointers.current.has(e.pointerId))
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      setZoom(
        Math.max(
          0.1,
          Math.min(
            15,
            (pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
              pinch.current.distance,
          ),
        ),
      );
      return;
    }
    const point = getPoint(e);
    onCursor(
      point.x >= 0 && point.x < p.width && point.y >= 0 && point.y < p.height
        ? `X ${point.x + 1} · Y ${point.y + 1}`
        : "",
    );
    const g = gesture.current;
    if (!g) return;
    if (tool === "hand" || e.buttons === 4) {
      setPan({
        x: g.pan.x + e.clientX - g.start.x,
        y: g.pan.y + e.clientY - g.start.y,
      });
      return;
    }
    if (tool === "lasso" || tool === "rectangle") {
      g.points.push(point);
      setPath([...g.points]);
      return;
    }
    if (g.cells) {
      drawBrush(g.cells, g.last, point);
      g.last = point;
      change({ ...p, cells: g.cells.slice() });
    }
  }
  function up(e: ReactPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const g = gesture.current;
    if (g && tool === "rectangle") {
      const end = g.points.at(-1) || g.last,
        start = g.points[0],
        selection = new Set<number>();
      for (
        let y = Math.max(0, Math.min(start.y, end.y));
        y <= Math.min(p.height - 1, Math.max(start.y, end.y));
        y++
      )
        for (
          let x = Math.max(0, Math.min(start.x, end.x));
          x <= Math.min(p.width - 1, Math.max(start.x, end.x));
          x++
        )
          selection.add(y * p.width + x);
      setSelection(selection);
    }
    if (g && tool === "lasso" && g.points.length > 2) {
      const pts = g.points,
        s = new Set<number>(),
        minX = Math.max(0, Math.min(...pts.map((p) => p.x))),
        maxX = Math.min(p.width - 1, Math.max(...pts.map((p) => p.x))),
        minY = Math.max(0, Math.min(...pts.map((p) => p.y))),
        maxY = Math.min(p.height - 1, Math.max(...pts.map((p) => p.y)));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          let inside = false;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[i],
              b = pts[j];
            if (
              a.y > y !== b.y > y &&
              x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
            )
              inside = !inside;
          }
          if (inside) s.add(y * p.width + x);
        }
      setSelection(s);
    }
    setPath([]);
    gesture.current = null;
  }
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = Math.max(
          0.1,
          Math.min(
            15,
            Math.round(
              (zoom +
                Math.sign(-e.deltaY) * (zoom < 2 ? 0.25 : zoom < 5 ? 0.5 : 1)) *
                100,
            ) / 100,
          ),
        ),
        rect = el.getBoundingClientRect(),
        mx = e.clientX - rect.left,
        my = e.clientY - rect.top,
        factor = next / zoom;
      const left = (size.w - displayWidth) / 2 + pan.x,
        top = (size.h - nativeHeight * ratio) / 2 + pan.y,
        newLeft = (size.w - displayBase * next) / 2,
        newTop =
          (size.h - (nativeHeight * displayBase * next) / nativeWidth) / 2;
      setPan({
        x: mx - (mx - left) * factor - newLeft,
        y: my - (my - top) * factor - newTop,
      });
      setZoom(next);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [
    zoom,
    setZoom,
    size,
    pan,
    displayWidth,
    displayBase,
    nativeWidth,
    nativeHeight,
    ratio,
  ]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(devicePixelRatio, 2);
    el.width = Math.round(size.w * dpr);
    el.height = Math.round(size.h * dpr);
    const g = el.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, size.w, size.h);
    g.fillStyle = "#ffffff";
    g.shadowColor = "#00000030";
    g.shadowBlur = 8;
    g.fillRect(
      origin.x - margin,
      origin.y - margin,
      nativeWidth * ratio,
      nativeHeight * ratio,
    );
    g.shadowBlur = 0;
    g.save();
    g.beginPath();
    g.rect(origin.x, origin.y, p.width * cell, p.height * cell);
    g.clip();
    if (p.reference && reference.current) {
      const r = p.reference;
      g.globalAlpha = r.opacity;
      g.drawImage(
        reference.current,
        origin.x + r.x * cell,
        origin.y + r.y * cell,
        r.width * cell,
        r.height * cell,
      );
      g.globalAlpha = 1;
    }
    if (p.view === "original" && original.current) {
      const im = original.current,
        ratio = Math.min(
          (p.width * cell) / im.width,
          (p.height * cell) / im.height,
        );
      g.drawImage(
        im,
        origin.x + (p.width * cell - im.width * ratio) / 2,
        origin.y + (p.height * cell - im.height * ratio) / 2,
        im.width * ratio,
        im.height * ratio,
      );
    } else {
      const startX = Math.max(0, Math.floor(-origin.x / cell)),
        endX = Math.min(p.width, Math.ceil((size.w - origin.x) / cell)),
        startY = Math.max(0, Math.floor(-origin.y / cell)),
        endY = Math.min(p.height, Math.ceil((size.h - origin.y) / cell));
      for (let y = startY; y < endY; y++)
        for (let x = startX; x < endX; x++) {
          const i = p.cells[y * p.width + x];
          if (i < 0) continue;
          const px = origin.x + x * cell,
            py = origin.y + y * cell;
          g.fillStyle = PALETTE[i].hex;
          if (p.view === "iron" && cell >= 5) {
            drawIron(
              g,
              px,
              py,
              cell,
              PALETTE[i].hex,
              p.settings.ironStyle || "regular",
              x,
              y,
            );
          } else g.fillRect(px, py, cell + 0.2, cell + 0.2);
          if (!guest && p.grid.codes && cell >= 14 && p.view !== "iron") {
            const hex = PALETTE[i].hex,
              brightness =
                parseInt(hex.slice(1, 3), 16) * 0.2126 +
                parseInt(hex.slice(3, 5), 16) * 0.7152 +
                parseInt(hex.slice(5, 7), 16) * 0.0722;
            g.fillStyle = brightness > 148 ? "#263632" : "#fff";
            g.font = `500 ${cell * Math.min(0.44, 0.78 / (PALETTE[i].code.length * 0.65))}px Arial, sans-serif`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(PALETTE[i].code, px + cell / 2, py + cell / 2);
          }
        }
      if (p.grid.lines && cell >= 5 && p.view !== "iron") {
        const standard =
          p.grid.color === "#a0c4bc" &&
          (!p.grid.majorColor || p.grid.majorColor === "#29a88f") &&
          (!p.grid.blockColor || p.grid.blockColor === "#29a88f");
        const lineStyle = (i: number) => {
          g.strokeStyle = standard
            ? i % 5 === 0
              ? "rgba(41,168,143,.56)"
              : "rgba(160,196,188,.32)"
            : i % 10 === 0
              ? p.grid.blockColor || "#29a88f"
              : i % 5 === 0
                ? p.grid.majorColor || "#29a88f"
                : p.grid.color;
          g.globalAlpha = standard
            ? 1
            : i % 10 === 0
              ? 0.94
              : i % 5 === 0
                ? 0.78
                : 0.46;
          g.lineWidth =
            (standard
              ? i % 5 === 0
                ? 1
                : 0.5
              : i % 10 === 0
                ? Math.max(1.35, baseCell * 0.12)
                : i % 5 === 0
                  ? Math.max(1, baseCell * 0.085)
                  : Math.max(0.5, baseCell * 0.045)) * ratio;
        };
        for (let x = startX; x <= endX; x++) {
          lineStyle(x);
          g.beginPath();
          g.moveTo(origin.x + x * cell, origin.y + startY * cell);
          g.lineTo(origin.x + x * cell, origin.y + endY * cell);
          g.stroke();
        }
        for (let y = startY; y <= endY; y++) {
          lineStyle(y);
          g.beginPath();
          g.moveTo(origin.x + startX * cell, origin.y + y * cell);
          g.lineTo(origin.x + endX * cell, origin.y + y * cell);
          g.stroke();
        }
        g.globalAlpha = 1;
      }
    }
    if (selection.size) {
      g.fillStyle = "#b5a6f355";
      for (const i of selection)
        g.fillRect(
          origin.x + (i % p.width) * cell,
          origin.y + Math.floor(i / p.width) * cell,
          cell,
          cell,
        );
      g.strokeStyle = "#b5a6f3";
      g.lineWidth = 1;
      for (const i of selection) {
        const x = i % p.width,
          y = Math.floor(i / p.width);
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (
            nx >= 0 &&
            nx < p.width &&
            ny >= 0 &&
            ny < p.height &&
            selection.has(ny * p.width + nx)
          )
            continue;
          const px = origin.x + x * cell,
            py = origin.y + y * cell;
          g.beginPath();
          if (dx === 1) {
            g.moveTo(px + cell, py);
            g.lineTo(px + cell, py + cell);
          } else if (dx === -1) {
            g.moveTo(px, py);
            g.lineTo(px, py + cell);
          } else if (dy === 1) {
            g.moveTo(px, py + cell);
            g.lineTo(px + cell, py + cell);
          } else {
            g.moveTo(px, py);
            g.lineTo(px + cell, py);
          }
          g.stroke();
        }
      }
    }
    if (path.length) {
      g.strokeStyle = "#b5a6f3";
      g.setLineDash([5, 3]);
      g.lineWidth = 2;
      g.beginPath();
      (tool === "rectangle" && path.length > 1
        ? [
            path[0],
            { x: path.at(-1)!.x, y: path[0].y },
            path.at(-1)!,
            { x: path[0].x, y: path.at(-1)!.y },
            path[0],
          ]
        : path
      ).forEach((q, i) => {
        const x = origin.x + (q.x + 0.5) * cell,
          y = origin.y + (q.y + 0.5) * cell;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
    if (p.grid.coordinates && cell >= 1 && p.view !== "iron") {
      g.fillStyle = "#a8afba";
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const step = Math.max(5, Math.ceil(32 / cell / 5) * 5);
      for (let x = 0; x < p.width; x += step) {
        const px = origin.x + (x + 0.5) * cell;
        if (px < 0 || px > size.w) continue;
        g.fillText(String(x + 1), px, origin.y - margin - 12);
      }
      g.textAlign = "center";
      for (let y = 0; y < p.height; y += step) {
        const py = origin.y + (y + 0.5) * cell;
        if (py < 0 || py > size.h) continue;
        g.fillText(String(y + 1), origin.x - margin - 15, py);
      }
    }
  }, [p, guest, size, zoom, pan, selection, path, loaded]);
  return (
    <div ref={host} className="canvas-host" data-testid="canvas-host">
      <canvas
        ref={canvas}
        data-testid="editor-canvas"
        data-grid-x={origin.x}
        data-grid-y={origin.y}
        data-cell-size={cell}
        aria-label="拼豆编辑画布"
        style={{
          width: size.w,
          height: size.h,
          cursor:
            tool === "hand"
              ? "grab"
              : tool === "picker"
                ? "crosshair"
                : "crosshair",
          touchAction: "none",
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {crop && (
        <div
          className="canvas-crop-layer"
          onPointerMove={cropMove}
          onPointerUp={() => (cropDrag.current = null)}
          onPointerCancel={() => (cropDrag.current = null)}
        >
          <div
            className="canvas-crop-selection"
            style={{
              left: origin.x + crop.rect.x * cell,
              top: origin.y + crop.rect.y * cell,
              width: crop.rect.w * cell,
              height: crop.rect.h * cell,
            }}
            onPointerDown={(e) => cropDown(e, "move")}
          >
            {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((edge) => (
              <button
                key={edge}
                className={"crop-handle " + edge}
                aria-label={"拖动" + edge + "裁剪边"}
                onPointerDown={(e) => cropDown(e, edge)}
              />
            ))}
          </div>
          <div className="canvas-crop-actions">
            <span>
              拖动边缘或四角调整裁剪范围 · {crop.rect.w} × {crop.rect.h}
            </span>
            <button onClick={crop.onAuto}>自动裁剪空白</button>
            <button onClick={crop.onCancel}>取消</button>
            <button className="primary" onClick={crop.onConfirm}>
              确认裁剪
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
