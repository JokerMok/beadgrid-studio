import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import ImportPreview from "./ImportPreview";
import { remapDisabled, type Project } from "../model";
import { applyColorRules } from "../color-rules";
export default function AdjustmentDialog({
  project: p,
  onClose,
  onApply,
}: {
  project: Project;
  onClose: () => void;
  onApply: (cells: Int16Array) => void;
}) {
  const reset = {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpen: 0,
      exposure: 0,
    },
    [values, setValues] = useState(reset),
    [cells, setCells] = useState(p.cells),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true,
      w: Worker | null = null;
    setPending(true);
    setError("");
    const timer = setTimeout(() => {
      w = new Worker(new URL("../adjust.worker.ts", import.meta.url), {
        type: "module",
      });
      w.onmessage = ({ data }) => {
        if (!live) return;
        if (data.error) setError(data.error);
        else
          try {
            setCells(
              applyColorRules(remapDisabled({ ...p, cells: data.cells })).cells,
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        setPending(false);
        w?.terminate();
      };
      w.onerror = (e) => {
        if (live) {
          setError(e.message);
          setPending(false);
        }
        w?.terminate();
      };
      w.postMessage({
        cells: p.cells,
        width: p.width,
        height: p.height,
        settings: { ...p.settings, ...values },
      });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
      w?.terminate();
    };
  }, [values, retry]);
  return (
    <Dialog title="图纸调节" wide onClose={onClose}>
      <p className="muted">
        对当前图纸调节亮度、对比度、饱和度、锐化和曝光，再匹配固定221色。空格保持空格，应用作为一次编辑，可撤销。不会修改原图或普通转换默认参数。
      </p>
      <div className="adjustment-layout">
        <div className="candidate-preview">
          <ImportPreview
            result={{
              source: "",
              settingsKey: JSON.stringify(values),
              width: p.width,
              height: p.height,
              cells,
            }}
            pending={pending}
            progress={pending ? 0 : 100}
            error={error}
            onRetry={() => setRetry((n) => n + 1)}
          />
        </div>
        <div>
          {(Object.keys(reset) as (keyof typeof reset)[]).map((key, i) => (
            <label className="field" key={key}>
              {["亮度", "对比度", "饱和度", "锐化", "曝光"][i]}
              <b>{values[key]}</b>
              <input
                aria-label={["亮度", "对比度", "饱和度", "锐化", "曝光"][i]}
                type="range"
                min={key === "sharpen" ? 0 : -100}
                max={100}
                value={values[key]}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: +e.target.value }))
                }
              />
            </label>
          ))}
        </div>
      </div>
      <footer>
        <button onClick={() => setValues(reset)}>恢复默认</button>
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          disabled={pending || !!error}
          onClick={() => onApply(cells)}
        >
          应用图纸调节
        </button>
      </footer>
    </Dialog>
  );
}
