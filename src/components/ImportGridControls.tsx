import { LockSimple, LockSimpleOpen } from "@phosphor-icons/react";
import type { Settings } from "../model";
import type { MaterialSpec } from "../material-catalog";
import { outputCoverage } from "../import-grid";
const ratios = ["1:1", "3:4", "4:3", "9:16", "16:9"];
export default function ImportGridControls({
  settings: s,
  locked,
  onLock,
  onSizing,
  onDimension,
  onDensity,
  update,
  disabled,
  counts,
  total,
  material,
  mismatch,
  sourceRatio,
}: {
  settings: Settings;
  locked: boolean;
  onLock: () => void;
  onSizing: (choice: string) => void;
  onDimension: (axis: "width" | "height", value: number) => void;
  onDensity: (edge: number) => void;
  update: (patch: Partial<Settings>) => void;
  disabled: boolean;
  counts: [number, number][] | null;
  total?: number;
  material: MaterialSpec | undefined;
  mismatch: boolean;
  sourceRatio: number;
}) {
  const transformed =
    s.zoom !== 1 ||
    s.panX !== 0 ||
    s.panY !== 0 ||
    s.alignX !== 0 ||
    s.alignY !== 0;
  const edge = Math.max(s.width, s.height),
    auto = s.gridSizing === "source";
  const ratio = s.width / s.height,
    preset =
      !auto && locked
        ? ratios.find((text) => {
            const [w, h] = text.split(":").map(Number);
            return Math.abs(ratio / (w / h) - 1) < 0.008;
          })
        : undefined;
  const coverage = outputCoverage(sourceRatio, ratio);
  const valid = [s.width, s.height].every(
    (n) => Number.isInteger(n) && n >= 16 && n <= 1000,
  );
  return (
    <fieldset
      className="import-density"
      disabled={disabled}
      aria-label="细节密度与输出网格"
    >
      <div className="density-heading">
        <h3>细节密度 / 输出网格</h3>
        <strong data-testid="output-grid">
          {s.width} × {s.height}
          <small>格</small>
        </strong>
      </div>
      <label className="density-slider-label">
        <span>长边格数</span>
        <b>{edge} 格</b>
        <input
          aria-label="长边格数"
          type="range"
          min="16"
          max="1000"
          step="1"
          value={edge}
          onChange={(e) => onDensity(+e.target.value)}
        />
      </label>
      <div className="density-presets">
        {[100, 150, 200, 300, 400].map((n) => (
          <button
            key={n}
            className={edge === n ? "active" : ""}
            aria-label={`长边${n}格`}
            aria-pressed={edge === n}
            onClick={() => onDensity(n)}
          >
            {n}
            <small>格</small>
          </button>
        ))}
      </div>
      <div className="density-ratio-row">
        <label>
          输出比例
          <select
            aria-label="输出网格比例"
            value={auto ? "source" : preset || "custom"}
            onChange={(e) => onSizing(e.target.value)}
          >
            <option value="source">跟随当前取景比例</option>
            <option value="custom">自定义宽高</option>
            {ratios.map((r) => (
              <option key={r} value={r}>
                固定 {r}
              </option>
            ))}
          </select>
        </label>
        <div className="density-dimensions">
          <label>
            宽
            <input
              aria-label="导入宽度"
              type="number"
              min="16"
              max="1000"
              value={s.width || ""}
              onChange={(e) => onDimension("width", +e.target.value)}
            />
          </label>
          <span>×</span>
          <label>
            高
            <input
              aria-label="导入高度"
              type="number"
              min="16"
              max="1000"
              value={s.height || ""}
              onChange={(e) => onDimension("height", +e.target.value)}
            />
          </label>
          <button
            className={"icon-button " + (auto || locked ? "active" : "")}
            aria-label="锁定网格宽高比例"
            aria-pressed={auto || locked}
            disabled={auto || !valid}
            title={
              auto
                ? "跟随取景比例；选择自定义后可独立调节"
                : locked
                  ? "解除比例锁定"
                  : "锁定当前宽高比例"
            }
            onClick={onLock}
          >
            {auto || locked ? (
              <LockSimple size={17} />
            ) : (
              <LockSimpleOpen size={17} />
            )}
          </button>
        </div>
      </div>
      <div className="density-placement-row">
        <label>
          图像铺放
          <select
            aria-label="图像铺放"
            value={s.placement || "contain"}
            onChange={(e) =>
              update({ placement: e.target.value as Settings["placement"] })
            }
          >
            <option value="contain">完整放入 · 比例不同时留白</option>
            <option value="cover">裁切填满 · 明确裁去边缘</option>
          </select>
        </label>
        <label>
          比例留白
          <select
            aria-label="比例留白"
            value={s.padding || "empty"}
            onChange={(e) =>
              update({ padding: e.target.value as Settings["padding"] })
            }
          >
            <option value="empty">空格，不计用豆</option>
            <option value="white">铺白豆</option>
          </select>
        </label>
      </div>
      <p
        className={
          "density-framing-note" +
          (transformed || (mismatch && s.placement === "cover")
            ? " warning"
            : "")
        }
      >
        {transformed ? (
          <>
            高级构图缩放/偏移已启用，可能裁边；左侧虚线为实际输出范围。
            <button
              className="inline-reset"
              onClick={() =>
                update({ zoom: 1, panX: 0, panY: 0, alignX: 0, alignY: 0 })
              }
            >
              重置构图
            </button>
          </>
        ) : mismatch ? (
          s.placement === "cover" ? (
            `会裁去当前取景${coverage.w < 1 ? "左右" : "上下"}约 ${Math.round((1 - Math.min(coverage.w, coverage.h)) * 100)}%；左侧虚线为实际输出范围。`
          ) : (
            "输出与取景比例不同，完整保留内容并产生留白，不拉伸。"
          )
        ) : (
          "按取景比例保留完整内容；原图自带透明边界不会自动裁去。"
        )}
        {s.padding === "white" &&
          s.removeLight &&
          " 浅色边缘清理开启，白色留白可能被清理。"}
      </p>
      <div className="density-summary import-summary" aria-label="制作信息">
        <div>
          <span>
            预计成品 · {material ? `${material.beadSizeMm}mm` : "规格待选择"}
          </span>
          <strong>
            {material && valid
              ? `${((s.width * material.beadSizeMm) / 10).toFixed(1)} × ${((s.height * material.beadSizeMm) / 10).toFixed(1)} cm`
              : "请先选择有效规格"}
          </strong>
        </div>
        <div>
          <span>有效用豆</span>
          <strong>
            {counts !== null ? total!.toLocaleString() : "—"}
            <small>颗</small>
          </strong>
        </div>
        <div>
          <span>实际颜色</span>
          <strong>
            {counts !== null ? counts.length : "—"}
            <small>色</small>
          </strong>
        </div>
        <p>按格数与豆子尺寸估算，未计板间隙及熨烫收缩</p>
      </div>
    </fieldset>
  );
}
