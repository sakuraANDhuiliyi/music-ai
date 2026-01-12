import { authFetch } from '../composables/useUser.js';

const isObject = (v) => v && typeof v === 'object';

export const isMongoObjectId = (id) => /^[a-fA-F0-9]{24}$/.test(String(id || '').trim());

export async function apiGetProjectSource(projectId) {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('missing projectId');
  const res = await authFetch(`/api/projects/${id}/source`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || '加载工程失败');
  return data;
}

export async function apiCreateProjectDraft(payload) {
  const body = JSON.stringify(isObject(payload) ? payload : {});
  const res = await authFetch('/api/projects/draft', { method: 'POST', body });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || '保存草稿失败');
  return data;
}

export async function apiUpdateProjectDraft(projectId, payload) {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('missing projectId');
  const body = JSON.stringify(isObject(payload) ? payload : {});
  const res = await authFetch(`/api/projects/${id}/draft`, { method: 'PUT', body });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || '保存草稿失败');
  return data;
}

export async function apiPublishProject({ projectId, title, cover, tags, durationSec, audioFile, project }) {
  const form = new FormData();
  if (projectId) form.append('projectId', String(projectId));
  form.append('title', String(title || '').trim());
  if (cover) form.append('cover', String(cover || '').trim());
  if (tags) form.append('tags', JSON.stringify(Array.isArray(tags) ? tags : []));
  if (durationSec != null) form.append('durationSec', String(Math.max(0, Number(durationSec) || 0)));
  form.append('project', JSON.stringify(project || null));
  if (audioFile) form.append('audio', audioFile);
  form.append('audioKind', 'preview');

  const res = await authFetch('/api/projects/publish', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || '发布失败');
  return data;
}

export async function apiUploadAudioFile(file) {
  const f = file || null;
  if (!f) throw new Error('missing audio file');
  const form = new FormData();
  form.append('file', f);
  const res = await authFetch('/api/upload/audio', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || '音频上传失败');
  return data;
}

export async function apiForkProject(projectId) {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('missing projectId');
  const res = await authFetch(`/api/projects/${id}/fork`, { method: 'POST', body: JSON.stringify({}) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || 'Fork 失败');
  return data;
}

export async function apiGetProjectLineage(projectId) {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('missing projectId');
  const res = await authFetch(`/api/projects/${id}/lineage`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || '加载谱系失败');
  return data;
}
