const sources = new Map(); // id -> { stop?: () => void }
let activeSourceId = null;
const listeners = new Set(); // (id: string|null) => void

const emit = () => {
  for (const cb of Array.from(listeners)) {
    try {
      cb(activeSourceId);
    } catch {
      // ignore
    }
  }
};

export function getActivePlaybackSource() {
  return activeSourceId;
}

export function onActivePlaybackSourceChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function registerPlaybackSource(id, handlers = {}) {
  const key = String(id || '').trim();
  if (!key) throw new Error('registerPlaybackSource: missing id');
  const stop = typeof handlers.stop === 'function' ? handlers.stop : null;
  sources.set(key, { stop });

  return () => {
    sources.delete(key);
    if (activeSourceId === key) {
      activeSourceId = null;
      emit();
    }
  };
}

export function requestPlaybackStart(id) {
  const key = String(id || '').trim();
  if (!key) return;

  // Stop others first.
  for (const [otherId, h] of sources.entries()) {
    if (otherId === key) continue;
    try {
      h?.stop?.();
    } catch {
      // ignore
    }
  }

  if (activeSourceId !== key) {
    activeSourceId = key;
    emit();
  }
}

export function notifyPlaybackStop(id) {
  const key = String(id || '').trim();
  if (!key) return;
  if (activeSourceId !== key) return;
  activeSourceId = null;
  emit();
}

export function stopAllPlayback() {
  for (const h of sources.values()) {
    try {
      h?.stop?.();
    } catch {
      // ignore
    }
  }
  if (activeSourceId !== null) {
    activeSourceId = null;
    emit();
  }
}

