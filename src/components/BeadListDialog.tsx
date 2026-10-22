import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, DownloadSimple, ImageSquare } from "@phosphor-icons/react";
import Dialog from "./Dialog";
import MaterialSettings from "./MaterialSettings";
import {
  buildBeadList,
  listCsv,
  listText,
  listPages,
  type BeadListSort,
} from "../bead-list";
import { renderListImages } from "../bead-list-images";
import { MATERIAL_CATALOG, PURCHASE_NOTICE } from "../material-catalog";
import type { Project, Settings } from "../model";
import { download, safeName } from "../storage";

export default function BeadListDialog({
  project,
  onSettings,
  onClose,
}: {
  project: Project;
  onSettings: (s: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const [sort, setSort] = useState<BeadListSort>("code"),
    [reserve, setReserve] = useState(0),
    [message, setMessage] = useState(""),
    [fallback, setFallback] = useState(false),
    [artifact, setArtifact] = useState<{ url: string; name: string } | null>(
      null,
    ),
    [progress, setProgress] = useState<number | null>(null);
  const job = useRef<AbortController | null>(null);
  const list = useMemo(
    () => buildBeadList(project, sort, reserve),
    [project, sort, reserve],
  );
  const text = useMemo(() => listText(list), [list]);
  const exportable = !!list.sizeMm && !!list.total;
  useEffect(() => () => job.current?.abort(), []);
  useEffect(
    () => () => {
      if (artifact) URL.revokeObjectURL(artifact.url);
    },
    [artifact],
  );
  function offerFile(blob: Blob, name: string) {
    setArtifact({ url: URL.createObjectURL(blob), name });
    download(blob, name);
  }
  useEffect(() => {
    setMessage("");
    setFallback(false);
    setArtifact(null);
  }, [list]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("已复制完整文字清单");
    } catch {
      setFallback(true);
      setMessage("浏览器未允许自动复制，请在下方文本框中全选并复制。");
    }
  }
  async function images() {
    const controller = new AbortController();
    job.current = controller;
    setProgress(0);
    setMessage("");
    try {
      const result = await renderListImages(
        list,
        controller.signal,
        setProgress,
      );
      if (controller.signal.aborted) return;
      offerFile(
        result.blob,
        `${safeName(list.name)}_用豆清单${reserve ? `_备用${reserve}%` : ""}.${result.extension}`,
      );
      setMessage(
        `已生成${listPages(list).length}页清单图片${result.extension === "zip" ? "，已打包ZIP" : ""}并提交下载；请检查浏览器下载列表，可使用下方备用入口`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "清单图片生成失败，请重试");
    } finally {
      job.current = null;
      setProgress(null);
    }
  }
  return (
    <Dialog title="用豆清单" wide onClose={onClose}>
      <div className="bead-list">
        <div className="bead-list-heading">
          <h3>{project.name}</h3>
          <span>
            {list.width} × {list.height} 格
          </span>
        </div>
        <fieldset disabled={progress !== null} className="bead-list-spec">
          <MaterialSettings
            settings={project.settings}
            onChange={onSettings}
            width={project.width}
            height={project.height}
          />
        </fieldset>
        <p className="bead-list-series">系列：{list.series}</p>
        <div className="bead-list-summary" data-testid="bead-list-summary">
          <span>
            <b>{list.colorCount}</b> 使用颜色
          </span>
          <span>
            <b>{list.total.toLocaleString()}</b> 实际需用（颗）
          </span>
          <span>
            <b>{list.empty.toLocaleString()}</b> 空格不计入
          </span>
        </div>
        <div className="bead-list-controls">
          <label>
            排序
            <select
              aria-label="清单排序"
              disabled={progress !== null}
              value={sort}
              onChange={(e) => setSort(e.target.value as BeadListSort)}
            >
              <option value="code">按色号</option>
              <option value="quantity">按数量从多到少</option>
            </select>
          </label>
          <label>
            备用量
            <select
              aria-label="备用量"
              disabled={progress !== null}
              value={reserve}
              onChange={(e) => setReserve(+e.target.value)}
            >
              {[0, 5, 10, 20].map((n) => (
                <option value={n} key={n}>
                  {n ? `加${n}%备用量` : "不加备用量（实际需用）"}
                </option>
              ))}
            </select>
          </label>
        </div>
        {reserve > 0 && (
          <p className="bead-list-reserve">
            每色建议采购 = 实际需用 × {1 + reserve / 100}，向上取整；建议合计{" "}
            <b data-testid="purchase-total">
              {list.purchaseTotal.toLocaleString()}
            </b>{" "}
            颗。实际用量保持不变。
          </p>
        )}
        <p className="bead-list-notice">{PURCHASE_NOTICE}</p>
        <div className="bead-list-actions">
          <button disabled={!exportable || progress !== null} onClick={copy}>
            <Copy />
            复制文字清单
          </button>
          <button
            disabled={!exportable || progress !== null}
            onClick={() => {
              offerFile(
                new Blob([listCsv(list)], { type: "text/csv;charset=utf-8" }),
                `${safeName(list.name)}_用豆清单.csv`,
              );
              setMessage(
                "已提交CSV下载，请检查浏览器下载列表；可用中文Excel打开",
              );
            }}
          >
            <DownloadSimple />
            下载 CSV
          </button>
          <button
            className="primary"
            disabled={!exportable || progress !== null}
            onClick={images}
          >
            <ImageSquare />
            下载清单图片
          </button>
        </div>
        {artifact && (
          <p className="hint">
            <a href={artifact.url} download={artifact.name}>
              再次下载当前清单
            </a>{" "}
            ·{" "}
            <a href={artifact.url} target="_blank" rel="noreferrer">
              打开文件备用保存
            </a>
          </p>
        )}
        <p className="micro">
          图片每页最多40色，共{listPages(list).length}
          页；多页打包为ZIP，内含逐页PNG及清单数据。屏幕颜色仅供参考。
        </p>
        {progress !== null && (
          <div role="status" className="bead-list-progress">
            <progress value={progress} max="1" />
            <span>生成图片 {Math.round(progress * 100)}%</span>
            <button onClick={() => job.current?.abort()}>取消生成</button>
          </div>
        )}
        {message && (
          <p role="status" className="bead-list-message">
            {message}
          </p>
        )}
        {fallback && (
          <textarea
            className="bead-list-copy"
            aria-label="完整文字清单"
            value={text}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        {!list.total ? (
          <p className="muted">当前图纸全部为空格，暂无需要采购的拼豆。</p>
        ) : (
          <div className="bead-list-table-wrap">
            <table className="bead-list-table" data-testid="bead-list-table">
              <thead>
                <tr>
                  <th>颜色参考</th>
                  <th>色号</th>
                  <th>实际需用（颗）</th>
                  {reserve > 0 && <th>建议采购（颗）</th>}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr
                    key={r.code}
                    data-code={r.code}
                    data-count={r.count}
                    data-purchase={r.purchase}
                  >
                    <td>
                      <span
                        className="bead-list-swatch"
                        style={{ background: r.hex }}
                        aria-label={`${r.code}屏幕颜色参考`}
                      />
                    </td>
                    <th scope="row">{r.code}</th>
                    <td>{r.count.toLocaleString()}</td>
                    {reserve > 0 && <td>{r.purchase.toLocaleString()}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="bead-list-sources">
          <summary>色卡来源与核对范围</summary>
          <p>{MATERIAL_CATALOG.verification}</p>
          <p>{MATERIAL_CATALOG.screenNotice}</p>
          <p>
            色值版本：{list.paletteVersion}。色号核对版本：
            {list.catalogRevision}。不将其他品牌近似色当作相同色号。
          </p>
          <ul>
            {MATERIAL_CATALOG.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Dialog>
  );
}
