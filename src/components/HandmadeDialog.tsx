import { applyColorRules } from "../color-rules";
import { useState, useEffect } from "react";
import Dialog from "./Dialog";
import ImportPreview from "./ImportPreview";
import { usage, hasManualEdits, remapDisabled, type Project } from "../model";
import { convertImage } from "../image-conversion";
import { cleanSmallPattern } from "../small-pattern";
export default function HandmadeDialog({
  project: p,
  onClose,
  onApply,
  onResize,
}: {
  project: Project;
  onClose: () => void;
  onApply: (
    normal: Int16Array,
    handmade: Int16Array,
    active: "normal" | "handmade",
  ) => void;
  onResize: () => void;
}) {
  const [normal, setNormal] = useState<Int16Array | null>(
      p.variants?.normal || null,
    ),
    [handmade, setHandmade] = useState<Int16Array | null>(
      p.variants?.handmade || null,
    ),
    [active, setActive] = useState<"normal" | "handmade">(
      p.variants?.active || "handmade",
    ),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0),
    [pending, setPending] = useState(false),
    [retry, setRetry] = useState(0);
  const tooLarge = p.width > 104 || p.height > 104;
  useEffect(() => {
    const controller = new AbortController();
    if (tooLarge) return;
    const constrain = (cells: Int16Array) =>
      applyColorRules(remapDisabled({ ...p, cells })).cells;
    if (p.variants) {
      try {
        setNormal(constrain(p.variants.normal));
        setHandmade(constrain(p.variants.handmade));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    setPending(true);
    setError("");
    const original = p.cells.slice();
    setNormal(original);
    const create = async () => {
      try {
        const candidate =
          p.source && p.generationBase && !hasManualEdits(p)
            ? (
                await convertImage(
                  p.source,
                  {
                    ...p.generationBase.settings,
                    mode: "normal",
                    smallCleanup: true,
                  },
                  { signal: controller.signal, onProgress: setProgress },
                )
              ).cells
            : cleanSmallPattern(original, p.width, p.height);
        if (!controller.signal.aborted) setHandmade(constrain(candidate));
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    };
    create();
    return () => controller.abort();
  }, [retry]);
  const cells = active === "normal" ? normal : handmade;
  return (
    <Dialog title="手搓图候选" wide onClose={onClose}>
      <p className="muted">
        对齐原站公开规则：宽、高均不超过104格；优先从未编辑的原图重采样，小图清理。手工编辑过的图纸只清理当前网格，保留你的修改。
      </p>
      {tooLarge ? (
        <>
          <p className="error">
            当前 {p.width} × {p.height}{" "}
            格，超过104×104。请返回原图设置减少输出格数。
          </p>
          <button onClick={onResize}>调整输出网格</button>
        </>
      ) : (
        <>
          <div className="segmented">
            <button
              aria-pressed={active === "normal"}
              onClick={() => setActive("normal")}
            >
              普通图纸 · {normal ? usage(normal).length : "…"}色
            </button>
            <button
              aria-pressed={active === "handmade"}
              onClick={() => setActive("handmade")}
            >
              手搓图 · {handmade ? usage(handmade).length : "…"}色
            </button>
          </div>
          <div className="candidate-preview">
            <ImportPreview
              result={
                cells
                  ? {
                      source: "",
                      settingsKey: "",
                      width: p.width,
                      height: p.height,
                      cells,
                    }
                  : null
              }
              pending={pending}
              progress={progress}
              error={error}
              onRetry={() => setRetry((n) => n + 1)}
            />
          </div>
          <p className="micro">
            手搓图减少近色与孤立杂点，会损失部分细节。两个版本的后续编辑分别保留；切换前先选择候选，确认后才改变作品。
          </p>
        </>
      )}
      <footer>
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          disabled={tooLarge || pending || !!error || !normal || !handmade}
          onClick={() => {
            try {
              onApply(normal!, handmade!, active);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          应用所选版本
        </button>
      </footer>
    </Dialog>
  );
}
