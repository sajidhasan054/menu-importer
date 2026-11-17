// Saved catalogs and photos, kept in this browser (IndexedDB). Falls back to
// memory when storage is blocked (private windows), so the tool still works
// for the current visit.

const DB_NAME = "menu-catalog-maker";
let dbPromise = null;
const memory = { catalogs: new Map(), photos: new Map() };
let persistent = true;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise(resolve => {
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore("catalogs", { keyPath: "id" });
          db.createObjectStore("photos");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { persistent = false; resolve(null); };
        request.onblocked = () => { persistent = false; resolve(null); };
      } catch {
        persistent = false;
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function run(storeName, mode, action) {
  const db = await open();
  if (!db) return action(null);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Saving failed. The browser may be out of storage space."));
  });
}

export const isPersistent = async () => { await open(); return persistent; };

export async function listCatalogs() {
  const all = await run("catalogs", "readonly", store => (store ? store.getAll() : { result: [...memory.catalogs.values()] }));
  return (all || []).sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export async function getCatalog(id) {
  return run("catalogs", "readonly", store => (store ? store.get(id) : { result: memory.catalogs.get(id) }));
}

export async function saveCatalog(catalog) {
  catalog.updated = Date.now();
  const copy = structuredClone(catalog);
  return run("catalogs", "readwrite", store => {
    if (!store) { memory.catalogs.set(copy.id, copy); return null; }
    return store.put(copy);
  });
}

export async function deleteCatalog(catalog) {
  for (const id of photoIds(catalog)) await deletePhoto(id);
  return run("catalogs", "readwrite", store => {
    if (!store) { memory.catalogs.delete(catalog.id); return null; }
    return store.delete(catalog.id);
  });
}

export function photoIds(catalog) {
  return (catalog.products || []).flatMap(p => p.photos.map(photo => photo.blob).filter(Boolean));
}

export async function putPhoto(blob) {
  const id = `ph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await run("photos", "readwrite", store => {
    if (!store) { memory.photos.set(id, blob); return null; }
    return store.put(blob, id);
  });
  return id;
}

export async function getPhoto(id) {
  return run("photos", "readonly", store => (store ? store.get(id) : { result: memory.photos.get(id) }));
}

export async function deletePhoto(id) {
  urls.delete(id);
  return run("photos", "readwrite", store => {
    if (!store) { memory.photos.delete(id); return null; }
    return store.delete(id);
  });
}

// Object URLs for showing stored photos, created once per photo.
const urls = new Map();
export async function photoSrc(photo) {
  if (photo.url) return photo.url;
  if (!photo.blob) return "";
  if (!urls.has(photo.blob)) {
    const blob = await getPhoto(photo.blob);
    urls.set(photo.blob, blob ? URL.createObjectURL(blob) : "");
  }
  return urls.get(photo.blob);
}
