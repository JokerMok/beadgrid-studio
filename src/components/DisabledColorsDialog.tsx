import { useState } from "react";
import Dialog from "./Dialog";
import { PALETTE, remapDisabled, type Project } from "../model";
import { applyColorRules } from "../color-rules";
export default function DisabledColorsDialog({
  project: p,
  selection,
  onApply,
  onClose,
}: {
  project: Project;
  selection: Set<number>;
  onApply: (p: Project) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState(selection.size > 0),
    [colors, setColors] = useState<number[]>(
      selection.size ? [] : p.settings.disabled,
    ),
    [rules, setRules] = useState(p.colorRules || []),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const toggle = (i: number) =>
    setColors((c) => (c.includes(i) ? c.filter((n) => n !== i) : [...c, i]));
  return (
    <Dialog title="禁用指定色号" wide onClose={onClose}>
      <p>
        可对全图禁用，也可先在画布框选或套索圈出脸部等区域，再仅在该区域禁色。规则会随作品保存，画笔、填充和替色继续遵守。
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={scope}
          disabled={!selection.size}
          onChange={(e) => {
            setScope(e.target.checked);
            setColors(e.target.checked ? [] : p.settings.disabled);
          }}
        />
        仅在当前选区禁用（{selection.size}格）
      </label>
      <p className="micro">
        已有 {rules.length} 个区域规则；最多8个。取消不会改变当前作品。
      </p>
      {rules.length > 0 && (
        <button onClick={() => setRules([])}>
          清除已有区域规则（确认应用后生效）
        </button>
      )}
      <input
        className="search"
        aria-label="搜索禁用色号"
        placeholder="搜索色号或颜色"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="full-palette">
        {PALETTE.map((c, i) => ({ c, i }))
          .filter(({ c }) =>
            (c.code + " " + c.name).toLowerCase().includes(query.toLowerCase()),
          )
          .map(({ c, i }) => (
            <div
              className={
                "palette-tile " + (colors.includes(i) ? "disabled-color" : "")
              }
              key={i}
            >
              <button
                aria-label={"禁用色卡" + c.code}
                aria-pressed={colors.includes(i)}
                style={{ background: c.hex }}
                title={c.name}
                onClick={() => toggle(i)}
              />
              <span>{c.code}</span>
              <small>{colors.includes(i) ? "已禁用" : "可用"}</small>
            </div>
          ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button onClick={() => setColors([])}>恢复全部色号</button>
        <span>{colors.length}色待禁用</span>
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          onClick={() => {
            try {
              if (scope && colors.length) {
                if (rules.length >= 8)
                  throw Error("区域规则已达8个，请先清除旧规则");
                onApply(
                  applyColorRules({
                    ...p,
                    colorRules: [...rules, { indices: [...selection], colors }],
                  }),
                );
              } else if (scope) onApply({ ...p, colorRules: rules });
              else
                onApply(
                  applyColorRules(
                    remapDisabled({
                      ...p,
                      colorRules: rules,
                      settings: { ...p.settings, disabled: colors },
                    }),
                  ),
                );
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          应用禁色规则
        </button>
      </footer>
    </Dialog>
  );
}
