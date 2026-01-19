const DB_NAME = 'museai-audio-cache';
const DB_VERSION = 1;
const STORE_NAME = 'audioFiles';

let openPromise = null;

const openDb = () => {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return openPromise;
};

const withStore = async (mode, fn) => {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    result = fn(store);
  });
};

export async function saveAudioFile(id, file) {
  const key = String(id || '').trim();
  if (!key || !file) return;
  try {
    if (navigator?.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch {
    // ignore
  }
  const payload = {
    id: key,
    name: String(file.name || 'audio'),
    type: String(file.type || 'audio/wav'),
    size: Number(file.size || 0),
    lastModified: Number(file.lastModified || Date.now()),
    blob: file instanceof Blob ? file : new Blob([file]),
    savedAt: Date.now(),
  };
  await withStore('readwrite', (store) => store.put(payload));
}

export async function loadAudioFile(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return await withStore('readonly', (store) => store.get(key));
}

export async function removeAudioFile(id) {
  const key = String(id || '').trim();
  if (!key) return;
  await withStore('readwrite', (store) => store.delete(key));
}

export async function getStorageEstimate() {
  try {
    return await navigator.storage?.estimate?.();
  } catch {
    return null;
  }
}
