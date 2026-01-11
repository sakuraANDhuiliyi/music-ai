const KEY = 'museai_ai_chord_collections_v1';

export function loadAiChordCollections() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveAiChordCollections(list) {
  localStorage.setItem(KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

export function addAiChordCollection(item) {
  const prev = loadAiChordCollections();
  const next = [item, ...prev];
  saveAiChordCollections(next);
  return next;
}

export function getAiChordCollectionById(id) {
  const prev = loadAiChordCollections();
  return prev.find((x) => String(x?.id) === String(id)) || null;
}

export function updateAiChordCollection(id, patch) {
  const prev = loadAiChordCollections();
  const next = prev.map((x) => {
    if (String(x?.id) !== String(id)) return x;
    return { ...x, ...(patch || {}) };
  });
  saveAiChordCollections(next);
  return next;
}

export function removeAiChordCollection(id) {
  const prev = loadAiChordCollections();
  const next = prev.filter((x) => String(x?.id) !== String(id));
  saveAiChordCollections(next);
  return next;
}
