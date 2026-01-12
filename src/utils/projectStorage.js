const KEY_PREFIX = 'museai_project_v1:';

const buildKey = (id) => `${KEY_PREFIX}${String(id || '')}`;

export function loadProjectDraft(id) {
  const key = buildKey(id);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.project) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProjectDraft(id, project) {
  const key = buildKey(id);
  const payload = {
    id: String(id || ''),
    savedAt: new Date().toISOString(),
    project,
  };
  localStorage.setItem(key, JSON.stringify(payload));
  return payload;
}

export function removeProjectDraft(id) {
  const key = buildKey(id);
  localStorage.removeItem(key);
}
