const store = new Map();

function now() {
  return Date.now();
}

export function getCached(key) {
  const k = String(key || '');
  if (!k) return null;
  const entry = store.get(k);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= now()) {
    store.delete(k);
    return null;
  }
  return entry.value ?? null;
}

export function setCached(key, value, { ttlMs = 30_000 } = {}) {
  const k = String(key || '');
  if (!k) return;
  const ttl = Math.max(0, Number(ttlMs || 0));
  store.set(k, {
    value,
    expiresAt: ttl ? now() + ttl : 0,
    inFlight: null,
  });
}

export async function fetchCached(key, fetcher, { ttlMs = 30_000, staleWhileRevalidate = true } = {}) {
  const k = String(key || '');
  if (!k) throw new Error('cache key is required');

  const existing = store.get(k);
  const cached = getCached(k);
  if (cached != null) {
    if (staleWhileRevalidate && existing && !existing.inFlight) {
      existing.inFlight = Promise.resolve()
        .then(fetcher)
        .then((val) => {
          setCached(k, val, { ttlMs });
          return val;
        })
        .catch(() => cached)
        .finally(() => {
          const cur = store.get(k);
          if (cur) cur.inFlight = null;
        });
    }
    return cached;
  }

  if (existing?.inFlight) return existing.inFlight;

  const inFlight = Promise.resolve()
    .then(fetcher)
    .then((val) => {
      setCached(k, val, { ttlMs });
      return val;
    })
    .finally(() => {
      const cur = store.get(k);
      if (cur) cur.inFlight = null;
    });

  store.set(k, { value: null, expiresAt: 0, inFlight });
  return inFlight;
}

export function clearCache(prefix = '') {
  const p = String(prefix || '');
  if (!p) {
    store.clear();
    return;
  }
  for (const k of store.keys()) {
    if (k.startsWith(p)) store.delete(k);
  }
}

