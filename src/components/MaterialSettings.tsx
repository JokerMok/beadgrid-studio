import type { Settings } from "../model";
import {
  MATERIAL_CATALOG,
  supportedMaterial,
  verifiedMaterial,
} from "../material-catalog";
import { estimatedSize } from "../bead-list";

export default function MaterialSettings({
  settings,
  onChange,
  width,
  height,
}: {
  settings: Settings;
  onChange: (value: Partial<Settings>) => void;
  width: number;
  height: number;
}) {
  const material = verifiedMaterial(settings.materialSpec);
  return (
    <div className="material-settings">
      <label className="field">
        品牌／色卡体系
        <span className="material-name">
          {MATERIAL_CATALOG.name} · {MATERIAL_CATALOG.brand}
        </span>
      </label>
      <label className="field">
        豆子尺寸
        <select
          aria-label="豆子尺寸"
          value={material ? "2.6" : ""}
          onChange={(e) => {
            if (e.target.value === "2.6")
              onChange({ beadSize: 2.6, materialSpec: supportedMaterial() });
          }}
        >
          {!material && <option value="">规格待选择</option>}
          <option value="2.6">2.6 mm 迷你豆 · 标准221色</option>
        </select>
      </label>
      {!material && (
        <p className="material-pending" role="status">
          此作品未记录已核对的采购规格。旧尺寸
          {settings.beadSize ? `（${settings.beadSize}mm）` : ""}
          仅为历史设置，请先选择；5mm、10mm暂未提供已核实组合。
        </p>
      )}
      <p className="micro">
        {estimatedSize(width, height, material?.beadSizeMm)}
      </p>
      <p className="micro">
        色号已核对公开仓库；2.6mm有商家规格资料支持。屏幕颜色仅供参考。
      </p>
    </div>
  );
}
