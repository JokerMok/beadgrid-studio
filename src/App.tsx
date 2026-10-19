import OutlineDialog from "./components/OutlineDialog";
import ColorPickerDialog from "./components/ColorPickerDialog";
import ExportDialog from "./components/ExportDialog";
import BeadListDialog from "./components/BeadListDialog";
import MaterialSettings from "./components/MaterialSettings";
import { prepareRaster } from "./prepare-image";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Hand,
  PencilSimple,
  Eraser,
  Eyedropper,
  PaintBucket,
  Selection,
  MagicWand,
  Palette,
  Rectangle,
  ImageSquare,
  Swap,
  SlidersHorizontal,
  GridFour,
  DotsThree,
  UploadSimple,
  DownloadSimple,
  FloppyDisk,
  CloudArrowUp,
  Plus,
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowsClockwise,
  FlipHorizontal,
  FlipVertical,
  Crop,
  Trash,
  Minus,
  MagnifyingGlassPlus,
  ArrowsOut,
  CheckCircle,
  UserCircle,
  X,
  FolderOpen,
  ArrowRight,
  Eye,
  Leaf,
  Question,
  SignOut,
  WarningCircle,
  Spinner,
  FileArrowDown,
  CaretDown,
} from "@phosphor-icons/react";
import CanvasEditor from "./components/CanvasEditor";
import Dialog from "./components/Dialog";
import ImportDialog from "./components/ImportDialog";
import {
  PALETTE,
  BRAND,
  blank,
  defaults,
  usage,
  serialize,
  deserialize,
  transform,
  cropProject,
  remapDisabled,
  nearest,
  type Project,
  type Settings,
  type Tool,
} from "./model";
import {
  saveDraft,
  loadDraft,
  saveLocal,
  listLocal,
  removeLocal,
  downloadProject,
  download,
  readImage,
  safeName,
} from "./storage";
import { makeDemo } from "./demo";
import { api } from "./api";
import {
  adjustPattern,
  enhanceEdges,
  mergeRare,
  similarGroups,
  mergeSimilar,
} from "./conversion-core";
import type { ExportOptions } from "./export.worker";
const tools: { id: Tool; name: string; key: string; icon: typeof Hand }[] = [
  { id: "hand", name: "手型", key: "H", icon: Hand },
  { id: "brush", name: "画笔", key: "B", icon: PencilSimple },
  { id: "eraser", name: "橡皮", key: "E", icon: Eraser },
  { id: "picker", name: "吸管", key: "I", icon: Eyedropper },
  { id: "fill", name: "填充", key: "G", icon: PaintBucket },
  { id: "lasso", name: "套索", key: "L", icon: Selection },
  { id: "rectangle", name: "框选", key: "R", icon: Rectangle },
  { id: "magic", name: "魔法选取", key: "M", icon: MagicWand },
];
type Modal =
  | "bead-list"
  | "similar"
  | "outline"
  | "new"
  | "palette"
  | "replace"
  | "disable"
  | "adjust"
  | "align"
  | "reference"
  | "export"
  | "works"
  | "auth"
  | "more"
  | "crop"
  | "help"
  | null;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function projectImage(p: Project) {
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  const g = canvas.getContext("2d")!;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = p.cells[y * p.width + x];
      if (i >= 0) {
        g.fillStyle = PALETTE[i].hex;
        g.fillRect(x, y, 1, 1);
      }
    }
  return canvas.toDataURL("image/png");
}
export default function App() {
  const [project, setProject] = useState<Project>(makeDemo),
    [booted, setBooted] = useState(false),
    [saved, setSaved] = useState("正在恢复"),
    [tool, setTool] = useState<Tool>("hand"),
    [color, setColor] = useState(PALETTE.findIndex((c) => c.code === "C16")),
    [brush, setBrush] = useState(1),
    [zoom, setZoom] = useState(1),
    [zoomInput, setZoomInput] = useState<string | null>(null),
    [fitKey, setFitKey] = useState(0),
    [selection, setSelection] = useState(new Set<number>()),
    [cursor, setCursor] = useState(""),
    [modal, setModal] = useState<Modal>(null),
    [incoming, setIncoming] = useState<{
      source: string;
      name: string;
      initial?: Settings;
    } | null>(null),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState<{ progress: number; message: string } | null>(
      null,
    ),
    [focus, setFocus] = useState(false),
    [mobileSide, setMobileSide] = useState(false),
    [search, setSearch] = useState(""),
    [paletteTab, setPaletteTab] = useState("used"),
    [boardW, setBoardW] = useState(104),
    [boardH, setBoardH] = useState(78),
    [newW, setNewW] = useState(52),
    [newH, setNewH] = useState(52),
    [localWorks, setLocalWorks] = useState<Project[]>([]),
    [cloudWorks, setCloudWorks] = useState<
      { id: string; title: string; updated: number }[]
    >([]),
    [user, setUser] = useState<{ id: number; username: string } | null>(null),
    [authMode, setAuthMode] = useState("login"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [formError, setFormError] = useState(""),
    [networkBusy, setNetworkBusy] = useState(false),
    [replaceFrom, setReplaceFrom] = useState(0),
    [replaceTo, setReplaceTo] = useState(1),
    [adjust, setAdjust] = useState<Settings>(defaults()),
    [exportOptions, setExportOptions] = useState<ExportOptions>({
      kind: "chart",
      cell: 0,
      mirror: false,
      board: 52,
    }),
    [cropActive, setCropActive] = useState(false),
    [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 52, h: 52 }),
    [notice, setNotice] = useState(true),
    [historyTick, setHistoryTick] = useState(0),
    [similarThreshold, setSimilarThreshold] = useState(90),
    [readyExport, setReadyExport] = useState<{
      blob: Blob;
      name: string;
    } | null>(null);
  const current = useRef(project);
  current.current = project;
  const undo = useRef<{ project: Project; selection: Set<number> }[]>([]),
    redo = useRef<{ project: Project; selection: Set<number> }[]>([]),
    worker = useRef<Worker | null>(null),
    jobId = useRef(0),
    draftRevision = useRef(0),
    edgeBase = useRef<{ base: Int16Array; last: Int16Array } | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    referenceInput = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    cloudVersions = useRef(new Map<string, number>());
  const counts = useMemo(() => usage(project.cells), [project.cells]),
    total = counts.reduce((s, v) => s + v[1], 0),
    countMap = new Map(counts),
    validColor = !project.settings.disabled.includes(color);
  const notify = useCallback((s: string) => {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  function checkpoint() {
    undo.current.push({
      project: current.current,
      selection: new Set(selection),
    });
    while (
      undo.current.length > 50 ||
      undo.current.reduce((n, p) => n + p.project.cells.byteLength, 0) >
        32 * 1024 * 1024
    )
      undo.current.shift();
    redo.current = [];
    setHistoryTick((t) => t + 1);
  }
  function change(p: Project) {
    setProject({ ...p, updatedAt: Date.now() });
  }
  function commit(p: Project, keepSelection = false) {
    checkpoint();
    change(p);
    if (!keepSelection) {
      setSelection(new Set());
      setCropActive(false);
    }
  }
  function selectCells(cells: Set<number>) {
    checkpoint();
    setSelection(cells);
  }
  function undoEdit() {
    const p = undo.current.pop();
    if (p) {
      redo.current.push({
        project: current.current,
        selection: new Set(selection),
      });
      change(p.project);
      setSelection(new Set(p.selection));
      setHistoryTick((t) => t + 1);
    }
  }
  function redoEdit() {
    const p = redo.current.pop();
    if (p) {
      undo.current.push({
        project: current.current,
        selection: new Set(selection),
      });
      change(p.project);
      setSelection(new Set(p.selection));
      setHistoryTick((t) => t + 1);
    }
  }
  useEffect(() => {
    loadDraft()
      .then((p) => {
        if (p) {
          setProject(p);
          notify("已恢复上次的本地草稿");
        }
      })
      .catch((e) => notify("草稿恢复失败：" + errText(e)))
      .finally(() => setBooted(true));
    api("/me")
      .then((r) => setUser(r.user))
      .catch(() => {});
    return () => worker.current?.terminate();
  }, []);
  useEffect(() => {
    if (!booted) return;
    const revision = ++draftRevision.current;
    setSaved("正在保存");
    const timer = setTimeout(() => {
      saveDraft(project)
        .then(() => {
          if (revision === draftRevision.current) setSaved("已自动保存");
        })
        .catch((e) => {
          setSaved("保存失败");
          notify("本地存储失败，请立即导出项目文件：" + errText(e));
        });
    }, 650);
    return () => clearTimeout(timer);
  }, [project, booted]);
  useEffect(() => {
    setBoardW(project.width);
    setBoardH(project.height);
  }, [project.width, project.height]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        modal ||
        incoming ||
        busy ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        e.shiftKey ? redoEdit() : undoEdit();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        redoEdit();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === "s") {
        e.preventDefault();
        saveNamed();
        return;
      }
      if (k === "escape") {
        setCropActive(false);
        setSelection(new Set());
        setFocus(false);
      }
      const t = tools.find((t) => t.key.toLowerCase() === k);
      if (t) setTool(t.id);
      if (k === "delete" || k === "backspace") {
        if (selection.size) {
          e.preventDefault();
          fillSelection(-1);
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [project, modal, incoming, busy, selection]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (saved !== "已自动保存") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saved]);
  useEffect(() => {
    const replace = (e: Event) => setIncoming((e as CustomEvent).detail);
    window.addEventListener("xing-replace-upload", replace);
    return () => window.removeEventListener("xing-replace-upload", replace);
  }, []);
  const onCursor = useCallback((s: string) => {
    if (s.startsWith("pick:")) {
      const n = +s.slice(5);
      setColor(n);
      setTool("brush");
      notify("已吸取 " + PALETTE[n].code);
    } else if (s.startsWith("该")) notify(s);
    else setCursor(s);
  }, []);
  async function saveNamed() {
    try {
      await saveLocal(current.current);
      notify("已保存到本地作品");
    } catch (e) {
      notify("保存失败：" + errText(e));
    }
  }
  async function receiveFile(file?: File) {
    if (!file) return;
    try {
      const source = await readImage(file);
      setIncoming({ source, name: file.name, initial: defaults(104, 104) });
      setMobileSide(false);
    } catch (e) {
      notify(errText(e));
    }
  }
  async function generate(source: string, name: string, s: Settings) {
    try {
      await saveLocal(current.current);
    } catch (e) {
      notify("无法备份当前作品：" + errText(e));
      return;
    }
    setIncoming(null);
    setModal(null);
    const revision = jobId.current;
    setBusy({ progress: 0, message: "正在解码与构图…" });
    let raster;
    try {
      raster = await prepareRaster(source, s);
    } catch (e) {
      setBusy(null);
      notify(errText(e));
      return;
    }
    if (jobId.current !== revision) return;
    startJob(
      new Worker(new URL("./convert.worker.ts", import.meta.url), {
        type: "module",
      }),
      "正在生成拼豆图…",
      { raster, settings: s },
      (data) => {
        const p = current.current;
        commit({
          ...p,
          source,
          sourceName: name,
          width: s.width,
          height: s.height,
          cells: data.cells,
          settings: s,
          name:
            source === p.source
              ? p.name
              : name.replace(/\.[^.]+$/, "") || p.name,
          view: "beads",
        });
        setZoom(1);
        notify("图纸已生成，开始创作吧");
      },
    );
  }
  function startJob(
    w: Worker,
    message: string,
    payload: unknown,
    done: (data: any) => void,
  ) {
    worker.current?.terminate();
    worker.current = w;
    const id = ++jobId.current;
    setBusy({ progress: 0, message });
    w.onmessage = ({ data }) => {
      if (jobId.current !== id) return;
      if (data.error) {
        notify(data.error);
        setBusy(null);
        w.terminate();
        worker.current = null;
        return;
      }
      if (data.cells || data.done) {
        setBusy(null);
        w.terminate();
        worker.current = null;
        done(data);
      } else
        setBusy({
          progress: data.progress || 0,
          message: data.detail || message,
        });
    };
    w.onerror = (e) => {
      if (jobId.current !== id) return;
      setBusy(null);
      notify("处理失败：" + e.message);
      w.terminate();
      worker.current = null;
    };
    w.postMessage(payload);
  }
  function cancelJob() {
    jobId.current++;
    worker.current?.terminate();
    worker.current = null;
    setBusy(null);
    notify("已取消，当前作品未改变");
  }
  function autoCropCurrent() {
    let x = project.width,
      y = project.height,
      right = -1,
      bottom = -1;
    for (let i = 0; i < project.cells.length; i++)
      if (project.cells[i] >= 0) {
        const cx = i % project.width,
          cy = Math.floor(i / project.width);
        x = Math.min(x, cx);
        y = Math.min(y, cy);
        right = Math.max(right, cx);
        bottom = Math.max(bottom, cy);
      }
    if (right < 0) {
      notify("图纸为空，请手动选择裁剪范围");
      return;
    }
    const w = Math.max(16, right - x + 1),
      h = Math.max(16, bottom - y + 1);
    setCropRect({
      x: Math.min(x, project.width - w),
      y: Math.min(y, project.height - h),
      w,
      h,
    });
  }
  function confirmCrop() {
    try {
      commit(cropProject(project, cropRect));
      setCropActive(false);
    } catch (e) {
      notify(errText(e));
    }
  }
  function fillSelection(value: number) {
    if (!selection.size) return;
    if (value >= 0 && project.settings.disabled.includes(value)) {
      notify("该色号已禁用");
      return;
    }
    const cells = project.cells.slice();
    for (const i of selection) cells[i] = value;
    commit({ ...project, cells }, true);
  }
  async function openWorks() {
    setModal("works");
    setFormError("");
    try {
      setLocalWorks(await listLocal());
      if (user) setCloudWorks((await api("/works")).works);
    } catch (e) {
      setFormError(errText(e));
    }
  }
  async function saveCloud() {
    if (!user) {
      setModal("auth");
      return;
    }
    setNetworkBusy(true);
    try {
      const p = current.current;
      const result = await api("/works/" + p.id, {
        method: "PUT",
        body: JSON.stringify({
          project: serialize(p),
          expectedUpdated: cloudVersions.current.get(p.id),
        }),
      });
      cloudVersions.current.set(p.id, result.updated);
      notify("作品已保存到独立服务");
    } catch (e) {
      notify(errText(e));
    } finally {
      setNetworkBusy(false);
    }
  }
  async function openProject(p: Project) {
    try {
      await saveLocal(current.current);
      commit(p);
      setModal(null);
      setZoom(1);
    } catch (e) {
      notify("切换作品失败：" + errText(e));
    }
  }
  function previewEdges(value: number) {
    const strength = Math.max(0, Math.min(100, value));
    let base = edgeBase.current;
    if (!base || base.last !== project.cells)
      base = { base: project.cells.slice(), last: project.cells };
    const cells = enhanceEdges(
      base.base,
      project.width,
      project.height,
      strength,
    );
    base.last = cells;
    edgeBase.current = base;
    change({
      ...project,
      cells,
      settings: { ...project.settings, edges: strength },
    });
  }
  function updateSettings(s: Partial<Settings>) {
    change({ ...project, settings: { ...project.settings, ...s } });
  }
  function applySettings() {
    if (
      !Number.isInteger(boardW) ||
      !Number.isInteger(boardH) ||
      boardW < 16 ||
      boardH < 16 ||
      boardW > 1000 ||
      boardH > 1000
    ) {
      notify("宽高必须是16～1000的整数");
      return;
    }
    if (project.source) {
      generate(project.source, project.sourceName || project.name, {
        ...project.settings,
        width: boardW,
        height: boardH,
      });
      return;
    }
    const cells = new Int16Array(boardW * boardH).fill(-1);
    for (let y = 0; y < Math.min(boardH, project.height); y++)
      cells.set(
        project.cells.subarray(
          y * project.width,
          y * project.width + Math.min(boardW, project.width),
        ),
        y * boardW,
      );
    commit({
      ...project,
      width: boardW,
      height: boardH,
      cells,
      settings: { ...project.settings, width: boardW, height: boardH },
    });
    notify("板子尺寸已更新，已有格子按左上角保留");
  }
  function openAdjust(kind: "adjust" | "align") {
    setAdjust({
      ...project.settings,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpen: 0,
      exposure: 0,
    });
    setModal(kind);
  }
  function doExport() {
    setModal(null);
    const snapshot = { ...project, cells: project.cells.slice() };
    startJob(
      new Worker(new URL("./export.worker.ts", import.meta.url), {
        type: "module",
      }),
      "正在准备图纸…",
      { project: snapshot, options: exportOptions },
      (data) => {
        setReadyExport({
          blob: new Blob([data.bytes], {
            type: data.extension === "png" ? "image/png" : "application/zip",
          }),
          name: `${safeName(snapshot.name)}_${exportOptions.kind}${exportOptions.mirror ? "_镜像" : ""}.${data.extension}`,
        });
      },
    );
  }
  const filteredColors = (
    paletteTab === "used"
      ? counts.map((v) => v[0]).sort((a, b) => a - b)
      : PALETTE.map((_, i) => i)
  ).filter((i) =>
    `${PALETTE[i].code} ${PALETTE[i].name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const action = (
    label: string,
    Icon: typeof Hand,
    onClick: () => void,
    extra = "",
  ) => (
    <button className={extra} onClick={onClick}>
      <Icon size={17} />
      <span>{label}</span>
    </button>
  );
  return (
    <div
      className={
        "app " + (focus ? "focus " : "") + (mobileSide ? "side-open" : "")
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        data-testid="image-input"
        onChange={(e) => {
          receiveFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".json"
        hidden
        data-testid="project-input"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            if (file.size > 16e6) throw Error("项目文件超过16MB");
            await openProject(deserialize(JSON.parse(await file.text())));
          } catch (e) {
            notify("项目导入失败：" + errText(e));
          }
        }}
      />
      <input
        ref={referenceInput}
        data-testid="reference-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f)
            try {
              const url = await readImage(f);
              commit({
                ...project,
                reference: {
                  url,
                  opacity: 0.35,
                  x: 0,
                  y: 0,
                  width: project.width,
                  height: project.height,
                },
              });
              setModal("reference");
            } catch (e) {
              notify(errText(e));
            }
        }}
      />
      <header className="app-header">
        <div className="header-identity">
          <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
            <strong>{BRAND.english}（{BRAND.name}）</strong>
          </a>
          <div className="project-title">
            <input
              aria-label="作品名称"
              value={project.name}
              maxLength={120}
              onChange={(e) => change({ ...project, name: e.target.value })}
            />
            <span
              className={"save-state " + (saved === "保存失败" ? "failed" : "")}
            >
              <i />
              {saved}
            </span>
          </div>
        </div>
        <p className="header-tip">
          <strong>小贴士：</strong>
          如果想要还原度高尽量选择221最大颜色数，板子尺寸尽量大一点（建议100–200，根据图片尺寸选择）下载图片可以看到具体对应颜色色卡哦
        </p>
        <button
          className="account-button"
          onClick={() => (user ? openWorks() : setModal("auth"))}
        >
          <UserCircle size={24} />
          <span>
            {user ? user.username : "登录 / 注册"}
            <small>{user ? "独立账号 · 我的作品" : "本地功能全部开放"}</small>
          </span>
        </button>
        <nav className="top-toolbar" aria-label="工作台操作">
          {action("查看引导", Question, () => setModal("help"))}
          {action(
            "上传图片",
            ImageSquare,
            () => fileInput.current?.click(),
            "",
          )}
          {action("自定义创作", PencilSimple, () => setModal("new"))}
          <button disabled title="原站当前禁用，未接入AI服务">
            <MagicWand size={17} />
            AI 生图
          </button>
          <span className="toolbar-divider" />
          {action("下载图纸", DownloadSimple, () => setModal("export"))}
          {action(
            "用豆清单",
            FileArrowDown,
            () => setModal("bead-list"),
            "bead-list-entry",
          )}
          {action("保存", FloppyDisk, saveNamed)}
          {action("保存至我的作品", CloudArrowUp, openWorks, "soft")}
          {action(
            "进入拼豆模式",
            PencilSimple,
            () => {
              setTool("brush");
              change({ ...project, view: "beads" });
              notify("已进入拼豆模式，可直接编辑格子");
            },
            "soft",
          )}
          {action(
            "图片转马赛克",
            GridFour,
            () => {
              if (project.source)
                setIncoming({
                  source: project.source,
                  name: project.sourceName || project.name,
                });
              else notify("请先上传一张图片");
            },
            "mosaic-entry",
          )}
          <div className="header-local-note">
            <Eye size={17} />
            <span>
              <strong>本地完整制图已开放</strong>
              <small>完整色号、保存与高清导出</small>
            </span>
            <button onClick={openWorks} aria-label="我的作品">
              我的作品
            </button>
          </div>
          <button
            className="project-backup-shortcut"
            onClick={() => downloadProject(project)}
          >
            导出项目
          </button>
        </nav>
      </header>
      {notice && (
        <div className="announcement">
          <span className="notice-icon">
            <Leaf size={18} />
          </span>
          <div>
            <strong>本地工作台 · 完整制图能力开放</strong>
            <p>
              图片会在浏览器中处理，可自由裁剪、调整板子尺寸和最大颜色数；生成后可使用画笔、橡皮、选区和颜色替换继续编辑。导出的图案、色卡与用量均来自当前图纸。
              <br />
              草稿自动保存于此浏览器，重要作品请通过“我的作品”保存命名副本或导出项目文件备份。账号作品保存在配套的独立服务中，与原站账号不互通。
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="收起提示"
            onClick={() => setNotice(false)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <main
        className="workspace"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          receiveFile(e.dataTransfer.files?.[0]);
        }}
      >
        <aside className="tool-rail" aria-label="编辑工具">
          {tools.map(({ id, name, key, icon: Icon }) => (
            <button
              key={id}
              aria-label={name}
              title={`${name} (${key})`}
              aria-pressed={tool === id}
              className={tool === id ? "active" : ""}
              onClick={() => setTool(id)}
            >
              <Icon size={22} weight={tool === id ? "fill" : "bold"} />
              <span>{name}</span>
            </button>
          ))}
          <hr />
          {[
            {
              name: "自选颜色",
              icon: GridFour,
              run: () => setModal("palette"),
            },
            {
              name: "添加底图",
              icon: ImageSquare,
              run: () => referenceInput.current?.click(),
            },
            {
              name: "识别图片色号",
              icon: GridFour,
              run: () => {
                project.source
                  ? setIncoming({
                      source: project.source,
                      name: project.sourceName || project.name,
                      initial: {
                        ...project.settings,
                        width: boardW,
                        height: boardH,
                        mode: "recognize",
                      },
                    })
                  : fileInput.current?.click();
                notify("选择已对齐图纸，并使用中心采样识别模式");
              },
            },
            {
              name: "替换颜色",
              icon: Swap,
              run: () => {
                setReplaceFrom(color);
                setModal("replace");
              },
            },
            {
              name: "识别成手搓图",
              icon: MagicWand,
              run: () => {
                setIncoming({
                  source: project.source || projectImage(project),
                  name: project.sourceName || project.name,
                });
                updateSettings({ mode: "simple" });
              },
            },
            {
              name: "禁用色号",
              icon: WarningCircle,
              run: () => setModal("disable"),
            },
            {
              name: "图纸调节",
              icon: SlidersHorizontal,
              run: () => openAdjust("adjust"),
            },
            {
              name: "网格对齐",
              icon: GridFour,
              run: () => openAdjust("align"),
            },
            { name: "更多", icon: DotsThree, run: () => setModal("more") },
          ].map(({ name, icon: Icon, run }) => (
            <button key={name} aria-label={name} title={name} onClick={run}>
              <Icon size={21} weight="bold" />
              <span>{name}</span>
            </button>
          ))}
        </aside>
        <section
          className={
            "editor-column" +
            (tool === "brush" || tool === "eraser" || selection.size > 0
              ? " has-dock"
              : "")
          }
        >
          <div className="editor-heading">
            <div className="segmented view-tabs">
              <button
                onClick={() => setFocus(!focus)}
                className={focus ? "active" : ""}
              >
                <ArrowsOut size={15} />
                <span>{focus ? "退出专注" : "专注模式"}</span>
              </button>
              <button
                className={project.view === "original" ? "active" : ""}
                onClick={() => {
                  if (!project.source) {
                    notify("当前作品没有原图，请先上传图片");
                    return;
                  }
                  change({ ...project, view: "original" });
                }}
              >
                原图
              </button>
              <button
                className={project.view === "beads" ? "active" : ""}
                onClick={() => change({ ...project, view: "beads" })}
              >
                拼豆图
              </button>
              <button
                className={project.view === "iron" ? "active" : ""}
                onClick={() => change({ ...project, view: "iron" })}
              >
                熨烫
              </button>
              <button
                className={project.grid.codes ? "active" : ""}
                onClick={() =>
                  change({
                    ...project,
                    grid: { ...project.grid, codes: !project.grid.codes },
                  })
                }
              >
                色号
              </button>
            </div>
            <button
              className="mobile-settings soft"
              onClick={() => setMobileSide(!mobileSide)}
            >
              <SlidersHorizontal size={17} />
              设置与用量
            </button>
          </div>
          <div className="canvas-shell">
            <div className="canvas-meta">
              <span>
                <i className="live-dot" /> {project.width} × {project.height} 格
              </span>
              <span>
                {project.view === "iron"
                  ? "熨烫效果预览"
                  : project.view === "original"
                    ? "原图参考"
                    : "拼豆工作区"}
              </span>
            </div>
            <CanvasEditor
              project={project}
              tool={tool}
              color={color}
              brush={brush}
              zoom={zoom}
              setZoom={setZoom}
              selection={selection}
              setSelection={selectCells}
              checkpoint={checkpoint}
              change={change}
              onCursor={onCursor}
              fitKey={fitKey}
              crop={
                cropActive
                  ? {
                      rect: cropRect,
                      onChange: setCropRect,
                      onCancel: () => setCropActive(false),
                      onConfirm: confirmCrop,
                      onAuto: autoCropCurrent,
                    }
                  : undefined
              }
            />
            <div className="canvas-floating">
              <div
                className="current-color"
                style={{ background: PALETTE[color].hex }}
              />
              <b>{PALETTE[color].code}</b>
              <span>{tools.find((t) => t.id === tool)?.name}</span>
              {(tool === "brush" || tool === "eraser") && (
                <div className="brush-sizes">
                  {[1, 2, 3, 5].map((n) => (
                    <button
                      key={n}
                      aria-label={`${n}格画笔`}
                      className={brush === n ? "active" : ""}
                      onClick={() => setBrush(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
              <span className="floating-divider" />
              <button
                aria-label="缩小"
                onClick={() =>
                  setZoom(
                    Math.max(
                      0.1,
                      Math.round(
                        (zoom - (zoom < 2 ? 0.25 : zoom < 5 ? 0.5 : 1)) * 100,
                      ) / 100,
                    ),
                  )
                }
              >
                <Minus size={15} />
              </button>
              {zoomInput === null ? (
                <button
                  className="zoom-label"
                  aria-label="编辑缩放比例"
                  onClick={() => setZoomInput(String(Math.round(zoom * 100)))}
                >
                  {Math.round(zoom * 100)}%<small>编辑</small>
                </button>
              ) : (
                <input
                  className="zoom-number"
                  autoFocus
                  aria-label="缩放百分比"
                  type="number"
                  min="10"
                  max="1500"
                  value={zoomInput}
                  onChange={(e) => setZoomInput(e.target.value)}
                  onBlur={() => {
                    const n = Number(zoomInput);
                    if (Number.isFinite(n) && n > 0)
                      setZoom(Math.max(0.1, Math.min(15, n / 100)));
                    setZoomInput(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setZoomInput(null);
                  }}
                />
              )}
              <button
                aria-label="放大"
                onClick={() =>
                  setZoom(
                    Math.min(
                      15,
                      Math.round(
                        (zoom + (zoom < 2 ? 0.25 : zoom < 5 ? 0.5 : 1)) * 100,
                      ) / 100,
                    ),
                  )
                }
              >
                <Plus size={15} />
              </button>
              <button
                aria-label="适应画布"
                title="适应画布"
                onClick={() => setFitKey((k) => k + 1)}
              >
                <ArrowsOut size={16} />
              </button>
            </div>
          </div>
          {(tool === "brush" || tool === "eraser" || selection.size > 0) && (
            <div className="editing-dock">
              {selection.size > 0 ? (
                <div className="selection-toolbar">
                  <b>已选 {selection.size} 格</b>
                  <button onClick={() => fillSelection(color)}>
                    填入 {PALETTE[color].code}
                  </button>
                  <button onClick={() => fillSelection(-1)}>清除选区</button>
                  <button onClick={() => selectCells(new Set())}>取消</button>
                </div>
              ) : (
                <div className="brush-options">
                  <span>{tool === "eraser" ? "方形橡皮" : "方形画笔"}</span>
                  {[1, 2, 3, 5].map((n) => (
                    <button
                      key={n}
                      aria-label={`${n}格画笔`}
                      className={n === brush ? "active" : ""}
                      onClick={() => setBrush(n)}
                    >
                      {n}×{n}
                    </button>
                  ))}
                  <em>操作提示</em>
                  <small>电脑按住鼠标拖动；手机/平板可拖动连续填色。</small>
                </div>
              )}
            </div>
          )}
          <div className="bottom-toolbar">
            <button
              aria-label="撤销"
              disabled={!undo.current.length}
              onClick={undoEdit}
            >
              <ArrowCounterClockwise />
              撤销
            </button>
            <button
              aria-label="重做"
              disabled={!redo.current.length}
              onClick={redoEdit}
            >
              <ArrowClockwise />
              前进
            </button>
            <button
              className="danger-quiet"
              onClick={() => {
                commit({
                  ...project,
                  cells: new Int16Array(project.cells.length).fill(-1),
                });
                notify("画面已清除，可撤销恢复");
              }}
            >
              <Trash />
              清除画面
            </button>
            <span className="toolbar-divider" />
            {action("旋转90°", ArrowsClockwise, () =>
              commit(transform(project, "rotate")),
            )}
            {action("左右翻转", FlipHorizontal, () =>
              commit(transform(project, "flipX")),
            )}
            {action("上下翻转", FlipVertical, () =>
              commit(transform(project, "flipY")),
            )}
            {action("手动裁剪", Crop, () => {
              setCropRect({ x: 0, y: 0, w: project.width, h: project.height });
              setCropActive(true);
              setTool("hand");
              setSelection(new Set());
            })}
            <span className="toolbar-divider" />
            <button
              className={project.grid.lines ? "soft" : ""}
              onClick={() =>
                change({
                  ...project,
                  grid: { ...project.grid, lines: !project.grid.lines },
                })
              }
            >
              <GridFour />
              显示网格
            </button>
            <details className="grid-color-settings">
              <summary>网格颜色</summary>
              <div className="grid-color-popover">
                {(
                  [
                    ["color", "普通格", "普通网格颜色"],
                    ["majorColor", "每5格", "5格网格颜色"],
                    ["blockColor", "每10格", "10格网格颜色"],
                  ] as const
                ).map(([key, label, aria]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="color"
                      aria-label={aria}
                      value={
                        project.grid[key] ||
                        (key === "color" ? "#a0c4bc" : "#29a88f")
                      }
                      onChange={(e) =>
                        change({
                          ...project,
                          grid: { ...project.grid, [key]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  onClick={() =>
                    change({
                      ...project,
                      grid: {
                        ...project.grid,
                        color: "#a0c4bc",
                        majorColor: "#29a88f",
                        blockColor: "#29a88f",
                      },
                    })
                  }
                >
                  恢复推荐
                </button>
              </div>
            </details>
            <button
              className={project.grid.codes ? "soft" : ""}
              disabled={project.view === "iron"}
              onClick={() =>
                change({
                  ...project,
                  grid: { ...project.grid, codes: !project.grid.codes },
                })
              }
            >
              <Palette />
              显示色号
            </button>
            <button
              className={project.grid.coordinates ? "soft" : ""}
              onClick={() =>
                change({
                  ...project,
                  grid: {
                    ...project.grid,
                    coordinates: !project.grid.coordinates,
                  },
                })
              }
            >
              显示坐标
            </button>
          </div>
          <div className="editor-status">
            <span>
              {cursor || "滚轮缩放 · H拖动画布 · B画笔 · Ctrl/⌘ Z撤销"}
            </span>
            <span data-testid="bead-total">
              {total.toLocaleString()} 颗 · {counts.length} 色 ·{" "}
              {project.cells.length - total} 空格
            </span>
          </div>
        </section>
        <aside className="settings-panel">
          <div className="mobile-panel-header">
            <b>板子与用量</b>
            <button
              className="icon-button"
              aria-label="关闭设置"
              onClick={() => setMobileSide(false)}
            >
              <X />
            </button>
          </div>
          <section className="panel-section">
            <div className="section-title">
              <h3>板子设置</h3>
              <span>
                {project.width} × {project.height}
              </span>
              <select
                className="preset-select"
                aria-label="常规板尺寸推荐"
                value=""
                onChange={(e) => {
                  const n = +e.target.value;
                  if (n) {
                    setBoardW(n);
                    setBoardH(n);
                  }
                }}
              >
                <option value="">常规板尺寸推荐</option>
                {[52, 78, 104, 120].map((n) => (
                  <option key={n} value={n}>
                    {n} × {n}
                  </option>
                ))}
              </select>
            </div>

            <label className="label">板子尺寸</label>
            <div className="dimensions">
              <label>
                宽
                <input
                  aria-label="板子宽度"
                  type="number"
                  min="16"
                  max="1000"
                  value={boardW}
                  onChange={(e) => setBoardW(+e.target.value)}
                />
              </label>
              <span>×</span>
              <label>
                高
                <input
                  aria-label="板子高度"
                  type="number"
                  min="16"
                  max="1000"
                  value={boardH}
                  onChange={(e) => setBoardH(+e.target.value)}
                />
              </label>
            </div>
            <p className="micro">宽、高分别设置，范围16～1000</p>
            <MaterialSettings
              settings={project.settings}
              onChange={updateSettings}
              width={project.width}
              height={project.height}
            />
            <label className="field">
              最大颜色数{" "}
              <b>
                <input
                  className="color-limit-number"
                  aria-label="最大颜色数数值"
                  type="number"
                  min="3"
                  max="221"
                  value={project.settings.limit}
                  onChange={(e) =>
                    updateSettings({
                      limit: Math.max(3, Math.min(221, +e.target.value || 3)),
                    })
                  }
                />
                <small> / 221</small>
              </b>
              <input
                aria-label="最大颜色数"
                type="range"
                min="3"
                max="221"
                value={project.settings.limit}
                onChange={(e) => updateSettings({ limit: +e.target.value })}
              />
            </label>
            <label className="check-box">
              <input
                type="checkbox"
                checked={project.settings.merge > 0}
                onChange={(e) =>
                  updateSettings({ merge: e.target.checked ? 3 : 0 })
                }
              />
              <span>
                <b>自动合并少量杂色</b>
                <small>
                  合并极少色号，并清理相近色造成的孤立杂点；深色线条会优先保留。
                </small>
              </span>
            </label>
            <button className="soft full" onClick={applySettings}>
              应用到当前图纸 <ArrowRight size={16} />
            </button>
            <div className="edge-control">
              <label className="field">
                边缘强化{" "}
                <b>
                  <span>实时预览</span>
                  <input
                    className="edge-number"
                    type="number"
                    aria-label="当前图纸边缘强化数值"
                    min="0"
                    max="100"
                    value={project.settings.edges}
                    onFocus={checkpoint}
                    onChange={(e) => previewEdges(+e.target.value)}
                  />
                  %
                </b>
                <input
                  aria-label="当前图纸边缘强化强度"
                  type="range"
                  min="0"
                  max="100"
                  value={project.settings.edges}
                  onPointerDown={checkpoint}
                  onChange={(e) => previewEdges(+e.target.value)}
                />
              </label>
              <p className="micro">
                拖动即可在图纸上实时预览；会将边缘多余近色归并到连续轮廓色；此功能推荐中小图使用，大图或者人像不建议使用。
              </p>
              <button
                className="primary outline-action"
                onClick={() => setModal("outline")}
              >
                识别 / 手绘边缘 · 统一色号
              </button>
            </div>
            <button
              className="soft similar-action"
              onClick={() => setModal("similar")}
            >
              使用相似色号合并
            </button>
            {project.reference && (
              <button
                className="soft full"
                onClick={() => setModal("reference")}
              >
                调节描摹底图
              </button>
            )}
          </section>
          <section className="panel-section usage-section">
            <div className="section-title">
              <h3>调色板</h3>
              <button
                className="text-button"
                onClick={() => setModal("palette")}
              >
                全部221色 <CaretDown />
              </button>
            </div>
            <div className="selected-color">
              <div style={{ background: PALETTE[color].hex }} />
              <span>
                <b>{PALETTE[color].code}</b>
                <small>{PALETTE[color].name}</small>
              </span>
              <strong>
                {countMap.get(color) || 0}
                <small> 颗</small>
              </strong>
            </div>
            <div className="palette-switch">
              <button
                className={paletteTab === "used" ? "active" : ""}
                onClick={() => setPaletteTab("used")}
              >
                当前用色 {counts.length}
              </button>
              <button
                className={paletteTab === "all" ? "active" : ""}
                onClick={() => setPaletteTab("all")}
              >
                全部色卡
              </button>
            </div>
            <input
              className="search"
              aria-label="搜索色号"
              placeholder="搜索色号，如 A1、H7"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="side-colors">
              {filteredColors.map((i) => (
                <button
                  key={i}
                  title={`${PALETTE[i].code} · ${PALETTE[i].name} · ${countMap.get(i) || 0}颗`}
                  aria-label={`选择色号${PALETTE[i].code}`}
                  className={
                    (i === color ? "selected " : "") +
                    (project.settings.disabled.includes(i)
                      ? "disabled-color"
                      : "")
                  }
                  onClick={() => {
                    setColor(i);
                    setTool("brush");
                  }}
                >
                  <span style={{ background: PALETTE[i].hex }} />
                  <div className="color-row-copy">
                    <strong>{PALETTE[i].code}</strong>
                    <small>{PALETTE[i].name}</small>
                  </div>
                  <em>需要 {countMap.get(i) || 0} 颗</em>
                </button>
              ))}
              {!filteredColors.length && (
                <p className="muted empty-small">
                  {search ? "没有匹配的色号" : "这里将显示画面中用到的色号"}
                </p>
              )}
            </div>
            <div className="usage-summary">
              <span>预计用量</span>
              <strong data-testid="usage-total">
                {total.toLocaleString()} <small>颗</small>
              </strong>
            </div>
            <button className="full soft" onClick={() => setModal("bead-list")}>
              用豆清单 · 复制与下载
            </button>
          </section>
          <section className="panel-section export-preview">
            <div className="section-title">
              <h3>导出预览</h3>
              <span className="tag">高清 PNG</span>
            </div>
            <div className="mini-preview">
              <ExportPreview project={project} />
              <div>
                <b>{project.name}</b>
                <small>
                  {project.width} × {project.height} 格 · {counts.length} 色
                </small>
                <span>{total.toLocaleString()} 颗拼豆</span>
              </div>
            </div>
            <p className="micro">逐格色号 · 宽高坐标 · 完整用量清单</p>
            <label className="check">
              <input
                type="checkbox"
                checked={exportOptions.mirror}
                onChange={(e) =>
                  setExportOptions({
                    ...exportOptions,
                    mirror: e.target.checked,
                  })
                }
              />
              镜像导出（熨烫用）
            </label>
            <button className="primary full" onClick={() => setModal("export")}>
              <DownloadSimple size={18} />
              导出图纸
            </button>
            <div className="export-links">
              <button
                onClick={() => {
                  setExportOptions({ ...exportOptions, kind: "palette" });
                  setModal("export");
                }}
              >
                独立色卡
              </button>
              <button
                onClick={() => {
                  setExportOptions({ ...exportOptions, kind: "sections" });
                  setModal("export");
                }}
              >
                分板导出
              </button>
            </div>
          </section>
          <p className="sidebar-footer">
            本地工作台 · 数据只在你选择时上传至独立服务
          </p>
        </aside>
      </main>
      {incoming && (
        <ImportDialog
          source={incoming.source}
          name={incoming.name}
          initial={
            incoming.initial ?? {
              ...project.settings,
              width: boardW,
              height: boardH,
            }
          }
          onClose={() => setIncoming(null)}
          onGenerate={(s) => generate(incoming.source, incoming.name, s)}
        />
      )}
      {modal === "bead-list" && (
        <BeadListDialog
          project={project}
          onSettings={updateSettings}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "new" && (
        <Dialog title="自定义创作" onClose={() => setModal(null)}>
          <p className="muted">从一块空白板开始，画下你的第一个像素。</p>
          <p className="micro">
            MARD 标准221色 · 2.6 mm 迷你豆 · 屏幕颜色仅供参考
          </p>
          <div className="preset-row large">
            {[52, 78, 104, 120].map((n) => (
              <button
                key={n}
                className={newW === n && newH === n ? "active" : ""}
                onClick={() => {
                  setNewW(n);
                  setNewH(n);
                }}
              >
                {n} × {n}
              </button>
            ))}
          </div>
          <div className="dimensions">
            <label>
              宽
              <input
                aria-label="新建宽度"
                type="number"
                min="16"
                max="1000"
                value={newW}
                onChange={(e) => setNewW(+e.target.value)}
              />
            </label>
            <span>×</span>
            <label>
              高
              <input
                aria-label="新建高度"
                type="number"
                min="16"
                max="1000"
                value={newH}
                onChange={(e) => setNewH(+e.target.value)}
              />
            </label>
          </div>
          <div className="creation-info">
            <GridFour size={32} />
            <span>
              即将创建 <b>{(newW * newH).toLocaleString()}</b> 个可编辑格子
              <small>当前画面会自动备份到本地作品</small>
            </span>
          </div>
          <footer>
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              onClick={async () => {
                if (
                  !Number.isInteger(newW) ||
                  !Number.isInteger(newH) ||
                  newW < 16 ||
                  newH < 16 ||
                  newW > 1000 ||
                  newH > 1000
                ) {
                  notify("宽高必须是16～1000的整数");
                  return;
                }
                try {
                  await saveLocal(project);
                  commit(blank(newW, newH));
                  setModal(null);
                  setTool("brush");
                  setZoom(1);
                } catch (e) {
                  notify("创建前备份失败：" + errText(e));
                }
              }}
            >
              创建空白板 <ArrowRight />
            </button>
          </footer>
        </Dialog>
      )}
      {modal === "palette" && (
        <ColorPickerDialog
          project={project}
          selected={color}
          onClose={() => setModal(null)}
          onPick={(i) => {
            setColor(i);
            setTool("brush");
            setModal(null);
          }}
          onApply={(allowed) => {
            commit(
              remapDisabled({
                ...project,
                settings: { ...project.settings, allowed },
              }),
            );
            setModal(null);
          }}
        />
      )}
      {(["disable"] as string[]).includes(modal || "") && (
        <Dialog
          title={modal === "disable" ? "禁用指定色号" : "自选颜色与色卡"}
          onClose={() => setModal(null)}
          wide
        >
          <div className="palette-dialog-top">
            <div className="selected-color">
              <div style={{ background: PALETTE[color].hex }} />
              <span>
                <b>{PALETTE[color].code}</b>
                <small>
                  {PALETTE[color].hex} · {PALETTE[color].name}
                </small>
              </span>
            </div>
            <label className="custom-hex">
              自选颜色
              <input
                type="color"
                aria-label="自选颜色"
                value={PALETTE[color].hex}
                onChange={(e) => {
                  const v = e.target.value;
                  setColor(
                    nearest(
                      parseInt(v.slice(1, 3), 16),
                      parseInt(v.slice(3, 5), 16),
                      parseInt(v.slice(5, 7), 16),
                    ),
                  );
                }}
              />
            </label>
            <input
              className="search"
              aria-label="弹窗搜索色号"
              placeholder="搜索色号 / 色系"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <p className="muted">
            {modal === "disable"
              ? "点击色号切换禁用状态。应用后，已有格子会改用最接近的可用色号。"
              : "点击选择画笔颜色；勾选色卡后可将画面限制在自选色号内。任意颜色输入会就近映射到固定221色色卡。"}
          </p>
          <div className="full-palette">
            {PALETTE.map((c, i) => ({ c, i }))
              .filter(({ c }) =>
                `${c.code} ${c.name}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map(({ c, i }) => (
                <div
                  key={i}
                  className={
                    "palette-tile " +
                    (color === i ? "selected " : "") +
                    (project.settings.disabled.includes(i)
                      ? "disabled-color"
                      : "")
                  }
                >
                  <button
                    aria-label={`色卡${c.code}`}
                    style={{ background: c.hex }}
                    title={c.name}
                    onClick={() => {
                      if (modal === "disable") {
                        const d = project.settings.disabled;
                        updateSettings({
                          disabled: d.includes(i)
                            ? d.filter((v) => v !== i)
                            : [...d, i],
                        });
                      } else setColor(i);
                    }}
                  />
                  <span>{c.code}</span>
                  {modal === "palette" ? (
                    <input
                      type="checkbox"
                      aria-label={`纳入自选${c.code}`}
                      checked={project.settings.allowed.includes(i)}
                      onChange={(e) =>
                        updateSettings({
                          allowed: e.target.checked
                            ? [...project.settings.allowed, i]
                            : project.settings.allowed.filter((n) => n !== i),
                        })
                      }
                    />
                  ) : (
                    <small>
                      {project.settings.disabled.includes(i)
                        ? "已禁用"
                        : "可使用"}
                    </small>
                  )}
                </div>
              ))}
          </div>
          <footer>
            <button
              onClick={() =>
                updateSettings(
                  modal === "disable" ? { disabled: [] } : { allowed: [] },
                )
              }
            >
              {modal === "disable" ? "恢复全部色号" : "清空自选限制"}
            </button>
            <span className="muted">
              {modal === "disable"
                ? project.settings.disabled.length + " 色已禁用"
                : project.settings.allowed.length + " 色已勾选"}
            </span>
            <button
              className="soft"
              onClick={() => {
                setTool("brush");
                setModal(null);
              }}
            >
              使用 {PALETTE[color].code} 画笔
            </button>
            <button
              className="primary"
              onClick={() => {
                try {
                  if (modal === "palette" && !project.settings.allowed.length) {
                    notify("请至少勾选一种颜色");
                    return;
                  }
                  commit(remapDisabled(project));
                  setModal(null);
                  notify("颜色限制已应用");
                } catch (e) {
                  notify(errText(e));
                }
              }}
            >
              应用到当前图纸
            </button>
          </footer>
        </Dialog>
      )}
      {modal === "replace" && (
        <Dialog title="替换单个色号" onClose={() => setModal(null)}>
          <p className="muted">
            全图替换指定颜色，空格不会被计入。可随时撤销。
          </p>
          <div className="replace-row">
            <label className="field">
              原色号
              <select
                aria-label="原色号"
                value={replaceFrom}
                onChange={(e) => setReplaceFrom(+e.target.value)}
              >
                {PALETTE.map((c, i) => (
                  <option key={i} value={i}>
                    {c.code} · {countMap.get(i) || 0}颗
                  </option>
                ))}
              </select>
              <div
                className="replace-swatch"
                style={{ background: PALETTE[replaceFrom].hex }}
              />
            </label>
            <ArrowRight size={24} />
            <label className="field">
              替换为
              <select
                aria-label="目标色号"
                value={replaceTo}
                onChange={(e) => setReplaceTo(+e.target.value)}
              >
                {PALETTE.map((c, i) => (
                  <option
                    key={i}
                    value={i}
                    disabled={project.settings.disabled.includes(i)}
                  >
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
              <div
                className="replace-swatch"
                style={{ background: PALETTE[replaceTo].hex }}
              />
            </label>
          </div>
          <footer>
            <span>将替换 {countMap.get(replaceFrom) || 0} 格</span>
            <button
              className="primary"
              onClick={() => {
                if (project.settings.disabled.includes(replaceTo)) {
                  notify("目标色号已禁用");
                  return;
                }
                const cells = project.cells.map((v) =>
                  v === replaceFrom ? replaceTo : v,
                );
                commit({ ...project, cells });
                setColor(replaceTo);
                setModal(null);
                notify("颜色已替换");
              }}
            >
              替换全部
            </button>
          </footer>
        </Dialog>
      )}
      {(modal === "adjust" || modal === "align") && (
        <Dialog
          title={modal === "adjust" ? "图纸调节" : "图纸识别与网格对齐"}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            {modal === "adjust"
              ? "调节原图后重新匹配色卡。当前编辑会备份，结果可撤销。"
              : "适用于已经按格对齐的图案。调整采样偏移后，按格心识别色号；不自动推断网格间距。"}
          </p>
          {modal === "adjust" ? (
            <>
              {(
                [
                  "brightness",
                  "contrast",
                  "saturation",
                  "sharpen",
                  "exposure",
                ] as const
              ).map((key, i) => (
                <label className="field" key={key}>
                  {["亮度", "对比度", "饱和度", "锐化", "曝光"][i]}
                  <b>{adjust[key]}</b>
                  <input
                    aria-label={["亮度", "对比度", "饱和度", "锐化", "曝光"][i]}
                    type="range"
                    min={key === "sharpen" ? 0 : -100}
                    max="100"
                    value={adjust[key]}
                    onChange={(e) =>
                      setAdjust({ ...adjust, [key]: +e.target.value })
                    }
                  />
                </label>
              ))}
            </>
          ) : (
            <>
              {(["alignX", "alignY"] as const).map((key, i) => (
                <label className="field" key={key}>
                  {i ? "Y方向偏移" : "X方向偏移"}
                  <b>{adjust[key].toFixed(2)} 格</b>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step=".05"
                    value={adjust[key]}
                    onChange={(e) =>
                      setAdjust({ ...adjust, [key]: +e.target.value })
                    }
                  />
                </label>
              ))}
              <p className="micro">
                板子使用当前 {project.width} × {project.height}{" "}
                格设置。请在导入时将图案紧贴裁剪边缘。
              </p>
            </>
          )}
          <footer>
            <button
              onClick={() =>
                setAdjust({
                  ...adjust,
                  brightness: 0,
                  contrast: 0,
                  saturation: 0,
                  sharpen: 0,
                  exposure: 0,
                  alignX: 0,
                  alignY: 0,
                })
              }
            >
              重置参数
            </button>
            <button
              className="primary"
              onClick={() =>
                modal === "adjust"
                  ? (commit({
                      ...project,
                      cells: adjustPattern(
                        project.cells,
                        project.width,
                        project.height,
                        adjust,
                      ),
                      settings: {
                        ...project.settings,
                        brightness: adjust.brightness,
                        contrast: adjust.contrast,
                        saturation: adjust.saturation,
                        sharpen: adjust.sharpen,
                        exposure: adjust.exposure,
                      },
                    }),
                    setModal(null),
                    notify("图纸调节已应用"))
                  : generate(
                      project.source || projectImage(project),
                      project.sourceName || project.name,
                      {
                        ...adjust,
                        width: project.width,
                        height: project.height,
                        mode: "recognize",
                      },
                    )
              }
            >
              应用并重新生成
            </button>
          </footer>
        </Dialog>
      )}
      {modal === "reference" && (
        <Dialog title="描摹参考底图" onClose={() => setModal(null)}>
          {project.reference ? (
            <>
              <p className="muted">
                底图显示在空格下方，用于描摹，不参与色号、用量或图纸导出。
              </p>
              <label className="field">
                透明度 <b>{Math.round(project.reference.opacity * 100)}%</b>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  value={project.reference.opacity}
                  onChange={(e) =>
                    change({
                      ...project,
                      reference: {
                        ...project.reference!,
                        opacity: +e.target.value,
                      },
                    })
                  }
                />
              </label>
              <div className="reference-fields">
                {(["x", "y", "width", "height"] as const).map((key, i) => (
                  <label className="field" key={key}>
                    {
                      [
                        "X位置（格）",
                        "Y位置（格）",
                        "宽度（格）",
                        "高度（格）",
                      ][i]
                    }
                    <input
                      type="number"
                      min={i > 1 ? 1 : -1000}
                      max="2000"
                      value={project.reference![key]}
                      onChange={(e) =>
                        change({
                          ...project,
                          reference: {
                            ...project.reference!,
                            [key]:
                              i > 1
                                ? Math.max(1, +e.target.value)
                                : +e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <footer>
                <button
                  className="danger-quiet"
                  onClick={() => {
                    commit({ ...project, reference: undefined });
                    setModal(null);
                  }}
                >
                  移除底图
                </button>
                <button onClick={() => referenceInput.current?.click()}>
                  更换图片
                </button>
                <button className="primary" onClick={() => setModal(null)}>
                  完成
                </button>
              </footer>
            </>
          ) : (
            <button
              className="primary"
              onClick={() => referenceInput.current?.click()}
            >
              添加参考底图
            </button>
          )}
        </Dialog>
      )}
      {modal === "export" && (
        <ExportDialog
          project={project}
          options={exportOptions}
          onChange={setExportOptions}
          onClose={() => setModal(null)}
          onExport={doExport}
        />
      )}
      {modal === "works" && (
        <Dialog title="我的作品" onClose={() => setModal(null)} wide>
          <div className="works-actions">
            <button
              className="primary"
              onClick={async () => {
                await saveNamed();
                setLocalWorks(await listLocal());
              }}
            >
              <FloppyDisk />
              保存当前作品
            </button>
            <button onClick={() => projectInput.current?.click()}>
              <FolderOpen />
              导入项目文件
            </button>
            <button onClick={() => downloadProject(project)}>
              <FileArrowDown />
              备份当前项目
            </button>
          </div>
          <h3>
            此浏览器的本地作品{" "}
            <span className="muted">{localWorks.length}</span>
          </h3>
          <div className="works-grid">
            {localWorks.map((p) => (
              <div className="work-card" key={p.id}>
                <button className="work-open" onClick={() => openProject(p)}>
                  <MiniPreview project={p} />
                  <b>{p.name}</b>
                  <small>
                    {p.width}×{p.height} ·{" "}
                    {usage(p.cells).reduce((a, b) => a + b[1], 0)}颗
                  </small>
                </button>
                <div>
                  <button onClick={() => downloadProject(p)}>导出项目</button>
                  <button
                    className="danger-quiet"
                    onClick={async () => {
                      if (
                        window.confirm(
                          "移除此本地作品？建议先导出项目文件备份。",
                        )
                      ) {
                        await removeLocal(p.id);
                        setLocalWorks(await listLocal());
                      }
                    }}
                  >
                    移除
                  </button>
                </div>
              </div>
            ))}
            {!localWorks.length && (
              <p className="muted empty-small">
                还没有保存的作品，当前草稿仍会自动恢复。
              </p>
            )}
          </div>
          <div className="section-title cloud-title">
            <h3>
              独立账号作品{" "}
              {user && <span className="muted">· {user.username}</span>}
            </h3>
            {user ? (
              <button
                onClick={async () => {
                  try {
                    await api("/logout", { method: "POST" });
                    setUser(null);
                    setCloudWorks([]);
                    cloudVersions.current.clear();
                    notify("已退出账号");
                  } catch (e) {
                    setFormError(errText(e));
                  }
                }}
              >
                <SignOut />
                退出登录
              </button>
            ) : (
              <button className="soft" onClick={() => setModal("auth")}>
                登录账号
              </button>
            )}
          </div>
          {user && (
            <>
              <div className="works-actions">
                <button
                  disabled={networkBusy}
                  onClick={async () => {
                    await saveCloud();
                    try {
                      setCloudWorks((await api("/works")).works);
                    } catch (e) {
                      setFormError(errText(e));
                    }
                  }}
                >
                  <CloudArrowUp />
                  保存当前作品到账号
                </button>
                <button
                  onClick={() => {
                    change({
                      ...project,
                      id: crypto.randomUUID(),
                      name: project.name + " 副本",
                    });
                    notify("已创建当前作品副本，可重新保存");
                  }}
                >
                  另存副本
                </button>
              </div>
              <div className="cloud-works">
                {cloudWorks.map((w) => (
                  <div key={w.id}>
                    <span>
                      <b>{w.title}</b>
                      <small>
                        {new Date(w.updated).toLocaleString("zh-CN")}
                      </small>
                    </span>
                    <button
                      className="soft"
                      onClick={async () => {
                        try {
                          const r = await api("/works/" + w.id);
                          const p = deserialize(r.project);
                          await openProject(p);
                          cloudVersions.current.set(w.id, r.updated);
                        } catch (e) {
                          setFormError(errText(e));
                        }
                      }}
                    >
                      打开
                    </button>
                    <button
                      className="danger-quiet"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            "移除服务端作品？建议先下载项目备份。",
                          )
                        )
                          return;
                        try {
                          await api("/works/" + w.id, { method: "DELETE" });
                          setCloudWorks((await api("/works")).works);
                        } catch (e) {
                          setFormError(errText(e));
                        }
                      }}
                    >
                      移除
                    </button>
                  </div>
                ))}
                {!cloudWorks.length && (
                  <p className="muted">账号中还没有作品。</p>
                )}
              </div>
            </>
          )}
          {formError && <p className="error">{formError}</p>}
          <p className="micro">
            自动草稿与本地作品仅保存在此浏览器。账号作品保存在本网站配套的独立服务中。
          </p>
        </Dialog>
      )}
      {modal === "auth" && (
        <Dialog
          title={authMode === "login" ? "欢迎回来" : "创建独立账号"}
          onClose={() => {
            setModal(null);
            setPassword("");
            setFormError("");
          }}
        >
          <div className="segmented auth-tabs">
            <button
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setFormError("");
              }}
            >
              登录
            </button>
            <button
              className={authMode === "register" ? "active" : ""}
              onClick={() => {
                setAuthMode("register");
                setFormError("");
              }}
            >
              注册
            </button>
          </div>
          <p className="muted">账号用于保存服务端作品，本地制图无需登录。</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setNetworkBusy(true);
              setFormError("");
              try {
                const r = await api("/" + authMode, {
                  method: "POST",
                  body: JSON.stringify({ username, password }),
                });
                setUser(r.user);
                setPassword("");
                cloudVersions.current.clear();
                setModal(null);
                notify(authMode === "login" ? "登录成功" : "账号已创建");
              } catch (e) {
                setFormError(errText(e));
              } finally {
                setNetworkBusy(false);
              }
            }}
          >
            <label className="field">
              账号
              <input
                aria-label="账号"
                autoComplete="username"
                required
                minLength={3}
                maxLength={64}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="field">
              密码
              <input
                aria-label="密码"
                type="password"
                autoComplete={
                  authMode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={10}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p className="micro">
              账号3～64位，密码至少10位。本站不连接原站账号，无邮件找回服务。
            </p>
            {formError && <p className="error">{formError}</p>}
            <footer>
              <button
                className="primary full"
                type="submit"
                disabled={networkBusy}
              >
                {networkBusy
                  ? "正在处理…"
                  : authMode === "login"
                    ? "登录账号"
                    : "创建账号"}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {modal === "outline" && (
        <OutlineDialog
          project={project}
          onClose={() => setModal(null)}
          onApply={(cells) => {
            commit({ ...project, cells });
            setModal(null);
            notify("边缘色号已统一，可撤销恢复");
          }}
        />
      )}
      {modal === "similar" && (
        <Dialog title="相似色号合并" onClose={() => setModal(null)}>
          <p className="muted">
            将接近的颜色归并到用量最多的色号，减少备豆种类。先调整阈值查看分组，应用后可撤销。
          </p>
          <label className="field">
            相似度阈值 <b>{similarThreshold}%</b>
            <input
              type="range"
              min="0"
              max="100"
              value={similarThreshold}
              onChange={(e) => setSimilarThreshold(+e.target.value)}
            />
          </label>
          <div className="similar-groups">
            {similarGroups(project.cells, similarThreshold).map((g) => (
              <p key={g.representative}>
                {g.indices.map((i) => PALETTE[i].code).join("、")} →{" "}
                <b>{PALETTE[g.representative].code}</b> · {g.affected}颗
              </p>
            ))}
          </div>
          <footer>
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              onClick={() => {
                commit({
                  ...project,
                  cells: mergeSimilar(
                    project.cells,
                    similarGroups(project.cells, similarThreshold),
                  ),
                });
                setModal(null);
              }}
            >
              应用合并
            </button>
          </footer>
        </Dialog>
      )}
      {modal === "more" && (
        <Dialog title="更多功能" onClose={() => setModal(null)}>
          <div className="coming-soon">
            <DotsThree size={56} />
            <span className="eyebrow">MORE TOOLS</span>
            <h3>待开发</h3>
            <p className="muted">更多实用功能正在规划中，敬请期待。</p>
          </div>
        </Dialog>
      )}
      {modal === "help" && (
        <Dialog title="从图片到一颗颗拼豆" onClose={() => setModal(null)}>
          <ol className="guide">
            <li>
              <b>导入与构图</b>
              <p>
                上传PNG、JPEG或WebP图片，或拖到工作区。选择裁剪、板子宽高与色数，再生成图纸。
              </p>
            </li>
            <li>
              <b>自由编辑</b>
              <p>
                画笔B、橡皮E、吸管I、填充G、套索L、魔法选取M。滚轮缩放，手型H拖动画布。手机支持双指缩放。
              </p>
            </li>
            <li>
              <b>检查与备份</b>
              <p>
                右侧用量随画面同步。自动保存草稿；保存为本地作品，或导出可继续编辑的项目文件。
              </p>
            </li>
            <li>
              <b>导出与拼接</b>
              <p>
                导出带色号、坐标和用量的PNG，或选择52/78/104格分板套装。导出数据与当前画布保持一致。
              </p>
            </li>
          </ol>
          <p className="hint">
            色卡为原站公开221色色值的固定快照；屏幕颜色仅作参考。示例为本地原创图案，高级处理采用独立实现。
          </p>
          <footer>
            <button className="primary" onClick={() => setModal(null)}>
              开始创作 <ArrowRight />
            </button>
          </footer>
        </Dialog>
      )}
      {readyExport && (
        <Dialog title="导出完成" onClose={() => setReadyExport(null)}>
          <div className="export-ready">
            <CheckCircle size={40} />
            <h3>文件已准备好</h3>
            <p className="muted">{readyExport.name}</p>
            <p className="micro">
              {(readyExport.blob.size / 1024).toFixed(1)} KB · 点击保存到设备
            </p>
          </div>
          <footer>
            <button onClick={() => setReadyExport(null)}>关闭</button>
            <button
              className="primary"
              onClick={() => {
                download(readyExport.blob, readyExport.name);
                setReadyExport(null);
                notify("已提交文件下载");
              }}
            >
              <DownloadSimple size={18} />
              下载文件
            </button>
          </footer>
        </Dialog>
      )}
      {busy && (
        <div className="modal-backdrop processing">
          <div className="processing-card" role="status">
            <Spinner className="spin" size={36} />
            <h3>{busy.message}</h3>
            <progress max="100" value={busy.progress} />
            <p>{busy.progress}% · 正在浏览器本地处理</p>
            <button onClick={cancelJob}>取消处理</button>
          </div>
        </div>
      )}
      {!booted && (
        <div className="boot-screen">
          <Spinner className="spin" />
          正在恢复工作台…
        </div>
      )}
      {toast && (
        <div className="toast" role="alert">
          <CheckCircle size={19} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function MiniPreview({ project: p }: { project: Project }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.width = p.width;
    el.height = p.height;
    const g = el.getContext("2d")!;
    const image = g.createImageData(p.width, p.height);
    for (let i = 0; i < p.cells.length; i++) {
      const v = p.cells[i];
      if (v < 0) continue;
      const c = PALETTE[v].hex;
      image.data[i * 4] = parseInt(c.slice(1, 3), 16);
      image.data[i * 4 + 1] = parseInt(c.slice(3, 5), 16);
      image.data[i * 4 + 2] = parseInt(c.slice(5, 7), 16);
      image.data[i * 4 + 3] = 255;
    }
    g.putImageData(image, 0, 0);
  }, [p.cells, p.width, p.height]);
  return <canvas ref={ref} className="mini-canvas" aria-label="作品缩略图" />;
}

function ExportPreview({ project: p }: { project: Project }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = 240;
    canvas.height = 255;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 240, 255);
    const cell = Math.min(200 / p.width, 180 / p.height),
      left = (240 - p.width * cell) / 2;
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        const i = p.cells[y * p.width + x];
        g.fillStyle = i >= 0 ? PALETTE[i].hex : "#fff";
        g.fillRect(left + x * cell, 14 + y * cell, cell + 0.2, cell + 0.2);
      }
    usage(p.cells)
      .slice(0, 12)
      .forEach(([index], i) => {
        const x = i % 4,
          y = Math.floor(i / 4);
        g.fillStyle = PALETTE[index].hex;
        g.fillRect(18 + x * 55, 204 + y * 16, 11, 11);
        g.fillStyle = "#334155";
        g.font = "7px Inter, sans-serif";
        g.fillText(PALETTE[index].code, 32 + x * 55, 212 + y * 16);
      });
  }, [p]);
  return (
    <canvas
      ref={ref}
      className="source-export-mini"
      aria-label="导出预览：图案在上，色卡在下"
    />
  );
}
