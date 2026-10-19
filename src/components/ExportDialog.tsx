import { DownloadSimple, WarningCircle } from "@phosphor-icons/react";
import Dialog from "./Dialog";
import { usage, type Project } from "../model";
import { chartLayout, legendLayout, physicalPlan } from "../export-layout";
import type { ExportOptions } from "../export.worker";
export default function ExportDialog({
  project: p,
  options: o,
  onChange,
  onClose,
  onExport,
}: {
  project: Project;
  options: ExportOptions;
  onChange: (o: ExportOptions) => void;
  onClose: () => void;
  onExport: () => void;
}) {
  const used = usage(p.cells),
    total = used.reduce((n, c) => n + c[1], 0),
    physical = physicalPlan(p.width, p.height, o.board),
    w =
      o.kind === "assembly" && o.assemblyMode !== "parts"
        ? physical.totalWidth
        : o.kind === "sections" || o.kind === "assembly"
          ? o.board
          : p.width,
    h =
      o.kind === "assembly" && o.assemblyMode !== "parts"
        ? physical.totalHeight
        : o.kind === "sections" || o.kind === "assembly"
          ? o.board
          : p.height,
    plan =
      o.kind === "palette"
        ? legendLayout(used.length)
        : chartLayout(w, h, used.length, o.cell || 56),
    mosaicCell =
      o.cell ||
      Math.max(
        1,
        Math.floor((Math.max(w, h) <= 96 ? 4096 : 8192) / Math.max(w, h)),
      ),
    width = o.kind === "mosaic" ? w * mosaicCell : plan.canvasWidth,
    height = o.kind === "mosaic" ? h * mosaicCell : plan.canvasHeight;
  const update = (v: Partial<ExportOptions>) => onChange({ ...o, ...v });
  return (
    <Dialog
      title={
        o.kind === "mosaic"
          ? "确认保存马赛克图片"
          : o.kind === "palette"
            ? "确认导出色卡与用量"
            : o.kind === "assembly" || o.kind === "sections"
              ? "确认导出分板图纸"
              : "确认导出图纸"
      }
      onClose={onClose}
    >
      <p className="export-confirm-description">
        请核对尺寸和色号数量，确认后才会生成最终文件。
      </p>
      <div className="export-confirm-grid">
        <div>
          <span>板子尺寸</span>
          <strong>
            {p.width} × {p.height} 格
          </strong>
        </div>
        <div>
          <span>实际使用色号</span>
          <strong>{used.length} 色</strong>
          <small>最大颜色设置 {p.settings.limit} 色</small>
        </div>
        <div>
          <span>导出清晰度</span>
          <strong>{o.kind === "mosaic" ? "高清" : plan.tier} PNG</strong>
          <small>
            {width.toLocaleString()} × {height.toLocaleString()} px
          </small>
        </div>
        <div>
          <span>导出内容</span>
          <strong>
            {o.kind === "mosaic"
              ? "纯马赛克图"
              : o.kind === "palette"
                ? "独立色卡 + 名称 + 所需颗数"
                : "图案 + 双边坐标 + 格内色号 + 色卡"}
          </strong>
          <small>共 {total.toLocaleString()} 颗豆子</small>
        </div>
      </div>
      <label className="export-mirror">
        <input
          aria-label="镜像导出"
          type="checkbox"
          checked={o.mirror}
          onChange={(e) => update({ mirror: e.target.checked })}
        />
        <span>
          <strong>镜像导出（熨烫用）</strong>
          <small>开启后图纸左右翻转；拼好后翻面熨烫，正面更接近参考图。</small>
        </span>
      </label>
      <label className="field">
        导出内容
        <select
          aria-label="导出内容"
          value={o.kind}
          onChange={(e) =>
            update({ kind: e.target.value as ExportOptions["kind"] })
          }
        >
          <option value="chart">完整图纸PNG</option>
          <option value="mosaic">纯马赛克PNG</option>
          <option value="palette">独立色卡与用量</option>
          <option value="assembly">常规板拼接图纸</option>
          <option value="sections">多块部分导出</option>
        </select>
      </label>
      {(o.kind === "assembly" || o.kind === "sections") && (
        <div className="assembly-options">
          <label className="field">
            常规板尺寸
            <select
              aria-label="常规板尺寸"
              value={o.board}
              onChange={(e) =>
                update({
                  board: +e.target.value as 52 | 78 | 104,
                  regions: undefined,
                })
              }
            >
              {[52, 78, 104].map((n) => (
                <option key={n} value={n}>
                  {n} × {n}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented">
            <button
              className={
                o.assemblyMode !== "parts" && o.kind !== "sections"
                  ? "active"
                  : ""
              }
              onClick={() => update({ kind: "assembly", assemblyMode: "full" })}
            >
              整体导出
            </button>
            <button
              className={
                o.assemblyMode === "parts" || o.kind === "sections"
                  ? "active"
                  : ""
              }
              onClick={() => update({ assemblyMode: "parts" })}
            >
              多块部分导出
            </button>
          </div>
          <p className="micro">
            {physical.columns} 列 × {physical.rows} 行，共 {physical.count}{" "}
            块；图案在完整板区居中，外部留白不计豆数。
          </p>
          {(o.assemblyMode === "parts" || o.kind === "sections") && (
            <div
              className="board-region-grid"
              style={{
                gridTemplateColumns: `repeat(${Math.min(physical.columns, 10)},1fr)`,
              }}
            >
              {Array.from({ length: physical.count }, (_, id) => (
                <button
                  key={id}
                  className={
                    o.regions === undefined || o.regions.includes(id)
                      ? "active"
                      : ""
                  }
                  onClick={() => {
                    const selected =
                      o.regions !== undefined
                        ? o.regions
                        : Array.from({ length: physical.count }, (_, i) => i);
                    update({
                      regions: selected.includes(id)
                        ? selected.filter((i) => i !== id)
                        : [...selected, id],
                    });
                  }}
                >
                  分区{id + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <details className="export-advanced">
        <summary>清晰度与显示选项</summary>
        <label className="field">
          每格像素
          <select
            aria-label="每格像素"
            value={o.cell}
            onChange={(e) => update({ cell: +e.target.value })}
          >
            <option value="0">原站高清规则（默认56px，自动达到4K）</option>
            {[8, 16, 24, 32, 56].map((n) => (
              <option value={n} key={n}>
                自定义 {n}px（至少达到4K图纸）
              </option>
            ))}
          </select>
        </label>
        <div className="export-checks">
          {(["codes", "lines", "coordinates"] as const).map((key, i) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={o[key] !== false}
                onChange={(e) => update({ [key]: e.target.checked })}
              />
              {["格内色号", "网格线", "双边坐标"][i]}
            </label>
          ))}
        </div>
      </details>
      <div className="export-local-hint">
        <WarningCircle size={18} />
        <span>
          本地完整能力开放，确认后生成最终文件。完整图纸始终输出单张PNG，不会自动改成分区。
        </span>
      </div>
      {width * height > 64e6 && (
        <p className="hint">
          当前完整文件为 {Math.round((width * height) / 1e6)}{" "}
          百万像素，将分条、分横片绘制编码。耗时较长，可取消；压缩数据超过128MB会提示失败，可由你选择分区重试。
        </p>
      )}
      <footer>
        <button onClick={onClose}>返回修改</button>
        <button
          className="primary"
          disabled={
            (o.kind === "sections" || o.assemblyMode === "parts") &&
            o.regions?.length === 0
          }
          onClick={onExport}
        >
          <DownloadSimple size={18} />
          确认并生成图纸
        </button>
      </footer>
    </Dialog>
  );
}
