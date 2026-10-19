import { deserialize, serialize, type Project } from "./model";
import { validCloudSync } from "./cloud-sync";
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("xing-local-v1", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("projects", { keyPath: "id" });
      r.result.createObjectStore("meta");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode),
      request = op(tx.objectStore(store));
    let value: T;
    request.onsuccess = () => {
      value = request.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value!);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || Error("存储事务中止"));
    };
  });
}
function localSnapshot(p: Project) {
  return { ...serialize(p), cloudSync: validCloudSync(p.cloudSync, p.id) };
}
function restoreLocal(raw: unknown): Project {
  const project = deserialize(raw);
  return {
    ...project,
    cloudSync: validCloudSync(
      (raw as { cloudSync?: unknown }).cloudSync,
      project.id,
    ),
  };
}
export const saveDraft = (p: Project) =>
  transaction("meta", "readwrite", (s) => s.put(localSnapshot(p), "draft"));
export const loadDraft = async () => {
  const raw = await transaction("meta", "readonly", (s) => s.get("draft"));
  return raw ? restoreLocal(raw) : null;
};
export const saveLocal = (p: Project) =>
  transaction("projects", "readwrite", (s) => s.put(localSnapshot(p)));
export const listLocal = async () => {
  const all = await transaction("projects", "readonly", (s) => s.getAll());
  return all
    .map((p) => restoreLocal(p))
    .sort((a, b) => b.updatedAt - a.updatedAt);
};
export const removeLocal = (id: string) =>
  transaction("projects", "readwrite", (s) => s.delete(id));
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function downloadProject(p: Project) {
  download(
    new Blob([JSON.stringify(serialize(p))], { type: "application/json" }),
    `${safeName(p.name)}.bead.json`,
  );
}
export const safeName = (name: string) =>
  name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "拼豆作品";
export async function readImage(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("仅支持 PNG、JPEG 和 WebP 图片");
  if (file.size > 32 * 1024 * 1024) throw Error("图片超过32MB，请先缩小图片");
  try {
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(Error("图片解码失败"));
      i.src = source;
    });
    if (image.naturalWidth * image.naturalHeight > 80e6)
      throw Error("图片超过8000万像素，请先缩小");
    if (source.length > 10e6)
      throw Error(
        "原图超过本地项目10MB存储上限，请先压缩文件；未自动缩放或转换原图",
      );
    return source;
  } catch (e) {
    throw Error(
      e instanceof Error &&
        (e.message.includes("像素") || e.message.includes("10MB"))
        ? e.message
        : "图片解码失败，请检查文件是否完整",
    );
  }
}
