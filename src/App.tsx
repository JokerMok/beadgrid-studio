import { backgroundImageUrl } from "./background-image";
import AdjustmentDialog from "./components/AdjustmentDialog";
import DisabledColorsDialog from "./components/DisabledColorsDialog";
import { applyColorRules } from "./color-rules";
import AccountDialog from "./components/AccountDialog";
import HandmadeDialog from "./components/HandmadeDialog";
import ImportPreview from "./components/ImportPreview";
import ImportGridControls from "./components/ImportGridControls";
import { accountLabel, type AccountUser } from "./account";
import { captureGeneration, restoreGeneration, hasManualEdits } from "./model";
import { localScope, loadLegacyDraft, listUnassigned } from "./storage";
import { gridFromLongEdge, gridFromAxis } from "./import-grid";
import { IRON_STYLES, type IronStyle } from "./ironing";
import OutlineDialog from "./components/OutlineDialog";
import ColorPickerDialog from "./components/ColorPickerDialog";
import ExportDialog from "./components/ExportDialog";
import BeadListDialog from "./components/BeadListDialog";
import MaterialSettings from "./components/MaterialSettings";
import { prepareRaster, prepareReferenceRaster } from "./prepare-image";
import { matchesConversion, type ConversionResult } from "./image-conversion";
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
  saveDraft as writeDraft,
  loadDraft as readDraft,
  saveLocal as writeLocal,
  listLocal as readLocal,
  removeLocal as deleteLocal,
  downloadProject,
  download,
  readImage,
  safeName,
} from "./storage";
import { makeDemo } from "./demo";
import { api } from "./api";
import { cloudSyncKey, validCloudSync, type CloudSync } from "./cloud-sync";
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
  | "handmade"
  | "mosaic"
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
      sessionId: string;
      source: string;
      name: string;
      initial?: Settings;
      intent: "new" | "regenerate";
      resultMode?: "mosaic";
    } | null>(null),
    [mainGridLocked, setMainGridLocked] = useState(true),
    [mainSizing, setMainSizing] = useState<"source" | "custom">("source"),
    [sourceRatio, setSourceRatio] = useState(1),
    [accountNotice, setAccountNotice] = useState(""),
    [exportStatus, setExportStatus] = useState(""),
    [blankTemplate, setBlankTemplate] = useState(false),
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
    [unassignedWorks, setUnassignedWorks] = useState<Project[]>([]),
    [cloudWorks, setCloudWorks] = useState<
      { id: string; title: string; updated: number }[]
    >([]),
    [user, setUser] = useState<AccountUser | null>(null),
    [formError, setFormError] = useState(""),
    [networkBusy, setNetworkBusy] = useState(false),
    [replaceFrom, setReplaceFrom] = useState(0),
    [replaceTo, setReplaceTo] = useState(1),
    [exportOptions, setExportOptions] = useState<ExportOptions>({
      kind: "chart",
      cell: 0,
      mirror: false,
      board: 52,
    }),
    [cropActive, setCropActive] = useState(false),
    [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 52, h: 52 }),
    [panelTab, setPanelTab] = useState<"properties" | "palette">("properties"),
    [historyTick, setHistoryTick] = useState(0),
    [similarThreshold, setSimilarThreshold] = useState(90),
    [readyExport, setReadyExport] = useState<{
      blob: Blob;
      name: string;
      job?: string;
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
    cloudVersions = useRef(new Map<string, CloudSync>());
  const serviceSource = window.location.origin + "/api";
  const activeUser = useRef(user);
  const scopeRef = useRef(localScope()),
    switchRevision = useRef(0),
    exportJob = useRef<{ id: string; userId: number } | null>(null),
    exportCancelled = useRef(false),
    processingAbort = useRef<AbortController | null>(null),
    identityQueue = useRef<Promise<void>>(Promise.resolve());
  const saveDraft = (p: Project) => writeDraft(p, scopeRef.current),
    saveLocal = (p: Project) => writeLocal(p, scopeRef.current),
    listLocal = () => readLocal(scopeRef.current),
    removeLocal = (id: string) => deleteLocal(id, scopeRef.current);
  function switchAccount(
    next: AccountUser | null,
    broadcast = true,
  ): Promise<void> {
    const job = identityQueue.current
      .catch(() => {})
      .then(() => switchAccountNow(next, broadcast));
    identityQueue.current = job;
    return job;
  }
  async function switchAccountNow(next: AccountUser | null, broadcast = true) {
    if (next?.id !== activeUser.current?.id) next = (await api("/me")).user;

    if (
      scopeRef.current === localScope(next?.id) &&
      activeUser.current?.id === next?.id
    ) {
      activeUser.current = next;
      setUser(next);
      return;
    }
    const revision = ++switchRevision.current;
    setBooted(false);
    try {
      await writeDraft(withSync(current.current), scopeRef.current);
    } catch (e) {
      setBooted(true);
      throw Error("原账号草稿备份失败，未切换编辑区：" + errText(e));
    }
    processingAbort.current?.abort();
    processingAbort.current = null;
    const pendingExport = !!exportJob.current;
    exportJob.current = null;
    exportCancelled.current = true;
    scopeRef.current = localScope(next?.id);
    activeUser.current = next;
    setUser(next);
    cloudVersions.current.clear();
    undo.current = [];
    redo.current = [];
    setSelection(new Set());
    setIncoming(null);
    setReadyExport(null);
    setCloudWorks([]);
    worker.current?.terminate();
    jobId.current++;
    setBusy(null);
    let restored: Project | null = null;
    try {
      restored = await readDraft(scopeRef.current);
    } catch (e) {
      notify("当前身份草稿读取失败，未加载其他身份内容：" + errText(e));
    }
    if (revision !== switchRevision.current) return;
    const p = restored || makeDemo();
    rememberSync(p);
    current.current = p;
    setProject(p);
    setUser(next);
    setBooted(true);
    setAccountNotice(
      next
        ? `当前本地草稿归属：${next.username}。游客及其他账号的草稿单独保留；不会自动上传。`
        : "当前为游客草稿。已退出账号的草稿和账号作品不会在此显示。",
    );
    if (pendingExport)
      notify(
        "前个账号的未完成导出可回账号中心取消；未完成预占5分钟到期释放；已提交的任务由后台核实恢复",
      );
    if (broadcast)
      localStorage.setItem("beadgrid-auth-change", crypto.randomUUID());
  }
  function rememberSync(p: Project) {
    const sync = validCloudSync(p.cloudSync, p.id);
    if (sync && sync.source === serviceSource) {
      const key = cloudSyncKey(sync.source, sync.userId, p.id);
      if (!cloudVersions.current.has(key)) cloudVersions.current.set(key, sync);
    }
  }
  function withSync(p: Project): Project {
    const account = activeUser.current;
    return {
      ...p,
      cloudSync: account
        ? cloudVersions.current.get(
            cloudSyncKey(serviceSource, account.id, p.id),
          )
        : p.cloudSync,
    };
  }
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
    const next = {
      ...p,
      variants: p.variants
        ? { ...p.variants, [p.variants.active]: p.cells.slice() }
        : undefined,
      updatedAt: Date.now(),
    };
    setProject(withSync(next));
  }
  function commit(p: Project, keepSelection = false) {
    if (p.settings.disabled.length || p.settings.allowed.length)
      p = remapDisabled(p);
    p = applyColorRules(p);
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
    let alive = true;
    (async () => {
      try {
        let account: AccountUser | null = null;
        try {
          account = (await api("/me")).user;
        } catch (e) {
          notify(
            "公共账号暂不可用，本地编辑仍可使用；账号草稿保留且未加载：" +
              errText(e),
          );
        }
        if (!alive) return;
        activeUser.current = account;
        scopeRef.current = localScope(account?.id);
        setUser(account);
        try {
          const p = await readDraft(scopeRef.current);
          if (alive && p) {
            rememberSync(p);
            setProject(p);
            notify("已恢复当前身份的本地草稿");
          }
        } catch (e) {
          notify("当前身份草稿读取失败，未加载其他身份内容：" + errText(e));
        }
      } finally {
        if (alive) {
          setBooted(true);
          const params = new URLSearchParams(location.search);
          if (params.has("authError") || location.pathname === "/admin")
            setModal("auth");
        }
      }
    })();
    return () => {
      alive = false;
      worker.current?.terminate();
      processingAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!booted) return;
    let active = true;
    const check = async () => {
      try {
        const r = await api("/me");
        if (!active) return;
        if (r.user?.id !== activeUser.current?.id) {
          await switchAccount(r.user, false);
          setModal(null);
          notify("登录身份已在其他窗口改变，已切换至独立草稿");
        } else {
          activeUser.current = r.user;
          setUser(r.user);
        }
      } catch {}
    };
    const storage = (e: StorageEvent) => {
      if (e.key === "beadgrid-auth-change") check();
    };
    window.addEventListener("focus", check);
    window.addEventListener("beadgrid-session-invalid", check);
    window.addEventListener("storage", storage);
    const timer = setInterval(check, 60000);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
      window.removeEventListener("beadgrid-session-invalid", check);
      window.removeEventListener("storage", storage);
      clearInterval(timer);
    };
  }, [booted]);
  useEffect(() => {
    if (!booted) return;
    const revision = ++draftRevision.current;
    const identity = scopeRef.current,
      snapshot = withSync(project);
    setSaved("正在保存");
    const timer = setTimeout(() => {
      writeDraft(snapshot, identity)
        .then(() => {
          if (revision === draftRevision.current) setSaved("已自动保存");
        })
        .catch((e) => {
          setSaved("保存失败");
          notify("本地存储失败，请立即导出项目文件：" + errText(e));
        });
    }, 650);
    return () => clearTimeout(timer);
  }, [project, booted, user]);
  useEffect(() => {
    let alive = true;
    if (project.source) {
      const im = new Image();
      im.onload = () => {
        if (alive) {
          const c =
            project.settings.fit === "crop"
              ? project.settings.crop
              : { w: 1, h: 1 };
          setSourceRatio((im.naturalWidth * c.w) / (im.naturalHeight * c.h));
        }
      };
      im.src = project.source;
    } else setSourceRatio(project.width / project.height);
    return () => {
      alive = false;
    };
  }, [
    project.source,
    project.width,
    project.height,
    project.settings.fit,
    project.settings.crop,
  ]);
  useEffect(() => {
    setBoardW(project.width);
    setBoardH(project.height);
    setMainSizing(project.settings.gridSizing || "custom");
    setMainGridLocked(project.settings.gridSizing === "source");
  }, [project.id, project.width, project.height, project.settings.gridSizing]);
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
        setMobileSide(false);
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
    const replace = (e: Event) =>
      setIncoming({
        ...(e as CustomEvent).detail,
        sessionId: crypto.randomUUID(),
        initial: {
          ...defaults(200, 200),
          gridSizing: "source",
          placement: "contain",
          padding: "empty",
          limit: 64,
          removeLight: false,
        },
        intent: "new",
      });
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
      const identity = scopeRef.current,
        p = withSync({ ...current.current, updatedAt: Date.now() });
      await writeLocal(p, identity);
      if (scopeRef.current !== identity) return;
      setProject(p);
      notify("已保存到本地作品");
    } catch (e) {
      notify("保存失败：" + errText(e));
    }
  }
  async function receiveFile(file?: File) {
    if (!file) return;
    const identity = scopeRef.current;
    try {
      const source = await readImage(file);
      if (identity !== scopeRef.current) {
        notify("身份已变化，已取消上传临时素材");
        return;
      }
      setIncoming({
        sessionId: crypto.randomUUID(),
        source,
        name: file.name,
        initial: {
          ...defaults(200, 200),
          gridSizing: "source",
          placement: "contain",
          padding: "empty",
          limit: 64,
          removeLight: false,
        },
        intent: "new",
      });
      setMobileSide(false);
    } catch (e) {
      notify(errText(e));
    }
  }
  async function generate(
    source: string,
    name: string,
    s: Settings,
    intent: "new" | "regenerate",
    preview?: ConversionResult,
    signal?: AbortSignal,
  ) {
    if (preview && !matchesConversion(preview, source, s))
      throw Error("预览与当前参数不一致，请等待最新预览");
    signal?.throwIfAborted();
    const base = current.current,
      identity = scopeRef.current;
    if (
      intent === "regenerate" &&
      hasManualEdits(base) &&
      !window.confirm(
        "重新生成将覆盖手工编辑。旧作品会先保存备份，也可撤销；确认生成后将建立新的恢复基准。继续吗？",
      )
    ) {
      if (preview) throw new DOMException("已取消重新生成", "AbortError");
      return;
    }
    try {
      await saveLocal(withSync(base));
      if (intent === "regenerate" && hasManualEdits(base))
        await saveLocal({
          ...base,
          id: crypto.randomUUID(),
          name: (base.name + " · 重生成前备份").slice(0, 120),
          cloudSync: undefined,
          updatedAt: Date.now(),
        });
    } catch (e) {
      if (preview) throw Error("无法备份当前作品：" + errText(e));
      notify("无法备份当前作品：" + errText(e));
      return;
    }
    signal?.throwIfAborted();
    if (scopeRef.current !== identity) {
      if (preview)
        throw new DOMException("身份已变化，已取消生成", "AbortError");
      return;
    }
    if (preview) {
      commit({
        ...base,
        id: intent === "new" ? crypto.randomUUID() : base.id,
        cloudSync: intent === "new" ? undefined : base.cloudSync,
        source,
        sourceName: name,
        width: s.width,
        height: s.height,
        cells: preview.cells,
        generationBase: {
          width: s.width,
          height: s.height,
          cells: preview.cells.slice(),
          settings: structuredClone(s),
          createdAt: Date.now(),
        },
        variants: undefined,
        colorRules: undefined,
        assemblyProgress: [],
        settings: structuredClone(s),
        name:
          intent === "regenerate"
            ? base.name
            : name.replace(/\.[^.]+$/, "") || base.name,
        view: "beads",
      });
      setIncoming(null);
      setZoom(1);
      notify("图纸已生成，开始创作吧");
      return;
    }
    setIncoming(null);
    setModal(null);
    const revision = jobId.current;
    setBusy({ progress: 0, message: "正在解码与构图…" });
    let raster;
    try {
      const controller = new AbortController();
      processingAbort.current = controller;
      try {
        raster = await prepareRaster(source, s, controller.signal);
      } finally {
        if (processingAbort.current === controller)
          processingAbort.current = null;
      }
    } catch (e) {
      if (jobId.current === revision) {
        setBusy(null);
        notify(errText(e));
      }
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
        const p = base;
        commit({
          ...p,
          id: intent === "new" ? crypto.randomUUID() : p.id,
          cloudSync: intent === "new" ? undefined : p.cloudSync,
          source,
          sourceName: name,
          width: s.width,
          height: s.height,
          cells: data.cells,
          generationBase: {
            width: s.width,
            height: s.height,
            cells: data.cells.slice(),
            settings: structuredClone(s),
            createdAt: Date.now(),
          },
          variants: undefined,
          colorRules: undefined,
          assemblyProgress: [],
          settings: s,
          name:
            intent === "regenerate"
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
        refundExport();
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
      refundExport();
      notify("处理失败：" + e.message);
      w.terminate();
      worker.current = null;
    };
    w.postMessage(payload);
  }
  function cancelJob() {
    processingAbort.current?.abort();
    processingAbort.current = null;
    exportCancelled.current = true;
    refundExport();
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
  async function accountWorks() {
    const account = activeUser.current;
    if (!account) return [];
    const r = await api("/works");
    if (account.id !== activeUser.current?.id || r.userId !== account.id) {
      window.dispatchEvent(new Event("beadgrid-session-invalid"));
      throw Error("登录身份已变化，已取消读取旧身份作品列表");
    }
    return r.works;
  }
  async function openWorks() {
    const identity = scopeRef.current;
    setModal("works");
    setFormError("");
    try {
      const local = await listLocal(),
        unassigned = await listUnassigned();
      if (identity !== scopeRef.current) return;
      setLocalWorks(local);
      setUnassignedWorks(unassigned);
      if (activeUser.current) setCloudWorks(await accountWorks());
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
      const account = user;
      const key = cloudSyncKey(serviceSource, account.id, p.id);
      const result = await api("/works/" + p.id, {
        method: "PUT",
        body: JSON.stringify({
          project: serialize(p),
          expectedUserId: account.id,
          expectedUpdated: cloudVersions.current.get(key)?.updated,
        }),
      });
      if (activeUser.current?.id === account.id) {
        cloudVersions.current.set(key, {
          source: serviceSource,
          userId: account.id,
          projectId: p.id,
          updated: result.updated,
        });
        const next = withSync(current.current);
        setProject(next);
        try {
          await saveDraft(next);
        } catch {
          notify(
            "账号保存成功，但本机同步信息保存失败；下次请重新打开账号作品后再保存",
          );
          return;
        }
      }
      notify("作品已保存到独立服务");
    } catch (e) {
      notify(errText(e));
    } finally {
      setNetworkBusy(false);
    }
  }
  async function openProject(p: Project, imported = false) {
    try {
      const identity = scopeRef.current;
      await writeLocal(withSync(current.current), identity);
      if (scopeRef.current !== identity) {
        notify("身份已变化，已取消打开旧身份作品");
        return;
      }
      // Opening a snapshot adopts its own base version, never a newer stamp
      // remembered while editing another snapshot with the same project ID.
      for (const [key, sync] of cloudVersions.current)
        if (sync.projectId === p.id) cloudVersions.current.delete(key);
      if (imported) p = { ...p, cloudSync: undefined };
      else rememberSync(p);
      checkpoint();
      setProject(withSync(p));
      setSelection(new Set());
      setCropActive(false);
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
      generate(
        project.source,
        project.sourceName || project.name,
        {
          ...project.settings,
          width: boardW,
          height: boardH,
          gridSizing: mainSizing,
        },
        "regenerate",
      );
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
    if (kind === "adjust") {
      setModal("adjust");
      return;
    }
    if (project.reference) {
      setModal("reference");
      return;
    }
    if (!project.source) {
      notify("请先添加图纸底图，再对齐识别");
      referenceInput.current?.click();
      return;
    }
    setIncoming({
      sessionId: crypto.randomUUID(),
      source: project.source,
      name: project.sourceName || project.name,
      intent: "regenerate",
      initial: {
        ...project.settings,
        width: project.width,
        height: project.height,
        mode: "recognize",
      },
    });
  }
  async function refundExport() {
    const j = exportJob.current;
    if (!j) return;
    exportJob.current = null;
    try {
      const result = await api("/exports/" + j.id + "/cancel", {
        method: "POST",
        body: JSON.stringify({ expectedUserId: j.userId }),
      });
      notify(
        result.status === "ready"
          ? "此任务文件已完成并结算，可在账号中心再次下载"
          : `原任务状态：${result.status}（结果未知时请稍后查询）`,
      );
    } catch {
      notify(
        "暂时无法确认结果，后台将按原业务号恢复；请在账号模块查询，不会把超时当作确定失败",
      );
    }
  }
  async function doExport() {
    const identity = scopeRef.current,
      owner = activeUser.current?.id;
    const snapshot = { ...project, cells: project.cells.slice() };
    if (!usage(snapshot.cells).length && !blankTemplate) {
      notify("图纸为空；需要空白图纸时请选择“导出空白模板”");
      return;
    }
    if (!user) {
      setModal("auth");
      notify("请登录后确认导出；本地编辑和项目备份仍可使用");
      return;
    }
    exportCancelled.current = false;
    setModal(null);
    setBusy({ progress: 0, message: "正在核对服务端权益…" });
    try {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          project: serialize(snapshot),
          options: exportOptions,
        }),
      );
      const hash = await crypto.subtle.digest("SHA-256", bytes),
        fingerprint = Array.from(new Uint8Array(hash), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      const requestKey = crypto.randomUUID();
      const reserve = () =>
        api("/exports/reserve", {
          method: "POST",
          body: JSON.stringify({
            expectedUserId: user.id,
            requestKey,
            kind: blankTemplate ? "blank" : exportOptions.kind,
            fingerprint,
          }),
        });
      let j;
      try {
        j = await reserve();
      } catch (error) {
        if (error instanceof TypeError) j = await reserve();
        else throw error;
      }
      if (identity !== scopeRef.current || owner !== activeUser.current?.id) {
        notify(
          "身份已变化，原导出未提交下载；未完成预留到期释放，已提交任务继续核实恢复",
        );
        return;
      }
      if (j.status === "pending_recovery") {
        setBusy(null);
        notify(
          "权益响应未知，已保存原任务；请在账号模块查询恢复结果，不要重复新建任务",
        );
        setModal("auth");
        return;
      }
      exportJob.current = { id: j.id, userId: user.id };
      if (exportCancelled.current) {
        await refundExport();
        return;
      }
      startJob(
        new Worker(new URL("./export.worker.ts", import.meta.url), {
          type: "module",
        }),
        "正在生成图纸…",
        { project: snapshot, options: exportOptions },
        (data) => {
          const blob = new Blob([data.bytes], {
              type: data.extension === "png" ? "image/png" : "application/zip",
            }),
            name = `${safeName(snapshot.name)}_${blankTemplate ? "空白模板" : exportOptions.kind}${exportOptions.mirror ? "_镜像" : ""}.${data.extension}`;
          setReadyExport({ blob, name, job: j.id });
          setBlankTemplate(false);
          setExportStatus(
            "文件已生成，尚未结算；请提交至受控下载。失败可重试，取消会返还预留次数。",
          );
        },
      );
    } catch (e) {
      setBusy(null);
      await refundExport();
      notify(errText(e));
      if (errText(e).includes("次数")) setModal("auth");
    }
  }
  async function submitExport() {
    if (!readyExport) return;
    const identity = scopeRef.current,
      owner = activeUser.current?.id,
      outgoing = readyExport;
    setNetworkBusy(true);
    setExportStatus("正在保存文件并结算…");
    try {
      const response = await fetch(
        "/api/exports/" + readyExport.job + "/file",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Studio-User": String(user?.id),
            "X-Filename": encodeURIComponent(readyExport.name),
          },
          body: readyExport.blob,
        },
      );
      const body = await response.json();
      if (!response.ok || body.status !== "ready")
        throw Error(body.error || "原任务结果待恢复，请稍后查询或重试同一任务");
      if (identity !== scopeRef.current || owner !== activeUser.current?.id)
        return;
      if (exportJob.current?.id === outgoing.job) exportJob.current = null;
      const a = document.createElement("a");
      a.href = "/api/exports/" + readyExport.job + "/download";
      a.download = readyExport.name;
      a.click();
      setExportStatus(
        "文件已完成并提交下载；请检查浏览器下载列表。若未收到，可重试下载或打开备用文件。",
      );
    } catch (e) {
      setExportStatus(
        "未确认结算成功：" +
          errText(e) +
          "。可重试提交，同一任务不会重复扣次；或取消未完成任务。",
      );
    } finally {
      setNetworkBusy(false);
    }
  }
  async function removeReferenceBackground(enabled: boolean) {
    const base = current.current,
      r = base.reference;
    if (!r) return;
    const controller = new AbortController(),
      identity = scopeRef.current;
    processingAbort.current = controller;
    setModal(null);
    setBusy({
      progress: 0,
      message: enabled ? "正在清除底图边缘背景…" : "正在恢复底图原始背景…",
    });
    try {
      const rawUrl = r.rawUrl || r.url,
        url = enabled
          ? await backgroundImageUrl(rawUrl, controller.signal)
          : rawUrl;
      controller.signal.throwIfAborted();
      if (identity !== scopeRef.current)
        throw new DOMException("身份已变化", "AbortError");
      commit({
        ...base,
        reference: { ...r, rawUrl, url, backgroundRemoved: enabled },
      });
      setModal("reference");
    } catch (e) {
      if (!controller.signal.aborted) notify(errText(e));
    } finally {
      if (processingAbort.current === controller) {
        processingAbort.current = null;
        setBusy(null);
      }
    }
  }
  async function recognizeReference() {
    const base = current.current;
    if (!base.reference) return;
    if (
      !window.confirm(
        "按已对齐底图识别色块并替换当前图纸？将保留原图与旧生成基准，可撤销恢复。",
      )
    )
      return;
    setModal(null);
    const revision = jobId.current;
    setBusy({ progress: 0, message: "正在读取已对齐底图…" });
    try {
      const raster = await prepareReferenceRaster(base);
      if (revision !== jobId.current) return;
      startJob(
        new Worker(new URL("./convert.worker.ts", import.meta.url), {
          type: "module",
        }),
        "正在识别底图色号…",
        { raster, settings: { ...base.settings, mode: "recognize" } },
        (data) => {
          commit({
            ...base,
            cells: data.cells,
            variants: undefined,
            view: "beads",
          });
          notify("底图识别已应用，透明区域保持空格；可撤销或恢复生成基准");
        },
      );
    } catch (e) {
      setBusy(null);
      notify(errText(e));
    }
  }
  function restoreBaseline() {
    try {
      commit(restoreGeneration(project));
      notify("已恢复本次确认生成的图纸，可撤销");
    } catch (e) {
      notify(errText(e));
      if (
        window.confirm(
          "此旧作品没有生成基准。是否把当前图纸明确设为新的恢复基准？这不会补造历史。",
        )
      )
        commit({ ...project, generationBase: captureGeneration(project) });
    }
  }
  function openRegenerate() {
    if (!project.source) {
      notify("此作品没有原图，请上传原图后生成");
      return;
    }
    setIncoming({
      sessionId: crypto.randomUUID(),
      source: project.source,
      name: project.sourceName || project.name,
      intent: "regenerate",
      initial: {
        ...project.settings,
        width: boardW,
        height: boardH,
        gridSizing: mainSizing,
      },
    });
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
    <button
      className={extra}
      title={label}
      onClick={(e) => {
        e.currentTarget.closest("details")?.removeAttribute("open");
        onClick();
      }}
    >
      <Icon size={17} />
      <span>{label}</span>
    </button>
  );
  return (
    <div
      onPointerDownCapture={(e) => {
        document
          .querySelectorAll<HTMLDetailsElement>("details.menu[open]")
          .forEach((menu) => {
            if (!menu.contains(e.target as Node)) menu.open = false;
          });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape")
          document
            .querySelectorAll<HTMLDetailsElement>("details.menu[open]")
            .forEach((menu) => (menu.open = false));
      }}
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
          const identity = scopeRef.current;
          try {
            if (file.size > 64e6) throw Error("项目文件超过64MB");
            const raw = JSON.parse(await file.text());
            if (identity !== scopeRef.current) {
              notify("身份已变化，已取消项目文件导入");
              return;
            }
            await openProject(deserialize(raw), true);
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
          const identity = scopeRef.current,
            projectId = current.current.id;
          if (f)
            try {
              const url = await readImage(f);
              const image = new Image();
              image.src = url;
              await image.decode();
              if (
                identity !== scopeRef.current ||
                projectId !== current.current.id
              ) {
                notify("作品或身份已变化，已取消添加旧底图");
                return;
              }
              const base = current.current;
              const scale = Math.min(
                project.width / image.naturalWidth,
                project.height / image.naturalHeight,
              );
              const refW = image.naturalWidth * scale,
                refH = image.naturalHeight * scale;
              commit({
                ...base,
                reference: {
                  url,
                  opacity: 0.35,
                  x: (base.width - refW) / 2,
                  y: (base.height - refH) / 2,
                  width: refW,
                  height: refH,
                },
              });
              setModal("reference");
            } catch (e) {
              notify(errText(e));
            }
        }}
      />
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="豆格工坊首页"
        >
          <span className="brand-mark">
            <GridFour size={24} weight="fill" />
          </span>
          <span>
            <strong>{BRAND.name}</strong>
            <small>BEADGRID STUDIO</small>
          </span>
        </a>
        <div className="project-identity">
          <div className="project-title">
            <input
              aria-label="作品名称"
              value={project.name}
              maxLength={120}
              onChange={(e) => change({ ...project, name: e.target.value })}
            />
            <details className="project-menu menu">
              <summary aria-label="作品菜单" title="作品菜单">
                <CaretDown size={17} />
              </summary>
              <div className="menu-content">
                <span className="menu-label">作品</span>
                {action("保存", FloppyDisk, saveNamed)}
                {action("我的作品", FolderOpen, openWorks)}
                {action("账号中心", UserCircle, () => setModal("auth"))}
                {action(
                  "恢复本次生成图纸",
                  ArrowCounterClockwise,
                  restoreBaseline,
                )}
                {action("按当前参数重新生成", ArrowsClockwise, openRegenerate)}
                {action("进入拼豆模式", GridFour, () => {
                  change({ ...project, view: "beads" });
                  setTool("hand");
                  setFocus(true);
                  notify("已进入拼豆模式，可直接编辑格子；再次点专注可退出");
                })}
                {action("导出空白模板", FileArrowDown, () => {
                  setBlankTemplate(true);
                  setExportOptions({ ...exportOptions, kind: "chart" });
                  setModal("export");
                })}
                {action("自定义创作", Plus, () => setModal("new"))}
                {action("导入项目文件", FolderOpen, () =>
                  projectInput.current?.click(),
                )}
                {action("导出项目", FileArrowDown, () =>
                  downloadProject(project),
                )}
                <hr />
                {action("图片转马赛克", GridFour, () => {
                  if (project.source)
                    setIncoming({
                      sessionId: crypto.randomUUID(),
                      source: project.source,
                      name: project.sourceName || project.name,
                      initial: project.settings,
                      intent: "regenerate",
                      resultMode: "mosaic",
                    });
                  else setModal("mosaic");
                })}
                <button disabled title="暂未接入AI服务">
                  <MagicWand size={18} />
                  AI 生图<span className="menu-note">暂未开放</span>
                </button>
                {action("查看引导", Question, () => setModal("help"))}
              </div>
            </details>
          </div>
          <span
            className={"save-state " + (saved === "保存失败" ? "failed" : "")}
            role="status"
          >
            <i />
            <span>{saved}</span>
            <small>
              {" "}
              · {user ? user.username + " · " + accountLabel(user) : "游客"}
            </small>
          </span>
        </div>
        <nav className="top-toolbar" aria-label="工作台操作">
          {action("上传图片", UploadSimple, () => fileInput.current?.click())}
          {action(
            "用豆清单",
            FileArrowDown,
            () => setModal(user ? "bead-list" : "auth"),
            "bead-list-entry",
          )}
          <button
            className="primary export-entry"
            aria-label="下载图纸"
            title="导出图纸"
            onClick={() => {
              setBlankTemplate(false);
              setModal("export");
            }}
          >
            <DownloadSimple size={18} />
            <span>导出图纸</span>
          </button>
          <button
            className="account-button icon-button"
            aria-label={user ? "账号：" + user.username : "登录 / 注册"}
            title={
              user
                ? user.username + " · 账号中心 · " + accountLabel(user)
                : "登录 / 注册"
            }
            onClick={() => setModal("auth")}
          >
            <UserCircle size={25} />
          </button>
        </nav>
      </header>
      {accountNotice && (
        <div className="identity-notice" role="status">
          {accountNotice}
          <button
            aria-label="关闭身份提示"
            onClick={() => setAccountNotice("")}
          >
            ×
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
          <div className="rail-divider" />
          <details className="tool-extensions menu">
            <summary aria-label="工具扩展" title="工具扩展">
              <DotsThree size={23} />
              <span>扩展</span>
            </summary>
            <div className="menu-content">
              <span className="menu-label">处理与辅助工具</span>
              {[
                {
                  name: "自选颜色",
                  icon: GridFour,
                  run: () => setModal(user ? "palette" : "auth"),
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
                    if (project.reference) setModal("reference");
                    else {
                      notify("请先添加底图并对齐网格，再识别色号");
                      referenceInput.current?.click();
                    }
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
                  run: () => setModal(user ? "handmade" : "auth"),
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
                  run: () =>
                    project.reference
                      ? setModal("reference")
                      : openAdjust("align"),
                },
                { name: "更多", icon: DotsThree, run: () => setModal("more") },
              ].map(({ name, icon: Icon, run }) => (
                <button
                  key={name}
                  aria-label={name}
                  title={name}
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    run();
                  }}
                >
                  <Icon size={21} weight="bold" />
                  <span>{name}</span>
                </button>
              ))}
            </div>
          </details>
          <div className="rail-spacer" />
          <button
            aria-label="专注模式"
            title="专注模式"
            className={focus ? "active" : ""}
            onClick={() => setFocus(!focus)}
          >
            <ArrowsOut size={22} />
            <span>{focus ? "退出专注" : "专注"}</span>
          </button>
          <button
            aria-label="查看引导"
            title="使用帮助"
            onClick={() => setModal("help")}
          >
            <Question size={22} />
            <span>帮助</span>
          </button>
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
            <div className="view-tabs" role="tablist" aria-label="画布视图">
              <button
                role="tab"
                aria-selected={project.view === "original"}
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
                role="tab"
                aria-selected={project.view === "beads"}
                className={project.view === "beads" ? "active" : ""}
                onClick={() => change({ ...project, view: "beads" })}
              >
                拼豆图
              </button>
              <button
                role="tab"
                aria-selected={project.view === "iron"}
                className={project.view === "iron" ? "active" : ""}
                onClick={() => change({ ...project, view: "iron" })}
              >
                熨烫
              </button>
            </div>
            <span className="canvas-heading-note">
              {project.source ? project.sourceName : "本地创作工作台"}
            </span>
            <button
              className="mobile-settings icon-button"
              aria-label="设置与用量"
              title="设置与用量"
              aria-expanded={mobileSide}
              onClick={() => setMobileSide(!mobileSide)}
            >
              <SlidersHorizontal size={20} />
              <span>属性</span>
            </button>
          </div>
          <div className="canvas-shell">
            {project.view === "iron" && (
              <div
                className="iron-picker"
                role="radiogroup"
                aria-label="熨烫类型"
              >
                {IRON_STYLES.map(([id, label, note]) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={
                      (project.settings.ironStyle || "regular") === id
                    }
                    title={note}
                    className={
                      (project.settings.ironStyle || "regular") === id
                        ? "active"
                        : ""
                    }
                    onClick={() =>
                      updateSettings({ ironStyle: id as IronStyle })
                    }
                  >
                    {label}
                  </button>
                ))}
                <small>
                  仅作成品效果参考；离开后恢复网格与坐标，不改变色卡及导出颜色。
                </small>
              </div>
            )}
            <CanvasEditor
              project={project}
              guest={!user}
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
            {!user && (
              <div className="guest-preview-notice">
                游客试用 · 登录后查看完整色号与高清导出
              </div>
            )}
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
          <footer className="editor-statusbar">
            <div className="project-metrics">
              <span>
                {project.width} × {project.height} <small>格</small>
              </span>
              <span>
                {counts.length} <small>色</small>
              </span>
              <span data-testid="bead-total">
                {total.toLocaleString()} <small>颗</small>
              </span>
            </div>
            <div className="history-controls">
              {" "}
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
            </div>
            <span className="cursor-status">{cursor}</span>
            <div className="zoom-controls">
              {" "}
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
            <details className="canvas-menu menu">
              <summary aria-label="画布操作" title="变换与显示设置">
                <SlidersHorizontal size={19} />
              </summary>
              <div className="menu-content">
                {" "}
                <button
                  className="danger-quiet"
                  onClick={() => {
                    commit({
                      ...project,
                      cells: new Int16Array(project.cells.length).fill(-1),
                      view: "beads",
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
                  setCropRect({
                    x: 0,
                    y: 0,
                    w: project.width,
                    h: project.height,
                  });
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
                    user
                      ? change({
                          ...project,
                          grid: { ...project.grid, codes: !project.grid.codes },
                        })
                      : setModal("auth")
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
            </details>
          </footer>
        </section>
        {mobileSide && (
          <button
            className="drawer-backdrop"
            aria-label="关闭属性面板"
            onClick={() => setMobileSide(false)}
          />
        )}
        <aside className="settings-panel" aria-label="属性与色卡">
          <div className="panel-tabs" role="tablist" aria-label="面板视图">
            <button
              role="tab"
              aria-selected={panelTab === "properties"}
              className={panelTab === "properties" ? "active" : ""}
              onClick={() => setPanelTab("properties")}
            >
              属性
            </button>
            <button
              role="tab"
              aria-selected={panelTab === "palette"}
              className={panelTab === "palette" ? "active" : ""}
              onClick={() => setPanelTab("palette")}
            >
              色卡 <small>{counts.length}</small>
            </button>
            <button
              className="mobile-panel-close icon-button"
              aria-label="关闭设置"
              onClick={() => setMobileSide(false)}
            >
              <X size={20} />
            </button>
          </div>
          <div className="panel-body" hidden={panelTab !== "properties"}>
            <section className="source-preview panel-section">
              <h3>{project.source ? "原图预览" : "图案预览"}</h3>
              <div className="source-thumbnail">
                {project.source ? (
                  <img
                    src={project.source}
                    alt={project.sourceName || "当前作品原图"}
                  />
                ) : (
                  <MiniPreview project={project} />
                )}
              </div>
              <div className="source-caption">
                <span>{project.sourceName || project.name}</span>
                <button
                  className="icon-button"
                  aria-label="更换原图"
                  title="上传新素材"
                  onClick={() => fileInput.current?.click()}
                >
                  <UploadSimple size={17} />
                </button>
              </div>
            </section>
            <section className="panel-section">
              <h3>输出网格 · 决定细节</h3>
              <ImportGridControls
                settings={{
                  ...project.settings,
                  width: boardW,
                  height: boardH,
                  gridSizing: mainSizing,
                }}
                locked={mainGridLocked}
                onLock={() => setMainGridLocked((v) => !v)}
                disabled={!!busy}
                counts={
                  boardW === project.width && boardH === project.height
                    ? counts
                    : null
                }
                total={total}
                material={project.settings.materialSpec}
                mismatch={false}
                sourceRatio={sourceRatio}
                onSizing={(choice) => {
                  if (choice === "custom") {
                    setMainSizing("custom");
                    setMainGridLocked(false);
                    return;
                  }
                  const ratio =
                    choice === "source"
                      ? sourceRatio
                      : choice
                          .split(":")
                          .map(Number)
                          .reduce((a, b) => a / b);
                  const n = gridFromLongEdge(Math.max(boardW, boardH), ratio);
                  setBoardW(n.width);
                  setBoardH(n.height);
                  setMainSizing(choice === "source" ? "source" : "custom");
                  setMainGridLocked(true);
                }}
                onDimension={(axis, value) => {
                  const n = mainGridLocked
                    ? gridFromAxis(
                        axis,
                        value,
                        mainSizing === "source" ? sourceRatio : boardW / boardH,
                      )
                    : { [axis]: value };
                  if (n.width !== undefined) setBoardW(n.width);
                  if (n.height !== undefined) setBoardH(n.height);
                }}
                onDensity={(edge) => {
                  const n = gridFromLongEdge(
                    edge,
                    mainSizing === "source" ? sourceRatio : boardW / boardH,
                  );
                  setBoardW(n.width);
                  setBoardH(n.height);
                }}
                update={updateSettings}
              />
              <p className="micro">
                这里修改的是下一次重新生成的参数；当前图纸仍为 {project.width}×
                {project.height} 格、{counts.length}色、{total.toLocaleString()}
                颗。主体太小、格数不足、复杂背景或限色会丢细节；可增加格数或裁剪放大主体，同时留意成品尺寸和用豆量。大文件影响性能，与细节密度分开处理。
              </p>
              <div className="baseline-actions">
                <button onClick={applySettings}>应用网格并重新生成</button>
                <button onClick={restoreBaseline}>恢复生成图纸</button>
                <button onClick={openRegenerate}>原图构图与参数</button>
              </div>
              <p className="micro">
                分板规格只决定如何拼接制作，不改变格数。请在图纸导出中选择52／78／104格分板。
              </p>
              <MaterialSettings
                compact
                settings={project.settings}
                onChange={updateSettings}
                width={project.width}
                height={project.height}
              />
              <details className="panel-disclosure">
                <summary>
                  转换与边缘处理 <SlidersHorizontal size={16} />
                </summary>
                <div className="disclosure-body">
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
                            limit: Math.max(
                              3,
                              Math.min(221, +e.target.value || 3),
                            ),
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
                      onChange={(e) =>
                        updateSettings({ limit: +e.target.value })
                      }
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
                    onClick={() => setModal(user ? "similar" : "auth")}
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
                </div>
              </details>
            </section>
            <section className="panel-section compact-usage">
              <div className="section-title">
                <h3>用色统计</h3>
                <button
                  className="text-button"
                  onClick={() => setPanelTab("palette")}
                >
                  查看全部 <ArrowRight size={14} />
                </button>
              </div>
              <div className="compact-usage-summary">
                <span>
                  <b>{counts.length}</b>使用颜色
                </span>
                <span>
                  <b data-testid="usage-total">{total.toLocaleString()}</b>
                  总用豆颗数
                </span>
              </div>
              <div className="compact-color-list">
                {counts.slice(0, 2).map(([i, count]) => (
                  <button
                    key={i}
                    title={PALETTE[i].code + " · " + count + "颗"}
                    onClick={() => {
                      setColor(i);
                      setTool("brush");
                    }}
                  >
                    <i style={{ background: PALETTE[i].hex }} />
                    <b>{PALETTE[i].code}</b>
                    <span>{count.toLocaleString()} 颗</span>
                  </button>
                ))}
              </div>
              {!counts.length && (
                <p className="muted">当前图纸为空，绘制后查看用量。</p>
              )}
              <button
                className="full"
                onClick={() => setModal(user ? "bead-list" : "auth")}
              >
                <FileArrowDown size={17} />
                打开用豆清单
              </button>
            </section>
            <details className="panel-disclosure export-disclosure">
              <summary>
                导出设置 <DownloadSimple size={16} />
              </summary>{" "}
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
                <button
                  className="primary full"
                  onClick={() => {
                    setBlankTemplate(false);
                    setModal("export");
                  }}
                >
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
            </details>
          </div>
          <div
            className="panel-body palette-body"
            hidden={panelTab !== "palette"}
          >
            {" "}
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
                {(user ? filteredColors : filteredColors.slice(0, 5)).map(
                  (i) => (
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
                  ),
                )}
                {!user && filteredColors.length > 5 && (
                  <div className="guest-palette-lock">
                    <strong>
                      其余{filteredColors.length - 5}个色号登录后查看
                    </strong>
                    <p>本地编辑保留；完整色号和账号下载需要登录。</p>
                    <button onClick={() => setModal("auth")}>登录／注册</button>
                  </div>
                )}
                {!filteredColors.length && (
                  <p className="muted empty-small">
                    {search ? "没有匹配的色号" : "这里将显示画面中用到的色号"}
                  </p>
                )}
              </div>
              <div className="usage-summary">
                <span>预计用量</span>
                <strong data-testid="palette-usage-total">
                  {total.toLocaleString()} <small>颗</small>
                </strong>
              </div>
              <button
                className="full soft"
                onClick={() => setModal(user ? "bead-list" : "auth")}
              >
                用豆清单 · 复制与下载
              </button>
            </section>
          </div>
          <div className="panel-footer">
            <span>
              <i className="live-dot" />
              本地创作
            </span>
            <span>标准 221 色</span>
          </div>
        </aside>
      </main>
      {incoming && (
        <ImportDialog
          key={incoming.sessionId}
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
          onGenerate={async (s, preview, signal) => {
            await generate(
              incoming.source,
              incoming.name,
              s,
              incoming.intent,
              preview,
              signal,
            );
            if (incoming.resultMode === "mosaic") setModal("mosaic");
          }}
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
                  await saveLocal(withSync(project));
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
      {modal === "disable" && (
        <DisabledColorsDialog
          project={project}
          selection={selection}
          onClose={() => setModal(null)}
          onApply={(p) => {
            commit(p);
            setModal(null);
            notify("禁色规则已应用，可撤销恢复");
          }}
        />
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
      {modal === "adjust" && (
        <AdjustmentDialog
          project={project}
          onClose={() => setModal(null)}
          onApply={(cells) => {
            commit({ ...project, cells });
            setModal(null);
            notify("图纸调节已应用，可撤销");
          }}
        />
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
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!project.reference.backgroundRemoved}
                  onChange={(e) => removeReferenceBackground(e.target.checked)}
                />
                清除底图主要边缘背景（实验，非AI）
              </label>
              <p className="micro">
                可能误删与背景相近的主体；原始底图保留，取消勾选可还原。
              </p>
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
                <button onClick={recognizeReference}>识别已对齐底图</button>
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
          user={user}
          blankTemplate={blankTemplate}
          onChange={setExportOptions}
          onClose={() => {
            setBlankTemplate(false);
            setModal(null);
          }}
          onExport={doExport}
        />
      )}
      {modal === "works" && (
        <Dialog title="我的作品" onClose={() => setModal(null)} wide>
          <p className="hint">
            本地作品归属：{user ? user.username : "游客"}
            ；其他身份的数据独立保留。账号作品仅从服务端读取，跨设备请登录同一账号后打开。
          </p>
          <div className="works-actions">
            <button
              onClick={async () => {
                try {
                  const p = await readDraft(localScope());
                  if (!p) {
                    notify("没有游客草稿");
                    return;
                  }
                  if (
                    !window.confirm(
                      "将游客草稿复制到当前账号的本地编辑区？不会自动上传，当前作品会先备份。",
                    )
                  )
                    return;
                  await openProject(
                    {
                      ...p,
                      id: crypto.randomUUID(),
                      name: p.name + " · 导入游客副本",
                      cloudSync: undefined,
                    },
                    true,
                  );
                } catch (e) {
                  setFormError(errText(e));
                }
              }}
            >
              从游客草稿导入副本
            </button>
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
          <details className="legacy-adoption">
            <summary>旧版草稿与未归属作品恢复（需明确导入）</summary>
            <p className="micro">
              旧版无归属数据不会静默绑定新账号。原记录保留，导入创建当前身份的独立副本；不会自动上传。
            </p>
            <button
              onClick={async () => {
                try {
                  const p = await loadLegacyDraft();
                  if (!p) {
                    notify("没有旧版草稿");
                    return;
                  }
                  if (
                    !window.confirm(
                      "旧版草稿可能属于此前使用此浏览器的账号。确认将其复制到当前身份？",
                    )
                  )
                    return;
                  await openProject(
                    {
                      ...p,
                      id: crypto.randomUUID(),
                      name: (p.name + " · 旧版恢复").slice(0, 120),
                      cloudSync: undefined,
                    },
                    true,
                  );
                } catch (e) {
                  setFormError(errText(e));
                }
              }}
            >
              查看并导入旧版草稿
            </button>
            {unassignedWorks.map((p) => (
              <div key={p.id}>
                <span>{p.name}</span>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "确认将此旧版作品复制到当前身份？原记录保留，不会上传。",
                      )
                    )
                      openProject(
                        {
                          ...p,
                          id: crypto.randomUUID(),
                          cloudSync: undefined,
                          name: (p.name + " · 旧版恢复").slice(0, 120),
                        },
                        true,
                      );
                  }}
                >
                  导入副本
                </button>
              </div>
            ))}
          </details>
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
                    onClick={async () => {
                      const name = window.prompt("重命名本地作品", p.name);
                      if (!name?.trim()) return;
                      try {
                        const next = {
                          ...p,
                          name: name.trim().slice(0, 120),
                          updatedAt: Date.now(),
                        };
                        await saveLocal(next);
                        if (project.id === p.id)
                          change({ ...project, name: next.name });
                        setLocalWorks(await listLocal());
                      } catch (e) {
                        setFormError(errText(e));
                      }
                    }}
                  >
                    重命名
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await saveLocal({
                          ...p,
                          id: crypto.randomUUID(),
                          name: (p.name + " · 副本").slice(0, 120),
                          cloudSync: undefined,
                          updatedAt: Date.now(),
                        });
                        setLocalWorks(await listLocal());
                      } catch (e) {
                        setFormError(errText(e));
                      }
                    }}
                  >
                    复制
                  </button>
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
                    await switchAccount(null);
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
                      setCloudWorks(await accountWorks());
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
                          if (r.userId !== user.id) {
                            notify(
                              "登录账号已改变，请刷新页面后重新打开账号作品",
                            );
                            return;
                          }
                          const p = deserialize(r.project);
                          const sync = {
                            source: serviceSource,
                            userId: user.id,
                            projectId: w.id,
                            updated: r.updated,
                          };
                          if (activeUser.current?.id !== user.id) return;
                          p.cloudSync = sync;
                          await openProject(p);
                        } catch (e) {
                          setFormError(errText(e));
                        }
                      }}
                    >
                      打开
                    </button>
                    <button
                      onClick={async () => {
                        const title = window.prompt("新的作品名称", w.title);
                        if (!title) return;
                        try {
                          const result = await api("/works/" + w.id, {
                            method: "PATCH",
                            body: JSON.stringify({
                              title,
                              expectedUpdated: w.updated,
                              expectedUserId: user.id,
                            }),
                          });
                          if (w.id === project.id) {
                            const key = cloudSyncKey(
                                serviceSource,
                                user.id,
                                w.id,
                              ),
                              known = cloudVersions.current.get(key);
                            if (known?.updated === w.updated) {
                              cloudVersions.current.set(key, {
                                ...known,
                                updated: result.updated,
                              });
                              change({ ...current.current, name: title });
                            } else
                              notify(
                                "账号作品已重命名；当前编辑的版本较旧，请重新打开或另存副本",
                              );
                          }
                          setCloudWorks(await accountWorks());
                        } catch (e) {
                          setFormError(errText(e));
                        }
                      }}
                    >
                      重命名
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await api("/works/" + w.id + "/copy", {
                            method: "POST",
                            body: JSON.stringify({ expectedUserId: user.id }),
                          });
                          setCloudWorks(await accountWorks());
                        } catch (e) {
                          setFormError(errText(e));
                        }
                      }}
                    >
                      另存账号副本
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
                          await api("/works/" + w.id, {
                            method: "DELETE",
                            body: JSON.stringify({ expectedUserId: user.id }),
                          });
                          setCloudWorks(await accountWorks());
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
        <AccountDialog
          user={user}
          onUser={switchAccount}
          onClose={() => setModal(null)}
          onWorks={openWorks}
        />
      )}
      {modal === "handmade" && (
        <HandmadeDialog
          project={project}
          onClose={() => setModal(null)}
          onResize={() => {
            setModal(null);
            openRegenerate();
          }}
          onApply={(normal, handmade, active) => {
            commit({
              ...project,
              cells: (active === "normal" ? normal : handmade).slice(),
              variants: { normal, handmade, active },
              view: "beads",
            });
            setModal(null);
            notify("已切换候选图，普通与手搓两版编辑分别保留");
          }}
        />
      )}
      {modal === "mosaic" && (
        <Dialog title="马赛克结果" wide onClose={() => setModal(null)}>
          <p>
            {project.name} · {project.width} × {project.height} 格 ·{" "}
            {counts.length}色。与当前图纸共享同一份网格，纯色块呈现。
          </p>
          <div className="candidate-preview">
            <ImportPreview
              result={{
                source: "",
                settingsKey: "",
                width: project.width,
                height: project.height,
                cells: project.cells,
              }}
              pending={false}
              progress={100}
              error=""
              onRetry={() => {}}
            />
          </div>
          <footer>
            <button onClick={openRegenerate}>从原图调整并转换</button>
            <button
              onClick={() => {
                change({ ...project, view: "beads" });
                setModal(null);
              }}
            >
              置于画板继续编辑
            </button>
            <button
              className="primary"
              onClick={() => {
                setExportOptions({ ...exportOptions, kind: "mosaic" });
                setModal("export");
              }}
            >
              保存纯马赛克PNG
            </button>
          </footer>
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
          <button onClick={() => openAdjust("adjust")}>
            图纸调节 · 亮度／对比度／饱和度／锐化／曝光
          </button>
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
          <p className="hint">
            图片计算和编辑在浏览器本地进行，本地草稿按身份分别保存。账号作品、权益、激活码和图纸下载由本服务校验。重要作品请保存命名副本或导出项目文件。
          </p>
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
            色卡为固定版本的 MARD 221
            色号体系，屏幕颜色仅作参考。雷电将军示例原图随项目保存，来源见素材记录；制图与导出使用同一项目网格。AI
            生图与更多功能中未开放的入口，按当前原站可见状态显示。
          </p>
          <footer>
            <button className="primary" onClick={() => setModal(null)}>
              开始创作 <ArrowRight />
            </button>
          </footer>
        </Dialog>
      )}
      {readyExport && (
        <Dialog
          title="导出完成"
          onClose={() => {
            if (!networkBusy) {
              refundExport();
              setReadyExport(null);
            }
          }}
        >
          <div className="export-ready">
            <CheckCircle size={40} />
            <h3>文件已生成</h3>
            <p role="status">{exportStatus}</p>
            {readyExport.job && !exportJob.current && (
              <p>
                <a
                  href={"/api/exports/" + readyExport.job + "/download"}
                  download
                >
                  再次下载
                </a>{" "}
                ·{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={
                    "/api/exports/" + readyExport.job + "/download?preview=1"
                  }
                >
                  打开备用文件后保存
                </a>
              </p>
            )}
            <p className="muted">{readyExport.name}</p>
            <p className="micro">
              {(readyExport.blob.size / 1024).toFixed(1)} KB · 点击保存到设备
            </p>
          </div>
          <footer>
            <button
              disabled={networkBusy}
              onClick={() => {
                refundExport();
                setReadyExport(null);
              }}
            >
              关闭／取消未完成任务
            </button>
            <button
              className="primary"
              disabled={networkBusy}
              onClick={submitExport}
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
            <p>{busy.progress}% · 图像在本地计算；权益和下载由本服务校验</p>
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
      {toast && !incoming && (
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
