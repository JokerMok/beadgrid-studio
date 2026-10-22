// Product-only, one-time reset. The quarantined backup is never a draft source.
export const CACHE_EPOCH = "beadgrid-public-accounts-v1";
export const DATABASE_NAME = "beadgrid-public-accounts-v1";
export async function resetLegacyProductCache() {
  if (
    localStorage.getItem("beadgrid-cache-epoch") === CACHE_EPOCH &&
    !localStorage.getItem("beadgrid-legacy-delete-pending")
  )
    return;
  let deletionBlocked = false;
  const keys = Object.keys(localStorage).filter(
    (k) => k.startsWith("beadgrid-") && k !== "beadgrid-cache-epoch",
  );
  const metadata = Object.fromEntries(
    keys.map((k) => [k, localStorage.getItem(k)]),
  );
  const names = await indexedDB.databases().then((v) => v.map((d) => d.name));
  if (names.includes("xing-local-v1")) {
    const backup = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const r = indexedDB.open("xing-local-v1");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            stores = Array.from(db.objectStoreNames),
            result: Record<string, unknown> = {
              metadata,
              createdAt: new Date().toISOString(),
              source: "xing-local-v1",
            };
          if (!stores.length) {
            db.close();
            resolve(result);
            return;
          }
          const tx = db.transaction(stores, "readonly");
          for (const name of stores) {
            const store = tx.objectStore(name),
              values = store.getAll(),
              ids = store.getAllKeys(),
              entry: { values?: unknown[]; keys?: IDBValidKey[] } = {};
            result[name] = entry;
            values.onsuccess = () => {
              entry.values = values.result;
            };
            ids.onsuccess = () => {
              entry.keys = ids.result;
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      },
    );
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("beadgrid-quarantined-legacy-backup-v1", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("backup");
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("backup", "readwrite");
        const store = tx.objectStore("backup"),
          existing = store.get("before-public-accounts");
        existing.onsuccess = () => {
          if (!existing.result) store.put(backup, "before-public-accounts");
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("xing-local-v1");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      r.onblocked = () => {
        deletionBlocked = true;
        resolve();
      };
    });
  }
  for (const k of keys) localStorage.removeItem(k);
  if (deletionBlocked)
    localStorage.setItem("beadgrid-legacy-delete-pending", "1");
  localStorage.setItem("beadgrid-cache-epoch", CACHE_EPOCH);
}
