import { useState } from "react";
import Dialog from "./Dialog";
import { PALETTE, type Project } from "../model";
export default function ColorPickerDialog({
  project,
  selected,
  onPick,
  onClose,
  onApply,
}: {
  project: Project;
  selected: number;
  onPick: (i: number) => void;
  onClose: () => void;
  onApply: (allowed: number[]) => void;
}) {
  const [query, setQuery] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [allowed, setAllowed] = useState(project.settings.allowed);
  return (
    <Dialog title="221色颜色大全" onClose={onClose} wide>
      <div className="color-picker-description">
        点击任意色卡，即可设为画笔当前颜色
      </div>
      <label className="color-search-label">
        查找色号或颜色名称
        <input
          autoFocus
          className="source-color-search"
          placeholder="例如 H2、白色、绿色系"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="source-color-groups">
        {["A", "B", "C", "D", "E", "F", "G", "H", "M"].map((prefix) => {
          const list = PALETTE.map((color, i) => ({ color, i })).filter(
            ({ color }) =>
              color.code.startsWith(prefix) &&
              `${color.code} ${color.name}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          );
          return (
            list.length > 0 && (
              <section key={prefix}>
                <header>
                  <strong>{prefix} 系列</strong>
                  <span>{list.length} 色</span>
                </header>
                <div className="source-color-grid">
                  {list.map(({ color, i }) => (
                    <button
                      key={i}
                      aria-label={`色卡${color.code}`}
                      className={i === selected ? "active" : ""}
                      title={`${color.code} ${color.name}`}
                      onClick={() => {
                        if (advanced)
                          setAllowed((a) =>
                            a.includes(i)
                              ? a.filter((n) => n !== i)
                              : [...a, i],
                          );
                        else onPick(i);
                      }}
                    >
                      <span style={{ background: color.hex }} />
                      <strong>{color.code}</strong>
                      <small>{color.name.split(" ")[0]}</small>
                      {advanced && (
                        <input
                          aria-label={`纳入自选${color.code}`}
                          type="checkbox"
                          checked={allowed.includes(i)}
                          readOnly
                        />
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )
          );
        })}
      </div>
      <details
        className="palette-advanced"
        onToggle={(e) => setAdvanced(e.currentTarget.open)}
      >
        <summary>自选色卡限制</summary>
        <span>勾选后将图案限制在所选颜色内。</span>
        <button className="soft" onClick={() => setAllowed([])}>
          清空
        </button>
        <button
          className="primary"
          disabled={!allowed.length}
          onClick={() => onApply(allowed)}
        >
          应用 {allowed.length} 色
        </button>
      </details>
    </Dialog>
  );
}
