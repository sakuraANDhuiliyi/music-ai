<script setup>
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { authFetch } from '../composables/useUser.js';
import TransportBar from '../components/editor/TransportBar.vue';
import TrackList from '../components/editor/TrackList.vue';
import Timeline from '../components/editor/Timeline.vue';
import MidiPianoRoll from '../components/editor/MidiPianoRoll.vue';
import UiButton from '../components/UiButton.vue';
import { createMockProject } from '../components/editor/mockProject.js';
import { computePeaks } from '../audio/peaks.js';
import { renderProjectToWavFile } from '../audio/mixdown.js';
import { normalizeFxSettings } from '../audio/fxChain.js';
import { loadAudioFile, saveAudioFile, removeAudioFile, getStorageEstimate } from '../utils/audioFileCache.js';
import AudioEngine from '../audio/AudioEngine.js';
import MidiEngine from '../audio/MidiEngine.js';
import { getSharedAudioContext } from '../audio/sharedAudioContext.js';
import { notifyPlaybackStop, registerPlaybackSource, requestPlaybackStart } from '../audio/playbackCoordinator.js';
import { noteToMidi } from '../utils/musicNotes.js';
import { loadProjectDraft, saveProjectDraft, removeProjectDraft } from '../utils/projectStorage.js';
import {
  apiCreateProjectDraft,
  apiCreateProjectVersion,
  apiGetProjectSource,
  apiGetProjectVersions,
  apiPublishProject,
  apiRestoreProjectVersion,
  apiUpdateProjectDraft,
  apiUploadAudioFile,
  isMongoObjectId,
} from '../api/projects.js';

const route = useRoute();
const router = useRouter();

const LAST_STUDIO_PROJECT_KEY = 'studio:lastProjectId';
const LAST_STUDIO_SNAPSHOT_KEY = 'studio:lastSnapshot';
const DRAFT_MAP_KEY = 'studio:draftMap';

const readLastStudioProjectId = () => {
  try {
    return String(localStorage.getItem(LAST_STUDIO_PROJECT_KEY) || '').trim();
  } catch {
    return '';
  }
};

const writeLastStudioProjectId = (id) => {
  const next = String(id || '').trim();
  if (!next || next === 'proj_demo') return;
  try {
    localStorage.setItem(LAST_STUDIO_PROJECT_KEY, next);
  } catch {
    // ignore
  }
};

const readDraftMap = () => {
  try {
    const raw = localStorage.getItem(DRAFT_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeDraftMap = (map) => {
  try {
    localStorage.setItem(DRAFT_MAP_KEY, JSON.stringify(map || {}));
  } catch {
    // ignore
  }
};

const getDraftMapId = (localId) => {
  const id = String(localId || '').trim();
  if (!id) return '';
  const map = readDraftMap();
  return String(map[id] || '').trim();
};

const setDraftMapId = (localId, serverId) => {
  const lid = String(localId || '').trim();
  const sid = String(serverId || '').trim();
  if (!lid || !sid) return;
  const map = readDraftMap();
  map[lid] = sid;
  writeDraftMap(map);
};

const saveLastStudioSnapshot = (id, project) => {
  const payload = {
    id: String(id || '').trim(),
    savedAt: new Date().toISOString(),
    project,
  };
  try {
    localStorage.setItem(LAST_STUDIO_SNAPSHOT_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
};

const loadLastStudioSnapshot = (id) => {
  try {
    const raw = localStorage.getItem(LAST_STUDIO_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.project) return null;
    const snapId = String(parsed.id || '').trim();
    if (id && snapId && snapId !== String(id).trim()) return null;
    return parsed;
  } catch {
    return null;
  }
};

const resolveRouteProjectId = () => String(route.params.projectId || route.query.projectId || '').trim();

const projectId = computed(() => {
  const routeId = resolveRouteProjectId();
  if (routeId) return routeId;
  const saved = readLastStudioProjectId();
  return saved || 'proj_demo';
});
const resolvedProjectDocId = ref('');

const hasToken = () => {
  try {
    return Boolean(localStorage.getItem('token'));
  } catch {
    return false;
  }
};

const isPlaying = ref(false);
const isImportingAudio = ref(false);
const audioEngine = ref(null);
const midiEngine = ref(null);
const selectedClipIds = ref([]);
const selectedTrackId = ref(null);
const wasPlayingBeforeScrub = ref(false);
const pxPerSecond = ref(96);
const snapEnabled = ref(true);
const autoCrossfade = ref(true);
const clipClipboard = ref(null);
const PLAYBACK_SOURCE_ID = 'studio';
let unregisterPlayback = null;

const publishOpen = ref(false);
const publishTitle = ref('');
const publishCover = ref('');
const publishTagsText = ref('');
const publishAudioFile = ref(null);
const isPublishing = ref(false);
const isRenderingPreview = ref(false);
const isSavingDraft = ref(false);

const exportOpen = ref(false);
const isExportingWav = ref(false);
const isExportingMp3 = ref(false);
const isRegionDrawing = ref(false);
const fxOpen = ref(false);
const isLoadingProject = ref(false);
const isRehydratingAssets = ref(false);

const versionsOpen = ref(false);
const versions = ref([]);
const headVersionId = ref('');
const versionTitle = ref('');
const versionNote = ref('');
const isLoadingVersions = ref(false);
const isCreatingVersion = ref(false);
const isRestoringVersion = ref(false);
const isLoggedIn = computed(() => hasToken());
const isVersionLoginTipOpen = ref(false);
const missingAudioAssets = ref([]);

const isProjectEmpty = computed(() => {
  const tracks = Array.isArray(project.value?.tracks) ? project.value.tracks : [];
  const clips = Array.isArray(project.value?.clips) ? project.value.clips : [];
  const assets = Array.isArray(project.value?.assets) ? project.value.assets : [];
  return tracks.length === 0 && clips.length === 0 && assets.length === 0;
});

const cleanupProjectAudioCache = async (proj) => {
  const assets = Array.isArray(proj?.assets) ? proj.assets : [];
  const ids = assets
    .filter((a) => String(a?.type || '') === 'audio')
    .map((a) => String(a?.id || ''))
    .filter(Boolean);
  for (const id of ids) {
    localAudioFilesByAssetId.delete(id);
    try {
      await removeAudioFile(id);
    } catch {
      // ignore
    }
  }
};

const clearProject = async () => {
  if (!confirm('确定清空当前工程？该操作会移除所有轨道与素材。')) return;
  const current = serializeProjectForStorage(project.value);
  await cleanupProjectAudioCache(current);
  const id = String(project.value?.meta?.id || projectId.value || '').trim();
  if (id) removeProjectDraft(id);
  project.value = createMockProject(id || 'proj_demo');
  ensureFxSettings();
  audioEngine.value?.applyMasterFx?.(project.value, { active: false });
  audioEngine.value?.applyTrackMix?.(project.value);
  audioEngine.value?.applyClipMix?.(project.value);
  midiEngine.value?.applyTrackMix?.(project.value);
  touch();
};

const createNewProject = async () => {
  if (!confirm('新建工程将关闭当前工程，是否继续？')) return;
  const current = serializeProjectForStorage(project.value);
  await cleanupProjectAudioCache(current);
  const newId = createId('proj');
  project.value = createMockProject(newId);
  ensureFxSettings();
  audioEngine.value?.applyMasterFx?.(project.value, { active: false });
  audioEngine.value?.applyTrackMix?.(project.value);
  audioEngine.value?.applyClipMix?.(project.value);
  midiEngine.value?.applyTrackMix?.(project.value);
  writeLastStudioProjectId(newId);
  router.replace({ name: 'Studio', params: { projectId: newId } }).catch(() => {});
  touch();
};

const clipboardToast = ref('');
const clipboardToastTone = ref('ok');
let clipboardToastTimer = null;

const saveToast = ref('');
const saveToastTone = ref('ok');
let saveToastTimer = null;

const showSaveToast = (message, tone = 'ok') => {
  saveToastTone.value = tone === 'error' ? 'error' : 'ok';
  saveToast.value = String(message || '');
  if (saveToastTimer) window.clearTimeout(saveToastTimer);
  saveToastTimer = window.setTimeout(() => {
    saveToast.value = '';
  }, 1800);
};

const saveDraftNow = async () => {
  if (isSavingDraft.value) return;
  if (!hasToken()) {
    alert('请先登录后再保存草稿');
    return;
  }
  isSavingDraft.value = true;
  try {
    const docId = await ensureServerDraft();
    const payload = serializeProjectForStorage(project.value);
    await apiUpdateProjectDraft(docId, { project: payload, title: payload?.meta?.title || '' });
    const localId = String(project.value?.meta?.id || projectId.value || '').trim();
    if (localId && docId) setDraftMapId(localId, docId);
    showSaveToast('草稿已保存');
  } catch (e) {
    showSaveToast(e?.message || '草稿保存失败', 'error');
  } finally {
    isSavingDraft.value = false;
  }
};

const ensureFxSettings = () => {
  project.value.fx = normalizeFxSettings(project.value?.fx || project.value?.meta?.fx || {});
};

const commitFxSettings = () => {
  ensureFxSettings();
  touch();
  audioEngine.value?.applyMasterFx?.(project.value, { active: isPlaying.value });
};

const previewFxSettings = () => {
  ensureFxSettings();
  audioEngine.value?.applyMasterFx?.(project.value, { active: isPlaying.value });
};

const finalizeProjectLoad = () => {
  ensureFxSettings();
  audioEngine.value?.applyMasterFx?.(project.value, { active: isPlaying.value });
  audioEngine.value?.applyTrackMix?.(project.value);
  audioEngine.value?.applyClipMix?.(project.value);
  midiEngine.value?.applyTrackMix?.(project.value);

  isLoadingProject.value = false;
  isRehydratingAssets.value = true;
  rehydrateLocalAudioAssets()
    .catch(() => {})
    .finally(() => {
      isRehydratingAssets.value = false;
    });
};

const downloadBlob = (blob, filename) => {
  const name = String(filename || '').trim() || 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const downloadUrl = (url, filename) => {
  const href = String(url || '').trim();
  if (!href) return;
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = String(filename).replace(/[\\/:*?"<>|]/g, '_');
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

const exportProjectJson = () => {
  try {
    const payload = serializeProjectForStorage(project.value);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const id = String(project.value?.meta?.id || projectId.value || 'project').trim() || 'project';
    downloadBlob(blob, `${id}.json`);
  } catch (e) {
    alert(e?.message || '导出 JSON 失败');
  }
};

const exportMixdownWav = async () => {
  if (isExportingWav.value) return;
  isExportingWav.value = true;
  try {
    const id = String(project.value?.meta?.id || projectId.value || 'project').trim() || 'project';
    const file = await renderProjectToWavFile(project.value, {
      filename: `${id}.wav`,
      sampleRate: 44100,
      filesByAssetId: localAudioFilesByAssetId,
      maxDurationSec: 600,
      fxQuality: 'high',
    });
    downloadBlob(file, file.name);
  } catch (e) {
    alert(e?.message || '导出 WAV 失败');
  } finally {
    isExportingWav.value = false;
  }
};

const exportMixdownMp3 = async () => {
  if (isExportingMp3.value) return;
  if (!hasToken()) {
    alert('导出 MP3 需要后端转码：请先登录并确保服务端可用 ffmpeg');
    return;
  }
  isExportingMp3.value = true;
  try {
    const id = String(project.value?.meta?.id || projectId.value || 'project').trim() || 'project';
    const wav = await renderProjectToWavFile(project.value, {
      filename: `${id}.wav`,
      sampleRate: 44100,
      filesByAssetId: localAudioFilesByAssetId,
      maxDurationSec: 600,
      fxQuality: 'high',
    });
    const res = await authFetch('/api/convert/mp3', { method: 'POST', body: (() => { const f = new FormData(); f.append('file', wav); return f; })() });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || 'MP3 转码失败');
    const url = String(data?.url || '').trim();
    downloadUrl(url, `${id}.mp3`);
  } catch (e) {
    alert(e?.message || '导出 MP3 失败（可能未安装 ffmpeg）');
  } finally {
    isExportingMp3.value = false;
  }
};

const showClipboardToast = (message, tone = 'ok') => {
  clipboardToastTone.value = tone === 'error' ? 'error' : 'ok';
  clipboardToast.value = String(message || '');
  if (clipboardToastTimer) window.clearTimeout(clipboardToastTimer);
  clipboardToastTimer = window.setTimeout(() => {
    clipboardToast.value = '';
  }, 1800);
};

const encodeBase64Utf8 = (text) => {
  const raw = String(text || '');
  try {
    const bytes = new TextEncoder().encode(raw);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch {
    return '';
  }
};

const decodeBase64Utf8 = (b64) => {
  const raw = String(b64 || '');
  if (!raw) return '';
  try {
    const bin = atob(raw);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
};

const tryParseJson = (text) => {
  const t = String(text || '').trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

const normalizeAiChordClipboard = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  if (Number(obj.museai) !== 1) return null;
  if (String(obj.kind || '') !== 'aiChordCollection') return null;
  const chordsRaw = Array.isArray(obj.chords) ? obj.chords : [];
  const chords = chordsRaw
    .map((c) => ({
      name: String(c?.name || '').trim(),
      notes: Array.isArray(c?.notes) ? c.notes.map((n) => String(n)).filter(Boolean) : [],
    }))
    .filter((c) => c.notes.length > 0);
  if (!chords.length) return null;

  const bpm = Math.max(40, Math.min(240, Math.round(Number(obj.bpm) || 120)));
  const chordBeats = Math.max(1, Math.min(16, Number(obj.chordBeats) || 4));
  const melodyRaw = Array.isArray(obj.melody) ? obj.melody : [];
  const melody = melodyRaw
    .map((m) => ({
      note: String(m?.note || '').trim(),
      durBeats: Math.max(0.125, Math.min(16, Number(m?.durBeats) || 1)),
    }))
    .filter((m) => m.note);

  return {
    name: String(obj.name || '').trim() || 'AI Chords',
    prompt: String(obj.prompt || '').trim(),
    desc: String(obj.desc || '').trim(),
    chords,
    bpm,
    chordBeats,
    melody,
    genre: String(obj.genre || '').trim(),
    key: String(obj.key || '').trim(),
    scale: String(obj.scale || '').trim(),
    structure: String(obj.structure || '').trim(),
    sections: Array.isArray(obj.sections) ? obj.sections : [],
  };
};

const buildMidiNotesFromAiPayload = (data) => {
  const chords = Array.isArray(data?.chords) ? data.chords : [];
  const melody = Array.isArray(data?.melody) ? data.melody : [];
  const bpm = Math.max(40, Math.min(240, Math.round(Number(data?.bpm) || 120)));
  const chordBeats = Math.max(1, Math.min(16, Number(data?.chordBeats) || 4));
  const chordDurSec = (60 / bpm) * chordBeats;

  const notes = [];

  for (let i = 0; i < chords.length; i += 1) {
    const chord = chords[i] || {};
    const start = i * chordDurSec;
    const dur = chordDurSec;
    const chordNotes = Array.isArray(chord?.notes) ? chord.notes : [];
    for (const ns of chordNotes) {
      const midi = noteToMidi(String(ns || '').trim());
      if (typeof midi !== 'number') continue;
      notes.push({
        id: `note_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
        midi,
        start,
        dur,
        velocity: 0.55,
      });
    }
  }

  let t = 0;
  for (const m of melody) {
    const note = String(m?.note || '').trim();
    const durBeats = Math.max(0.125, Math.min(16, Number(m?.durBeats) || 1));
    const dur = (60 / bpm) * durBeats;

    if (note && note.toUpperCase() !== 'REST') {
      const midi = noteToMidi(note);
      if (typeof midi === 'number') {
        notes.push({
          id: `note_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
          midi,
          start: t,
          dur,
          velocity: 0.85,
        });
      }
    }
    t += dur;
  }

  notes.sort((a, b) => (Number(a?.start) || 0) - (Number(b?.start) || 0));
  const duration = Math.max(
    0.1,
    ...notes.map((n) => Math.max(0, Number(n?.start) || 0) + Math.max(0, Number(n?.dur) || 0))
  );

  return { bpm, chordBeats, chordDurSec, notes, duration };
};

const importAiChordCollectionAtPlayhead = (payload) => {
  const data = normalizeAiChordClipboard(payload);
  if (!data) return false;

  pushHistory();

  const playhead = Math.max(0, Number(project.value.transport?.playhead) || 0);
  const midi = buildMidiNotesFromAiPayload(data);
  const duration = midi.duration;

  const assetId = createId('asset_midi');
  const clipId = createId('clip_midi');

  const stored = encodeBase64Utf8(JSON.stringify({ ...data, chordDurSec: midi.chordDurSec }));
  const asset = {
    id: assetId,
    type: 'midi',
    url: `AI Chords - ${data.name}`,
    duration,
    sampleRate: 0,
    channels: 0,
    hash: `museai_chords:${stored}`,
    peaks: { kind: 'none' },
    data: {
      kind: 'midi',
      bpm: midi.bpm,
      chordBeats: midi.chordBeats,
      notes: midi.notes,
    },
  };

  let targetTrackId = project.value.tracks.find((t) => t.type === 'midi')?.id || null;
  if (!targetTrackId) targetTrackId = addTrack('midi', { commit: false });
  if (!targetTrackId) return false;

  const clip = {
    id: clipId,
    trackId: targetTrackId,
    assetId,
    start: playhead,
    length: duration,
    offset: 0,
    gain: 0,
    pan: 0,
    playbackRate: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeInCurve: 'linear',
    fadeOutCurve: 'linear',
  };

  project.value.assets = [asset, ...project.value.assets];
  project.value.clips = [...project.value.clips, clip];
  selectedClipIds.value = [clipId];
  selectedTrackId.value = String(targetTrackId);
  touch();
  return true;
};

const pasteFromSystemClipboardAtPlayhead = async () => {
  if (!navigator.clipboard?.readText) {
    showClipboardToast('无法读取系统剪贴板：请在 https/localhost 环境使用', 'error');
    return false;
  }
  // Prefer async clipboard API when available (localhost is a secure context).
  try {
    const text = await navigator.clipboard.readText();
    const obj = tryParseJson(text);
    if (obj && importAiChordCollectionAtPlayhead(obj)) {
      showClipboardToast('已从剪贴板导入到时间线');
      return true;
    }
    showClipboardToast('剪贴板内容不是 AI 和弦素材', 'error');
  } catch {
    showClipboardToast('无法读取系统剪贴板：请允许权限', 'error');
  }
  return false;
};

const importMidiNotes = (notes, options = {}) => {
  const list = Array.isArray(notes) ? notes : [];
  if (!list.length) return false;
  pushHistory();

  const cleaned = list
    .map((n) => ({
      midi: Math.round(Number(n?.midi)),
      start: Math.max(0, Number(n?.start) || 0),
      dur: Math.max(0.05, Number(n?.dur) || 0.2),
      velocity: Math.max(0.05, Math.min(1, Number(n?.velocity) || 0.8)),
    }))
    .filter((n) => Number.isFinite(n.midi) && n.midi >= 0 && n.midi <= 127);
  if (!cleaned.length) return false;

  cleaned.sort((a, b) => (a.start - b.start));
  const duration = Math.max(0.1, ...cleaned.map((n) => n.start + n.dur));

  const assetId = createId('asset_midi');
  const clipId = createId('clip_midi');

  const asset = {
    id: assetId,
    type: 'midi',
    url: options?.title ? String(options.title) : 'MIDI Import',
    duration,
    sampleRate: 0,
    channels: 0,
    hash: `midi_import:${Date.now()}`,
    peaks: { kind: 'none' },
    data: {
      kind: 'midi',
      notes: cleaned,
    },
  };

  let targetTrackId = project.value.tracks.find((t) => t.type === 'midi')?.id || null;
  if (!targetTrackId) targetTrackId = addTrack('midi', { commit: false });
  if (!targetTrackId) return false;

  const startAt = options?.startAt != null ? Number(options.startAt) : 0;

  const clip = {
    id: clipId,
    trackId: targetTrackId,
    assetId,
    start: Math.max(0, startAt),
    length: duration,
    offset: 0,
    gain: 0,
    pan: 0,
    playbackRate: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeInCurve: 'linear',
    fadeOutCurve: 'linear',
  };

  project.value.assets = [asset, ...project.value.assets];
  project.value.clips = [...project.value.clips, clip];
  selectedClipIds.value = [clipId];
  selectedTrackId.value = String(targetTrackId);
  touch();
  return true;
};

const loadImportMidiFromRoute = () => {
  const key = String(route.query?.importMidiKey || '').trim();
  const b64 = String(route.query?.importMidi || '').trim();
  let payload = null;

  if (key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) payload = JSON.parse(raw);
      localStorage.removeItem(key);
    } catch {
      payload = null;
    }
  } else if (b64) {
    const raw = decodeBase64Utf8(b64);
    payload = tryParseJson(raw);
  }

  const notes = Array.isArray(payload?.notes) ? payload.notes : Array.isArray(payload) ? payload : [];
  if (notes.length) {
    importMidiNotes(notes, { title: payload?.title || 'MIDI 导入', startAt: 0 });
    router.replace({ query: { ...route.query, importMidiKey: undefined, importMidi: undefined } }).catch(() => {});
  }
};

const undoStack = ref([]);
const redoStack = ref([]);
const HISTORY_LIMIT = 50;
const isRestoring = ref(false);

const project = ref(createMockProject(projectId.value));

let skipNextLoadId = '';

const toFloat32Array = (value, fallbackLen = 0) => {
  if (value instanceof Float32Array) return new Float32Array(value);
  if (Array.isArray(value)) return new Float32Array(value.map((n) => Number(n) || 0));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => String(Number(k)) === String(k))
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (!keys.length) return new Float32Array(Math.max(0, Number(fallbackLen) || 0));
    const out = new Float32Array(keys.length);
    for (let i = 0; i < keys.length; i += 1) out[i] = Number(value[keys[i]]) || 0;
    return out;
  }
  return new Float32Array(Math.max(0, Number(fallbackLen) || 0));
};

const hydrateProjectForRuntime = (rawProject) => {
  const p = rawProject && typeof rawProject === 'object' ? rawProject : {};
  const assets = Array.isArray(p.assets) ? p.assets : [];
  const nextAssets = assets.map((a) => {
    const peaks = a?.peaks;
    if (!peaks || typeof peaks !== 'object') return a;
    if (String(peaks.kind || '') !== 'minmax') return a;
    const points = Math.max(0, Number(peaks.points) || 0);
    const min = toFloat32Array(peaks.min, points);
    const max = toFloat32Array(peaks.max, points);
    return { ...a, peaks: { ...peaks, min, max } };
  });
  return { ...p, assets: nextAssets };
};

const serializeProjectForStorage = (runtimeProject) => {
  const snap = sanitizeProject(runtimeProject);
  // Ensure JSON-friendly representation for persistence.
  snap.assets = (snap.assets || []).map((a) => {
    const peaks = a?.peaks;
    if (!peaks || typeof peaks !== 'object') return a;
    if (String(peaks.kind || '') !== 'minmax') return a;
    const min = peaks.min instanceof Float32Array ? Array.from(peaks.min) : Array.isArray(peaks.min) ? peaks.min : [];
    const max = peaks.max instanceof Float32Array ? Array.from(peaks.max) : Array.isArray(peaks.max) ? peaks.max : [];
    return { ...a, peaks: { ...peaks, min, max } };
  });
  return snap;
};

const formatVersionTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
};

const versionKindLabel = (kind) => {
  const k = String(kind || 'snapshot');
  if (k === 'publish') return '发布';
  if (k === 'fork') return 'Fork';
  if (k === 'restore') return '回滚';
  return '快照';
};

const ensureServerDraft = async () => {
  if (!hasToken()) throw new Error('版本管理需要登录');
  const routeId = String(projectId.value || '').trim();
  const existing = resolvedProjectDocId.value || (isMongoObjectId(routeId) ? routeId : '');
  if (existing) return existing;

  const payload = serializeProjectForStorage(project.value);
  const created = await apiCreateProjectDraft({ project: payload, title: payload?.meta?.title || '' });
  const newId = String(created?.id || created?._id || '').trim();
  if (newId && isMongoObjectId(newId)) {
    resolvedProjectDocId.value = newId;
    project.value.meta.id = newId;
    skipNextLoadId = newId;
    router.replace({ name: 'Studio', params: { projectId: newId } }).catch(() => {});
    return newId;
  }
  throw new Error('创建草稿失败');
};

const loadVersions = async () => {
  if (isLoadingVersions.value) return;
  isLoadingVersions.value = true;
  try {
    const docId = await ensureServerDraft();
    const data = await apiGetProjectVersions(docId, { limit: 30 });
    versions.value = Array.isArray(data?.items) ? data.items : [];
    headVersionId.value = String(data?.headVersionId || '');
  } catch (e) {
    showSaveToast(e?.message || '加载版本失败', 'error');
  } finally {
    isLoadingVersions.value = false;
  }
};

const openVersionsPanel = async () => {
  versionsOpen.value = true;
  await loadVersions();
};

const goLoginFromVersions = () => {
  router.push({ name: 'Login', query: { redirect: route.fullPath } }).catch(() => {});
};

const createVersionSnapshot = async () => {
  if (isCreatingVersion.value) return;
  isCreatingVersion.value = true;
  try {
    const docId = await ensureServerDraft();
    const payload = serializeProjectForStorage(project.value);
    await apiCreateProjectVersion(docId, {
      title: String(versionTitle.value || '').trim(),
      note: String(versionNote.value || '').trim(),
      project: payload,
    });
    versionTitle.value = '';
    versionNote.value = '';
    await loadVersions();
    showSaveToast('已创建版本快照');
  } catch (e) {
    showSaveToast(e?.message || '创建版本失败', 'error');
  } finally {
    isCreatingVersion.value = false;
  }
};

const restoreVersionSnapshot = async (item) => {
  if (isRestoringVersion.value) return;
  const targetId = String(item?.versionId || '').trim();
  if (!targetId) return;
  if (!window.confirm(`确定回滚到版本 ${targetId} 吗？当前未保存的修改将被覆盖。`)) return;

  isRestoringVersion.value = true;
  isRestoring.value = true;
  try {
    const docId = await ensureServerDraft();
    const data = await apiRestoreProjectVersion(docId, targetId, { title: `恢复 ${targetId}` });
    const loaded = hydrateProjectForRuntime(data?.project || {});
    if (loaded?.meta) loaded.meta.id = docId;

    audioEngine.value?.pause?.();
    midiEngine.value?.pause?.();
    isPlaying.value = false;
    notifyPlaybackStop(PLAYBACK_SOURCE_ID);
    selectedClipIds.value = [];
    selectedTrackId.value = null;
    clipClipboard.value = null;
    undoStack.value = [];
    redoStack.value = [];
    changeSeq = 0;
    lastSavedSeq = 0;

    project.value = loaded?.meta ? loaded : createMockProject(docId);
    resolvedProjectDocId.value = docId;
    audioEngine.value?.applyTrackMix?.(project.value);
    audioEngine.value?.applyClipMix?.(project.value);
    midiEngine.value?.applyTrackMix?.(project.value);

    await loadVersions();
    showSaveToast('已回滚到该版本');
  } catch (e) {
    showSaveToast(e?.message || '回滚失败', 'error');
  } finally {
    isRestoring.value = false;
    isRestoringVersion.value = false;
  }
};

let autosaveTimer = null;
let changeSeq = 0;
let lastSavedSeq = 0;

const scheduleAutoSave = () => {
  if (isRestoring.value) return;
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(async () => {
    if (isRestoring.value) return;
    if (changeSeq === lastSavedSeq) return;
    const currentId = String(project.value?.meta?.id || projectId.value || '').trim();
    if (!currentId) return;

    const payload = serializeProjectForStorage(project.value);
    try {
      saveProjectDraft(currentId, payload);
      saveLastStudioSnapshot(currentId, payload);
    } catch {
      // ignore local persistence failures
    }

    if (!hasToken()) {
      lastSavedSeq = changeSeq;
      return;
    }

    try {
      const routeId = String(projectId.value || '').trim();
      const docId = resolvedProjectDocId.value || (isMongoObjectId(routeId) ? routeId : '');
      if (docId) {
        await apiUpdateProjectDraft(docId, { project: payload, title: payload?.meta?.title || '' });
        resolvedProjectDocId.value = docId;
      } else {
        const created = await apiCreateProjectDraft({ project: payload, title: payload?.meta?.title || '' });
        const newId = String(created?.id || created?._id || '').trim();
        if (newId && isMongoObjectId(newId)) {
          resolvedProjectDocId.value = newId;
          setDraftMapId(currentId, newId);
        }
      }
      lastSavedSeq = changeSeq;
      showSaveToast('已自动保存');
    } catch (e) {
      showSaveToast(e?.message || '自动保存失败', 'error');
    }
  }, 900);
};

const loadProjectById = async (id) => {
  isLoadingProject.value = true;
  const pid = String(id || '').trim();
  if (pid && !isMongoObjectId(pid)) {
    const mapped = getDraftMapId(pid);
    if (mapped) resolvedProjectDocId.value = mapped;
  }

  audioEngine.value?.pause?.();
  midiEngine.value?.pause?.();
  isPlaying.value = false;
  notifyPlaybackStop(PLAYBACK_SOURCE_ID);
  selectedClipIds.value = [];
  selectedTrackId.value = null;
  clipClipboard.value = null;
  undoStack.value = [];
  redoStack.value = [];
  changeSeq = 0;
  lastSavedSeq = 0;

  try {
    // 1) Prefer server (only works for owner).
    if (hasToken() && isMongoObjectId(pid)) {
      try {
        const data = await apiGetProjectSource(pid);
        const loaded = hydrateProjectForRuntime(data?.project || {});
        if (loaded?.meta) loaded.meta.id = pid;
        project.value = loaded?.meta ? loaded : createMockProject(pid);
        resolvedProjectDocId.value = pid;
        try {
          const payload = serializeProjectForStorage(project.value);
          saveLastStudioSnapshot(pid, payload);
        } catch {
          // ignore
        }
        finalizeProjectLoad();
        return;
      } catch {
        // fall through to local
      }
    }

    // 2) Local draft
    const local = loadProjectDraft(pid);
    if (local?.project) {
      const loaded = hydrateProjectForRuntime(local.project);
      if (loaded?.meta) loaded.meta.id = pid;
      project.value = loaded?.meta ? loaded : createMockProject(pid);
      resolvedProjectDocId.value = isMongoObjectId(pid) ? pid : '';
      try {
        const payload = serializeProjectForStorage(project.value);
        saveLastStudioSnapshot(pid, payload);
      } catch {
        // ignore
      }
      finalizeProjectLoad();
      return;
    }

    // 2.5) Last snapshot fallback (for restart recovery)
    const snap = loadLastStudioSnapshot(pid);
    if (snap?.project) {
      const loaded = hydrateProjectForRuntime(snap.project);
      if (loaded?.meta) loaded.meta.id = pid || loaded.meta.id;
      project.value = loaded?.meta ? loaded : createMockProject(pid || loaded?.meta?.id);
      resolvedProjectDocId.value = isMongoObjectId(pid) ? pid : '';
      finalizeProjectLoad();
      return;
    }

    // 3) Fallback mock
    project.value = createMockProject(pid);
    resolvedProjectDocId.value = isMongoObjectId(pid) ? pid : '';
    finalizeProjectLoad();
  } finally {
    if (!isLoadingProject.value) return;
    isLoadingProject.value = false;
  }
};

watch(projectId, async (id) => {
  if (String(id) && String(id) === String(skipNextLoadId)) {
    skipNextLoadId = '';
    return;
  }
  writeLastStudioProjectId(id);
  await loadProjectById(id);
}, { immediate: true });

watch(
  () => resolveRouteProjectId(),
  (id) => {
    if (String(id || '').trim()) return;
    const saved = readLastStudioProjectId();
    if (!saved) return;
    router.replace({ name: 'Studio', params: { projectId: saved } }).catch(() => {});
  },
  { immediate: true }
);

watch(
  () => ({ key: route.query?.importMidiKey, raw: route.query?.importMidi }),
  () => loadImportMidiFromRoute(),
  { immediate: true }
);

const touch = () => {
  project.value.meta.updatedAt = new Date().toISOString();
  changeSeq += 1;
  scheduleAutoSave();
};

const clonePeaks = (peaks) => {
  if (!peaks || typeof peaks !== 'object') return null;
  const kind = String(peaks.kind || 'pending');
  if (kind !== 'minmax') return { kind };

  const safeArray = (val) => {
    if (val instanceof Float32Array) return new Float32Array(val);
    if (Array.isArray(val)) return new Float32Array(val);
    return new Float32Array();
  };

  return {
    kind,
    points: Number(peaks.points) || 0,
    channels: Number(peaks.channels) || 1,
    sampleRate: Number(peaks.sampleRate) || 0,
    samplesPerPeak: Number(peaks.samplesPerPeak) || 0,
    duration: Number(peaks.duration) || 0,
    min: safeArray(peaks.min),
    max: safeArray(peaks.max),
  };
};

const cloneTrack = (track) => ({
  id: String(track?.id || ''),
  name: String(track?.name || ''),
  type: track?.type === 'midi' ? 'midi' : 'audio',
  mute: Boolean(track?.mute),
  solo: Boolean(track?.solo),
  gain: Number(track?.gain) || 0,
  pan: Number(track?.pan) || 0,
  fxChain: Array.isArray(track?.fxChain) ? track.fxChain.map((fx) => ({ ...fx })) : [],
});

const cloneAsset = (asset) => ({
  id: String(asset?.id || ''),
  type: asset?.type === 'midi' ? 'midi' : 'audio',
  url: asset?.url ? String(asset.url) : '',
  duration: Number(asset?.duration) || 0,
  sampleRate: Number(asset?.sampleRate) || 0,
  channels: Number(asset?.channels) || 1,
  hash: asset?.hash ? String(asset.hash) : '',
  peaks: clonePeaks(asset?.peaks),
  data: asset?.data && typeof asset.data === 'object' ? { ...asset.data } : null,
});

const cloneClip = (clip) => ({
  id: String(clip?.id || ''),
  trackId: clip?.trackId != null ? String(clip.trackId) : '',
  assetId: clip?.assetId != null ? String(clip.assetId) : '',
  start: Number(clip?.start) || 0,
  length: Number(clip?.length) || 0,
  offset: Number(clip?.offset) || 0,
  gain: Number(clip?.gain) || 0,
  pan: Number(clip?.pan) || 0,
  playbackRate: Number(clip?.playbackRate) || 1,
  fadeIn: Number(clip?.fadeIn) || 0,
  fadeOut: Number(clip?.fadeOut) || 0,
  fadeInCurve: String(clip?.fadeInCurve || 'linear'),
  fadeOutCurve: String(clip?.fadeOutCurve || 'linear'),
});

const sanitizeProject = (value) => {
  const raw = toRaw(value) || {};
  const meta = raw.meta || {};
  const transport = raw.transport || {};
  const timeSignature = transport.timeSignature || {};
  const loopRange = transport.loopRange || {};
  const fork = raw.fork || {};
  const fx = normalizeFxSettings(raw.fx || raw.meta?.fx || {});

  return {
    meta: {
      id: String(meta?.id || ''),
      title: String(meta?.title || ''),
      owner: String(meta?.owner || ''),
      createdAt: meta?.createdAt ? String(meta.createdAt) : '',
      updatedAt: meta?.updatedAt ? String(meta.updatedAt) : '',
    },
    transport: {
      bpm: Number(transport?.bpm) || 120,
      timeSignature: {
        numerator: Number(timeSignature?.numerator) || 4,
        denominator: Number(timeSignature?.denominator) || 4,
      },
      playhead: Number(transport?.playhead) || 0,
      loopRange: {
        enabled: Boolean(loopRange?.enabled),
        start: Number(loopRange?.start) || 0,
        end: Number(loopRange?.end) || 0,
      },
      grid: String(transport?.grid || '1/16'),
    },
    tracks: (raw.tracks || []).map(cloneTrack),
    assets: (raw.assets || []).map(cloneAsset),
    clips: (raw.clips || []).map(cloneClip),
    markers: (raw.markers || []).map((m) => ({
      id: String(m?.id || ''),
      time: Number(m?.time) || 0,
      label: m?.label ? String(m.label) : '',
    })),
    regions: (raw.regions || []).map((r) => ({
      id: String(r?.id || ''),
      start: Number(r?.start) || 0,
      end: Number(r?.end) || 0,
      label: r?.label ? String(r.label) : '',
    })),
    fx,
    fork: {
      parentProjectId: fork?.parentProjectId ?? null,
      rootProjectId: fork?.rootProjectId ?? null,
      forkFromVersionId: fork?.forkFromVersionId ?? null,
      versionId: fork?.versionId ?? null,
    },
  };
};

const takeSnapshot = () => {
  const snap = sanitizeProject(project.value);
  // Keep playhead out of undo/redo for a DAW-like feel.
  const playhead = Number(project.value.transport?.playhead) || 0;
  if (snap?.transport) snap.transport.playhead = 0;

  return {
    project: snap,
    playhead,
    selectedClipIds: selectedClipIds.value.map(String),
    selectedTrackId: selectedTrackId.value == null ? null : String(selectedTrackId.value),
  };
};

const pushHistory = () => {
  if (isRestoring.value) return;
  try {
    undoStack.value.push(takeSnapshot());
  } catch (e) {
    console.warn('[history] snapshot failed; skip undo point', e);
    return;
  }
  if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift();
  redoStack.value = [];
};

const restoreSnapshot = (snap) => {
  if (!snap?.project) return;
  isRestoring.value = true;

  const keepPlayhead = Number(project.value.transport?.playhead) || 0;
  project.value = snap.project;
  if (project.value?.transport) project.value.transport.playhead = keepPlayhead;

  selectedTrackId.value = snap.selectedTrackId;
  selectedClipIds.value = Array.isArray(snap.selectedClipIds) ? snap.selectedClipIds.map(String) : [];

  const existing = new Set((project.value.clips || []).map((c) => String(c?.id)));
  selectedClipIds.value = selectedClipIds.value.filter((id) => existing.has(String(id)));

  // Stop playback; reschedule on user action.
  audioEngine.value?.pause?.();
  midiEngine.value?.pause?.();
  isPlaying.value = false;
  notifyPlaybackStop(PLAYBACK_SOURCE_ID);
  audioEngine.value?.applyTrackMix?.(project.value);
  audioEngine.value?.applyClipMix?.(project.value);

  isRestoring.value = false;
};

const undo = () => {
  if (!undoStack.value.length) return;
  const current = takeSnapshot();
  redoStack.value.push(current);
  const prev = undoStack.value.pop();
  restoreSnapshot(prev);
};

const redo = () => {
  if (!redoStack.value.length) return;
  const current = takeSnapshot();
  undoStack.value.push(current);
  const next = redoStack.value.pop();
  restoreSnapshot(next);
};

const updateAsset = (id, patch, options) => {
  const asset = project.value.assets.find((a) => String(a?.id) === String(id));
  if (!asset) return;

  const rawPatch = patch || {};
  const next = { ...rawPatch };
  if (rawPatch.data && typeof rawPatch.data === 'object') {
    next.data = { ...(asset.data && typeof asset.data === 'object' ? asset.data : {}), ...rawPatch.data };
  }

  const changed = Object.keys(next).some((k) => asset[k] !== next[k]);
  if (!changed) return;

  const commit = options?.commit !== false;
  if (commit) pushHistory();

  Object.assign(asset, next);
  touch();
};

const primaryClipId = computed(() => (selectedClipIds.value?.length ? String(selectedClipIds.value[0]) : null));

const selectedClip = computed(() => {
  const id = primaryClipId.value;
  if (!id) return null;
  return project.value.clips.find((c) => String(c?.id) === id) || null;
});

const selectedAsset = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return null;
  return project.value.assets.find((a) => String(a?.id) === String(clip.assetId)) || null;
});

const selectedTrack = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return null;
  return project.value.tracks.find((t) => String(t?.id) === String(clip.trackId)) || null;
});

const selectTrack = (trackId) => {
  selectedTrackId.value = trackId == null ? null : String(trackId);
};

const selectClip = (payload) => {
  if (payload == null) {
    selectedClipIds.value = [];
    return;
  }

  const data = typeof payload === 'object' ? payload : { id: payload };
  const id = data?.id == null ? null : String(data.id);
  if (!id) return;

  const additive = Boolean(data.additive);
  const toggle = Boolean(data.toggle);

  const existing = selectedClipIds.value.map(String);
  const set = new Set(existing);

  if (toggle) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
  } else if (additive) {
    set.add(id);
  } else {
    set.clear();
    set.add(id);
  }

  const next = Array.from(set);
  // Keep primary selection as the most recently interacted clip.
  selectedClipIds.value = [id, ...next.filter((x) => x !== id)];

  const clip = project.value.clips.find((c) => String(c?.id) === id);
  if (clip?.trackId != null) selectedTrackId.value = String(clip.trackId);
};

const setSelection = (ids) => {
  const list = Array.isArray(ids) ? ids.map(String) : [];
  selectedClipIds.value = list;
  const primary = list[0];
  if (primary) {
    const clip = project.value.clips.find((c) => String(c?.id) === String(primary));
    if (clip?.trackId != null) selectedTrackId.value = String(clip.trackId);
  }
};

const togglePlay = () => {
  const engine = audioEngine.value;
  if (!engine) {
    isPlaying.value = !isPlaying.value;
    return;
  }

  if (engine.isPlaying) {
    const t = engine.pause();
    midiEngine.value?.pause?.();
    project.value.transport.playhead = t;
    isPlaying.value = false;
    notifyPlaybackStop(PLAYBACK_SOURCE_ID);
    return;
  }

  isPlaying.value = true;
  requestPlaybackStart(PLAYBACK_SOURCE_ID);
  engine
    .play(project.value, project.value.transport.playhead)
    .catch((e) => {
      console.error(e);
      midiEngine.value?.pause?.();
      isPlaying.value = false;
      notifyPlaybackStop(PLAYBACK_SOURCE_ID);
      alert('无法播放：请先导入本地音频或确保素材 URL 可访问');
    });

  midiEngine.value?.play?.(project.value, project.value.transport.playhead);
};

const updateBpm = (bpm) => {
  const next = Math.max(20, Math.min(300, Number(bpm) || 120));
  if (Number(project.value.transport?.bpm) === next) return;
  pushHistory();
  project.value.transport.bpm = next;
  touch();
};

const updateGrid = (grid) => {
  const next = String(grid || '1/16');
  if (String(project.value.transport?.grid || '') === next) return;
  pushHistory();
  project.value.transport.grid = next;
  touch();
};

const updateTimeSignature = (ts) => {
  const n = Math.max(1, Math.min(32, Math.round(Number(ts?.numerator) || 4)));
  const d = Math.round(Number(ts?.denominator) || 4);
  const allowed = new Set([1, 2, 4, 8, 16, 32]);
  const next = { numerator: n, denominator: allowed.has(d) ? d : 4 };
  const cur = project.value.transport?.timeSignature || {};
  if (Number(cur?.numerator) === next.numerator && Number(cur?.denominator) === next.denominator) return;
  pushHistory();
  project.value.transport.timeSignature = next;
  touch();
};

const updateLoopRange = (range) => {
  const enabled = Boolean(range?.enabled);
  const start = Math.max(0, Number(range?.start) || 0);
  const end = Math.max(0, Number(range?.end) || 0);
  const cur = project.value.transport?.loopRange || {};
  if (Boolean(cur?.enabled) === enabled && Number(cur?.start) === start && Number(cur?.end) === end) return;
  pushHistory();
  project.value.transport.loopRange = { enabled, start, end };
  touch();
};

const addMarker = () => {
  pushHistory();
  const t = Math.max(0, Number(project.value.transport?.playhead) || 0);
  const list = Array.isArray(project.value.markers) ? project.value.markers : [];
  const marker = { id: createId('marker'), time: t, label: `M${list.length + 1}` };
  project.value.markers = [...list, marker];
  touch();
};

const addRegion = () => {
  isRegionDrawing.value = true;
  showSaveToast('拖拽鼠标创建区域');
};

const createRegionFromRange = (range) => {
  const start = Math.max(0, Number(range?.start) || 0);
  const end = Math.max(0, Number(range?.end) || 0);
  if (!(end > start + 0.01)) return;
  pushHistory();
  const list = Array.isArray(project.value.regions) ? project.value.regions : [];
  const region = { id: createId('region'), start, end, label: `R${list.length + 1}` };
  project.value.regions = [...list, region];
  touch();
};

const updateRegion = (regionId, patch, options = {}) => {
  const list = Array.isArray(project.value.regions) ? project.value.regions : [];
  const idx = list.findIndex((r) => String(r?.id) === String(regionId));
  if (idx === -1) return;
  const commit = options?.commit !== false;
  if (commit) pushHistory();

  const cur = list[idx] || {};
  const next = { ...cur };
  if (patch?.start != null) next.start = Math.max(0, Number(patch.start) || 0);
  if (patch?.end != null) next.end = Math.max(0, Number(patch.end) || 0);
  if (next.end <= next.start + 0.01) next.end = next.start + 0.1;
  if (patch?.label != null) next.label = String(patch.label || '');

  list[idx] = next;
  project.value.regions = [...list];
  touch();
};

const deleteRegion = (regionId) => {
  const list = Array.isArray(project.value.regions) ? project.value.regions : [];
  const next = list.filter((r) => String(r?.id) !== String(regionId));
  if (next.length === list.length) return;
  pushHistory();
  project.value.regions = next;
  touch();
};

const seekPlayhead = (t) => {
  project.value.transport.playhead = t;
  audioEngine.value?.seek?.(t);
  if (audioEngine.value?.isPlaying) {
    midiEngine.value?.play?.(project.value, t);
  }
};

const previewPlayhead = (t) => {
  project.value.transport.playhead = t;
};

const updateZoom = (next) => {
  const v = Math.max(24, Math.min(480, Number(next) || 96));
  pxPerSecond.value = v;
};

const updateSnapEnabled = (v) => {
  snapEnabled.value = Boolean(v);
};

const updateAutoCrossfade = (v) => {
  autoCrossfade.value = Boolean(v);
};

const onScrubStart = () => {
  const engine = audioEngine.value;
  if (engine?.isPlaying) {
    const t = engine.pause();
    midiEngine.value?.pause?.();
    project.value.transport.playhead = t;
    isPlaying.value = false;
    wasPlayingBeforeScrub.value = true;
  } else {
    wasPlayingBeforeScrub.value = false;
  }
};

const commitPlayhead = (t) => {
  seekPlayhead(t);
  if (!wasPlayingBeforeScrub.value) return;

  const engine = audioEngine.value;
  if (!engine) return;
  wasPlayingBeforeScrub.value = false;

  isPlaying.value = true;
  engine.play(project.value, Number(t) || 0).catch((e) => {
    console.error(e);
    midiEngine.value?.pause?.();
    isPlaying.value = false;
  });

  midiEngine.value?.play?.(project.value, Number(t) || 0);
};

function clamp(value, min, max) {
  const v = Number(value);
  const lo = Number(min);
  const hi = Number(max);

  if (!Number.isFinite(v)) return Number.isFinite(lo) ? lo : 0;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return v;

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return Math.min(b, Math.max(a, v));
}

const MIN_CLIP_LEN = 0.1;

const applyAutoCrossfadeForTrack = (trackId) => {
  if (!autoCrossfade.value) return;
  const id = String(trackId || '');
  if (!id) return;

  const track = project.value.tracks.find((t) => String(t?.id) === id);
  if (!track || String(track.type) !== 'audio') return;

  const clips = project.value.clips
    .filter((c) => String(c?.trackId) === id)
    .map((c) => c);
  if (clips.length < 2) return;

  clips.sort((a, b) => (Number(a?.start) || 0) - (Number(b?.start) || 0));

  for (let i = 0; i < clips.length - 1; i += 1) {
    const a = clips[i];
    const b = clips[i + 1];
    const aStart = Math.max(0, Number(a?.start) || 0);
    const aLen = Math.max(MIN_CLIP_LEN, Number(a?.length) || MIN_CLIP_LEN);
    const bStart = Math.max(0, Number(b?.start) || 0);
    const bLen = Math.max(MIN_CLIP_LEN, Number(b?.length) || MIN_CLIP_LEN);
    const overlap = aStart + aLen - bStart;
    if (!(overlap > 0.01)) continue;

    const dur = clamp(overlap, 0.01, Math.min(2.5, aLen * 0.5, bLen * 0.5));
    a.fadeOut = dur;
    b.fadeIn = dur;

    if (!a.fadeOutCurve) a.fadeOutCurve = 'linear';
    if (!b.fadeInCurve) b.fadeInCurve = 'linear';
  }
};

const applyAutoCrossfadeAll = () => {
  if (!autoCrossfade.value) return;
  const ids = project.value.tracks.filter((t) => String(t?.type) === 'audio').map((t) => String(t.id));
  for (const id of ids) applyAutoCrossfadeForTrack(id);
};

const getSelectedClipsSorted = () => {
  const ids = new Set(selectedClipIds.value.map(String));
  const list = project.value.clips.filter((c) => ids.has(String(c?.id)));
  list.sort((a, b) => (Number(a?.start) || 0) - (Number(b?.start) || 0));
  return list;
};

const resolveTargetTrackIdForAsset = (preferredTrackId, assetId, commitHistory = false) => {
  const wanted = String(preferredTrackId || '');
  const existing = project.value.tracks.find((t) => String(t?.id) === wanted);
  if (existing) return String(existing.id);

  const asset = project.value.assets.find((a) => String(a?.id) === String(assetId));
  const kind = asset?.type === 'midi' ? 'midi' : 'audio';

  const preferred = project.value.tracks.find(
    (t) => String(t?.id) === String(selectedTrackId.value) && String(t?.type) === kind
  );
  if (preferred) return String(preferred.id);

  const first = project.value.tracks.find((t) => String(t?.type) === kind);
  if (first) return String(first.id);

  return addTrack(kind, { commit: commitHistory });
};

const copySelectedClips = () => {
  const clips = getSelectedClipsSorted();
  if (!clips.length) return;

  const starts = clips.map((c) => Math.max(0, Number(c?.start) || 0));
  const ends = clips.map((c) => Math.max(0, (Number(c?.start) || 0) + (Number(c?.length) || 0)));
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...ends);

  clipClipboard.value = {
    minStart,
    maxEnd,
    clips: clips.map((c) => cloneClip(toRaw(c))),
  };
};

const pasteClipboardAtPlayhead = () => {
  const data = clipClipboard.value;
  if (!data?.clips?.length) return;

  pushHistory();

  const baseT = Math.max(0, Number(project.value.transport?.playhead) || 0);
  const minStart = Math.max(0, Number(data.minStart) || 0);

  const newIds = [];
  const newClips = [];

  for (const src of data.clips) {
    const id = createId('clip');
    const srcStart = Math.max(0, Number(src?.start) || 0);
    const rel = srcStart - minStart;
    const assetId = src?.assetId;

    const trackId = resolveTargetTrackIdForAsset(src?.trackId, assetId, false);
    if (!trackId) continue;

    const clip = {
      ...cloneClip(src),
      id,
      trackId,
      start: Math.max(0, baseT + rel),
      length: Math.max(MIN_CLIP_LEN, Number(src?.length) || MIN_CLIP_LEN),
      offset: Math.max(0, Number(src?.offset) || 0),
    };

    newClips.push(clip);
    newIds.push(id);
  }

  if (!newClips.length) return;

  project.value.clips = [...project.value.clips, ...newClips];
  selectedClipIds.value = newIds;
  touch();
  applyAutoCrossfadeAll();
  audioEngine.value?.applyClipMix?.(project.value);
};

const duplicateSelectedClips = () => {
  const clips = getSelectedClipsSorted();
  if (!clips.length) return;

  pushHistory();

  const starts = clips.map((c) => Math.max(0, Number(c?.start) || 0));
  const ends = clips.map((c) => Math.max(0, (Number(c?.start) || 0) + (Number(c?.length) || 0)));
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...ends);
  const span = Math.max(0, maxEnd - minStart);

  const newIds = [];
  const newClips = [];

  for (const src of clips) {
    const id = createId('clip');
    const trackId = resolveTargetTrackIdForAsset(src?.trackId, src?.assetId, false);
    if (!trackId) continue;
    const start = Math.max(0, Number(src?.start) || 0) + span;

    newClips.push({ ...cloneClip(toRaw(src)), id, trackId, start });
    newIds.push(id);
  }

  if (!newClips.length) return;
  project.value.clips = [...project.value.clips, ...newClips];
  selectedClipIds.value = newIds;
  touch();
  applyAutoCrossfadeAll();
  audioEngine.value?.applyClipMix?.(project.value);
};

const splitSelectedClipsAtPlayhead = () => {
  const t = Math.max(0, Number(project.value.transport?.playhead) || 0);
  const clips = getSelectedClipsSorted();
  if (!clips.length) return;

  const toSplit = clips.filter((c) => {
    const s = Math.max(0, Number(c?.start) || 0);
    const len = Math.max(0, Number(c?.length) || 0);
    return t > s + MIN_CLIP_LEN && t < s + len - MIN_CLIP_LEN;
  });
  if (!toSplit.length) return;

  pushHistory();

  const newIds = [];
  for (const clip of toSplit) {
    const base = cloneClip(toRaw(clip));
    const start = Math.max(0, Number(base?.start) || 0);
    const len = Math.max(MIN_CLIP_LEN, Number(base?.length) || MIN_CLIP_LEN);
    const end = start + len;
    const rate = clamp(Number(base?.playbackRate) || 1, 0.25, 4);
    const cut = clamp(t, start + MIN_CLIP_LEN, end - MIN_CLIP_LEN);

    const leftLen = Math.max(MIN_CLIP_LEN, cut - start);
    const rightLen = Math.max(MIN_CLIP_LEN, end - cut);

    updateClip(base.id, { length: leftLen }, { commit: false });

    const asset = project.value.assets.find((a) => String(a?.id) === String(base.assetId));
    const assetDur = Math.max(0, Number(asset?.duration || 0));
    const rightOffset = Math.max(0, Number(base?.offset) || 0) + (cut - start) * Math.max(1e-6, rate);

    let finalRightLen = rightLen;
    if (assetDur > 0) {
      const maxLenByAsset = Math.max(
        MIN_CLIP_LEN,
        (assetDur - rightOffset) / Math.max(1e-6, rate)
      );
      finalRightLen = clamp(finalRightLen, MIN_CLIP_LEN, maxLenByAsset);
    }

    const id = createId('clip');
    const right = {
      ...base,
      id,
      start: cut,
      length: finalRightLen,
      offset: rightOffset,
    };
    project.value.clips = [...project.value.clips, right];
    newIds.push(id);
  }

  selectedClipIds.value = [...newIds, ...selectedClipIds.value.map(String)];
  touch();
  applyAutoCrossfadeAll();
  audioEngine.value?.applyClipMix?.(project.value);
};

const normalizeClip = (clipId) => {
  const id = String(clipId || '');
  if (!id) return;

  const clip = project.value.clips.find((c) => String(c?.id) === id);
  if (!clip) return;

  const asset = project.value.assets.find((a) => String(a?.id) === String(clip.assetId));
  const peaks = asset?.peaks;
  const hasPeaks =
    peaks &&
    peaks.kind === 'minmax' &&
    peaks.points &&
    peaks.min instanceof Float32Array &&
    peaks.max instanceof Float32Array;

  if (!hasPeaks) {
    alert('无法归一化：该素材缺少波形 peaks（请先导入音频或计算 peaks）');
    return;
  }

  let maxAmp = 0;
  for (let i = 0; i < peaks.points; i += 1) {
    const mn = Math.abs(peaks.min[i] || 0);
    const mx = Math.abs(peaks.max[i] || 0);
    if (mn > maxAmp) maxAmp = mn;
    if (mx > maxAmp) maxAmp = mx;
  }

  if (!(maxAmp > 1e-4)) return;

  const target = Math.pow(10, -1 / 20); // -1 dBFS peak
  const deltaDb = 20 * Math.log10(target / maxAmp);
  if (!Number.isFinite(deltaDb)) return;

  const nextGain = clamp((Number(clip.gain) || 0) + deltaDb, -60, 12);
  updateClip(id, { gain: nextGain }, { commit: true });
};

const addTrack = (type, options) => {
  const commit = options?.commit !== false;
  if (commit) pushHistory();
  const kind = type === 'midi' ? 'midi' : 'audio';
  const count = project.value.tracks.filter((t) => t.type === kind).length;
  const name = kind === 'midi' ? `MIDI ${count + 1}` : `Audio ${count + 1}`;

  const track = {
    id: createId(`track_${kind}`),
    name,
    type: kind,
    mute: false,
    solo: false,
    gain: 0,
    pan: 0,
    fxChain: [],
  };

  project.value.tracks = [...project.value.tracks, track];
  selectedTrackId.value = String(track.id);
  audioEngine.value?.applyTrackMix?.(project.value);
  touch();
  return track.id;
};

const updateTrack = (id, patch, options) => {
  const track = project.value.tracks.find((t) => String(t.id) === String(id));
  if (!track) return;
  const next = { ...(patch || {}) };
  const changed = Object.keys(next).some((k) => track[k] !== next[k]);
  if (!changed) return;

  const commit = options?.commit !== false;
  if (commit) pushHistory();

  Object.assign(track, next);
  audioEngine.value?.applyTrackMix?.(project.value);
  midiEngine.value?.applyTrackMix?.(project.value);
  touch();
};

const updateClip = (id, patch, options) => {
  const clip = project.value.clips.find((c) => String(c.id) === String(id));
  if (!clip) return;
  const prevTrackId = String(clip.trackId || '');
  const next = { ...(patch || {}) };
  if (next.trackId != null) {
    const target = project.value.tracks.find((t) => String(t?.id) === String(next.trackId));
    if (!target) {
      delete next.trackId;
    } else {
      const asset = project.value.assets.find((a) => String(a?.id) === String(clip.assetId));
      if (asset?.type && target?.type && String(asset.type) !== String(target.type)) {
        delete next.trackId;
      }
    }
  }

  if (next.start != null) next.start = Math.max(0, Number(next.start) || 0);
  if (next.length != null) next.length = Math.max(MIN_CLIP_LEN, Number(next.length) || MIN_CLIP_LEN);
  if (next.offset != null) next.offset = Math.max(0, Number(next.offset) || 0);
  if (next.gain != null) next.gain = clamp(Number(next.gain) || 0, -60, 12);
  if (next.pan != null) next.pan = clamp(Number(next.pan) || 0, -1, 1);
  if (next.playbackRate != null) next.playbackRate = clamp(Number(next.playbackRate) || 1, 0.25, 4);
  if (next.fadeIn != null) next.fadeIn = Math.max(0, Number(next.fadeIn) || 0);
  if (next.fadeOut != null) next.fadeOut = Math.max(0, Number(next.fadeOut) || 0);
  if (next.fadeInCurve != null) next.fadeInCurve = String(next.fadeInCurve || 'linear');
  if (next.fadeOutCurve != null) next.fadeOutCurve = String(next.fadeOutCurve || 'linear');

  const futureLen =
    next.length != null ? next.length : Math.max(MIN_CLIP_LEN, Number(clip?.length) || MIN_CLIP_LEN);
  if (next.fadeIn != null) next.fadeIn = clamp(next.fadeIn, 0, futureLen * 0.5);
  if (next.fadeOut != null) next.fadeOut = clamp(next.fadeOut, 0, futureLen * 0.5);

  const changed = Object.keys(next).some((k) => clip[k] !== next[k]);
  if (!changed) return;

  const commit = options?.commit !== false;
  if (commit) pushHistory();

  Object.assign(clip, next);
  const affectsTimeline = next.start != null || next.length != null || next.trackId != null;
  const nextTrackId = String(clip.trackId || '');
  if (affectsTimeline && autoCrossfade.value) {
    if (prevTrackId && prevTrackId !== nextTrackId) applyAutoCrossfadeForTrack(prevTrackId);
    applyAutoCrossfadeForTrack(nextTrackId);
  }
  if (primaryClipId.value === String(id) && next.trackId != null) selectedTrackId.value = String(clip.trackId);
  audioEngine.value?.applyTrackMix?.(project.value);
  audioEngine.value?.applyClipMix?.(project.value);

  // MIDI doesn't have an "applyClipMix"; reschedule from current playhead when playing.
  if (audioEngine.value?.isPlaying) {
    const asset = project.value.assets.find((a) => String(a?.id) === String(clip.assetId));
    if (asset?.type === 'midi') {
      midiEngine.value?.play?.(project.value, Number(project.value.transport?.playhead) || 0);
    }
  }
  touch();
};

const deleteClip = (clipId, options) => {
  const id = String(clipId || '');
  if (!id) return;

  const clip = project.value.clips.find((c) => String(c?.id) === id);
  if (!clip) return;
  const trackId = String(clip.trackId || '');

  const commit = options?.commit !== false;
  if (commit) pushHistory();

  project.value.clips = project.value.clips.filter((c) => String(c?.id) !== id);
  selectedClipIds.value = selectedClipIds.value.filter((x) => String(x) !== id);
  audioEngine.value?.stopClip?.(id);
  applyAutoCrossfadeForTrack(trackId);
  touch();
};

const getAudioContext = () => getSharedAudioContext();

const isAllowedAudioFile = (file) => {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  if (type.includes('audio/wav') || type.includes('audio/x-wav')) return true;
  if (type.includes('audio/mpeg') || type.includes('audio/mp3')) return true;
  if (name.endsWith('.wav') || name.endsWith('.mp3')) return true;
  return false;
};

const createId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;

const localAudioFilesByAssetId = new Map();

const getCachedAudioFile = async (assetId, hashKey) => {
  const id = String(assetId || '').trim();
  const hash = String(hashKey || '').trim();
  if (!id && !hash) return null;
  const existing = localAudioFilesByAssetId.get(id) || null;
  if (existing) return existing;
  try {
    let cached = id ? await loadAudioFile(id) : null;
    if (!cached?.blob && hash) {
      cached = await loadAudioFile(`hash:${hash}`);
    }
    if (!cached?.blob) return null;
    const file = new File([cached.blob], cached.name || 'audio', {
      type: cached.type || 'audio/wav',
      lastModified: Number(cached.lastModified || Date.now()),
    });
    localAudioFilesByAssetId.set(id, file);
    return file;
  } catch {
    return null;
  }
};

const importAudio = async (file) => {
  if (!file) return;
  if (!isAllowedAudioFile(file)) {
    alert('仅支持导入 wav / mp3');
    return;
  }
  if (isImportingAudio.value) return;

  isImportingAudio.value = true;

  try {
    pushHistory();

    const engine = audioEngine.value;
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = engine
      ? await engine.decodeAudioData(arrayBuffer)
      : await getAudioContext().decodeAudioData(arrayBuffer.slice(0));

    const url = URL.createObjectURL(file);
    const assetId = createId('asset_audio');
    const clipId = createId('clip_audio');
    localAudioFilesByAssetId.set(assetId, file);
    const hashKey = `local:${file.name}:${file.size}:${file.lastModified}`;
    saveAudioFile(assetId, file).catch(async () => {
      const estimate = await getStorageEstimate();
      if (estimate?.quota) {
        const usedMb = Math.round((estimate.usage || 0) / 1024 / 1024);
        const quotaMb = Math.round(estimate.quota / 1024 / 1024);
        showSaveToast(`音频缓存失败：存储空间不足（${usedMb}MB/${quotaMb}MB）`, 'error');
      } else {
        showSaveToast('音频缓存失败：浏览器未允许持久化存储', 'error');
      }
    });
    saveAudioFile(`hash:${hashKey}`, file).catch(() => {});
    missingAudioAssets.value = missingAudioAssets.value.filter((m) => String(m?.id || '') !== String(assetId));

    const asset = {
      id: assetId,
      type: 'audio',
      url,
      duration: Number(audioBuffer.duration || 0),
      sampleRate: Number(audioBuffer.sampleRate || 0),
      channels: Number(audioBuffer.numberOfChannels || 1),
      hash: hashKey,
      _file: file,
      audioBuffer,
      peaks: {
        kind: 'pending',
      },
    };
    engine?.loadAsset?.({ ...asset, audioBuffer }).catch(() => {});

    const preferred = project.value.tracks.find((t) => String(t?.id) === String(selectedTrackId.value));
    let targetTrackId = preferred?.type === 'audio' ? preferred.id : null;
    if (!targetTrackId) {
      const firstAudio = project.value.tracks.find((t) => t.type === 'audio');
      targetTrackId = firstAudio?.id || null;
    }
    if (!targetTrackId) targetTrackId = addTrack('audio', { commit: false });
    if (!targetTrackId) return;

    const clip = {
      id: clipId,
      trackId: targetTrackId,
      assetId,
      start: 0,
      length: asset.duration,
      offset: 0,
      gain: 0,
      pan: 0,
      playbackRate: 1,
      fadeIn: 0.02,
      fadeOut: 0.08,
      fadeInCurve: 'linear',
      fadeOutCurve: 'linear',
    };

    project.value.assets = [asset, ...project.value.assets];
    project.value.clips = [...project.value.clips, clip];
    touch();
    selectClip(clipId);
    applyAutoCrossfadeForTrack(String(targetTrackId));

    const peaks = await computePeaks(audioBuffer, { maxPoints: 4096, minPoints: 1024 });
    asset.peaks = peaks;
    touch();
  } catch (e) {
    console.error(e);
    alert('导入失败：无法解析音频');
  } finally {
    isImportingAudio.value = false;
  }
};

const rehydrateLocalAudioAssets = async () => {
  const assets = Array.isArray(project.value?.assets) ? project.value.assets : [];
  const engine = audioEngine.value;
  const missing = [];
  for (const asset of assets) {
    if (String(asset?.type || '') !== 'audio') continue;
    const id = String(asset?.id || '');
    if (!id) continue;
    const file = await getCachedAudioFile(id, asset?.hash);
    if (!file) {
      const url = String(asset?.url || '');
      const hash = String(asset?.hash || '');
      if (url.startsWith('blob:') || hash.startsWith('local:')) {
        missing.push({
          id,
          name: hash.startsWith('local:') ? hash.split(':')[1] : '',
        });
      }
      continue;
    }
    if (!localAudioFilesByAssetId.get(id)) localAudioFilesByAssetId.set(id, file);
    if (asset?.hash && !String(asset.hash).startsWith('hash:')) {
      saveAudioFile(id, file).catch(() => {});
    }
    asset._file = file;
    if (!asset.url || String(asset.url).startsWith('blob:')) {
      try {
        asset.url = URL.createObjectURL(file);
      } catch {
        // ignore
      }
    }
    if (!asset.audioBuffer) {
      try {
        const buffer = engine
          ? await engine.decodeAudioData(await file.arrayBuffer())
          : await getAudioContext().decodeAudioData((await file.arrayBuffer()).slice(0));
        asset.audioBuffer = buffer;
        engine?.loadAsset?.({ ...asset, audioBuffer: buffer, _file: file }).catch(() => {});
      } catch {
        // ignore
      }
    }
  }
  missingAudioAssets.value = missing;
};

const parseTags = (text) =>
  String(text || '')
    .split(/[,，\n\r\t]+/g)
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 10);

const estimateDurationSec = () => {
  const clips = Array.isArray(project.value?.clips) ? project.value.clips : [];
  const end = Math.max(
    0,
    ...clips.map((c) => Math.max(0, Number(c?.start) || 0) + Math.max(0, Number(c?.length) || 0))
  );
  return Math.max(0, end);
};

const openPublish = () => {
  if (!hasToken()) {
    alert('请先登录后再发布作品');
    router.push('/login');
    return;
  }

  publishTitle.value = String(project.value?.meta?.title || '').trim() || 'Untitled';
  publishCover.value = String(publishCover.value || '').trim();
  publishTagsText.value = String(publishTagsText.value || '').trim();

  let audio = null;
  for (const a of project.value.assets || []) {
    if (String(a?.type || '') !== 'audio') continue;
    const f = localAudioFilesByAssetId.get(String(a.id));
    if (f) {
      audio = f;
      break;
    }
  }
  publishAudioFile.value = audio;
  publishOpen.value = true;
};

const openExport = () => {
  exportOpen.value = true;
};

const onPickPublishAudio = (e) => {
  const f = e?.target?.files?.[0] || null;
  publishAudioFile.value = f;
  if (e?.target) e.target.value = '';
};

const uploadLocalAudioAssets = async () => {
  const assets = Array.isArray(project.value?.assets) ? project.value.assets : [];
  for (const a of assets) {
    if (String(a?.type || '') !== 'audio') continue;
    const id = String(a?.id || '');
    if (!id) continue;
    const file = localAudioFilesByAssetId.get(id) || null;
    if (!file) continue;

    const uploaded = await apiUploadAudioFile(file);
    const url = String(uploaded?.url || '').trim();
    if (!url) continue;

    // Patch runtime asset in-place so later autosaves keep remote URLs.
    a.url = url;
    a.hash = `upload:${String(uploaded?.filename || file.name || '')}:${Number(uploaded?.size || file.size || 0)}`;
  }
};

const generatePreviewIfNeeded = async () => {
  if (publishAudioFile.value) return;
  isRenderingPreview.value = true;
  try {
    const file = await renderProjectToWavFile(project.value, {
      filename: 'preview.wav',
      sampleRate: 44100,
      filesByAssetId: localAudioFilesByAssetId,
      maxDurationSec: 600,
      fxQuality: project.value?.fx?.quality || 'low',
    });
    publishAudioFile.value = file;
  } finally {
    isRenderingPreview.value = false;
  }
};

const generatePreviewNow = async () => {
  if (isRenderingPreview.value) return;
  isRenderingPreview.value = true;
  try {
    const file = await renderProjectToWavFile(project.value, {
      filename: 'preview.wav',
      sampleRate: 44100,
      filesByAssetId: localAudioFilesByAssetId,
      maxDurationSec: 600,
      fxQuality: project.value?.fx?.quality || 'low',
    });
    publishAudioFile.value = file;
  } catch (e) {
    alert(e?.message || '生成试听失败');
  } finally {
    isRenderingPreview.value = false;
  }
};

const publishNow = async () => {
  if (!hasToken()) return;
  const title = String(publishTitle.value || '').trim();
  if (!title) {
    alert('标题不能为空');
    return;
  }

  isPublishing.value = true;
  try {
    project.value.meta.title = title;
    touch();

    await uploadLocalAudioAssets();
    await generatePreviewIfNeeded();

    const payload = serializeProjectForStorage(project.value);
    const durationSec = estimateDurationSec();
    const cover = String(publishCover.value || '').trim();
    const tags = parseTags(publishTagsText.value);
    const audioFile = publishAudioFile.value || null;

    const routeId = String(projectId.value || '').trim();
    const docId = isMongoObjectId(routeId) ? routeId : resolvedProjectDocId.value || '';

    const published = await apiPublishProject({
      projectId: docId,
      title,
      cover,
      tags,
      durationSec,
      audioFile,
      project: payload,
    });

    showSaveToast('发布成功');
    publishOpen.value = false;

    const newId = String(published?.id || published?._id || '').trim();
    if (newId) {
      router.push({ name: 'ProjectDetail', params: { id: newId } }).catch(() => {});
    }
  } catch (e) {
    alert(e?.message || '发布失败');
  } finally {
    isPublishing.value = false;
  }
};

onMounted(() => {
  const engine = new AudioEngine({
    context: getSharedAudioContext(),
    fileProvider: (assetId) => {
      const id = String(assetId || '').trim();
      const asset = project.value?.assets?.find((a) => String(a?.id || '') === id) || null;
      return getCachedAudioFile(id, asset?.hash);
    },
    onTick: (t) => {
      // Avoid touching meta on every animation frame.
      project.value.transport.playhead = t;
      if (!engine.isPlaying && isPlaying.value) {
        isPlaying.value = false;
        notifyPlaybackStop(PLAYBACK_SOURCE_ID);
      }
    },
  });
  audioEngine.value = engine;
  midiEngine.value = new MidiEngine({ context: engine.context, outputNode: engine.masterInput });
  audioEngine.value?.applyTrackMix?.(project.value);
  audioEngine.value?.applyClipMix?.(project.value);
  midiEngine.value?.applyTrackMix?.(project.value);
  try {
    unregisterPlayback = registerPlaybackSource(PLAYBACK_SOURCE_ID, {
      stop: () => {
        const t = audioEngine.value?.pause?.();
        midiEngine.value?.pause?.();
        if (typeof t === 'number') project.value.transport.playhead = t;
        isPlaying.value = false;
        notifyPlaybackStop(PLAYBACK_SOURCE_ID);
      },
    });
  } catch {
    unregisterPlayback = null;
  }

  const onKeyDown = async (e) => {
    const tag = String(e?.target?.tagName || '').toLowerCase();
    const code = String(e?.code || '');
    const key = String(e?.key || '');
    const lower = key.toLowerCase();

    // Allow DAW shortcuts even if a range slider is focused.
    if (tag === 'textarea' || e?.target?.isContentEditable) return;
    if (tag === 'input') {
      const inputType = String(e?.target?.type || '').toLowerCase();
      const isTextLike = inputType === 'text' || inputType === 'search' || inputType === 'number' || inputType === 'email' || inputType === 'password';
      if (isTextLike) return;
    }
    const mod = Boolean(e.metaKey || e.ctrlKey);

    if (mod && !e.shiftKey && lower === 'z') {
      e.preventDefault();
      undo();
      return;
    }

    if (mod && (lower === 'y' || (e.shiftKey && lower === 'z'))) {
      e.preventDefault();
      redo();
      return;
    }

    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      const ids = selectedClipIds.value.map(String);
      if (!ids.length) return;
      pushHistory();
      for (const id of ids) deleteClip(id, { commit: false });
      return;
    }

    if (mod && lower === 'c') {
      e.preventDefault();
      copySelectedClips();
      return;
    }

    if (mod && lower === 'v') {
      e.preventDefault();
      if (clipClipboard.value?.clips?.length) {
        pasteClipboardAtPlayhead();
      } else {
        await pasteFromSystemClipboardAtPlayhead();
      }
      return;
    }

    if (mod && lower === 'd') {
      e.preventDefault();
      duplicateSelectedClips();
      return;
    }

    if (!mod && !e.altKey && (lower === 's' || code === 'KeyS')) {
      e.preventDefault();
      splitSelectedClipsAtPlayhead();
      return;
    }
  };
  window.addEventListener('keydown', onKeyDown);
  engine.__onKeyDown = onKeyDown;
});

onBeforeUnmount(() => {
  const handler = audioEngine.value?.__onKeyDown;
  if (handler) window.removeEventListener('keydown', handler);
  if (clipboardToastTimer) window.clearTimeout(clipboardToastTimer);
  if (saveToastTimer) window.clearTimeout(saveToastTimer);
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  unregisterPlayback?.();
  unregisterPlayback = null;
  midiEngine.value?.destroy?.();
  midiEngine.value = null;
  audioEngine.value?.destroy?.();
  audioEngine.value = null;
});
</script>

<template>
  <div class="h-screen flex flex-col overflow-hidden studio-shell">
    <div
      v-if="saveToast"
      class="fixed top-20 sm:top-24 right-3 sm:right-6 z-[120] glass-card px-4 py-2 rounded-xl border border-white/70 text-sm font-semibold text-slate-800 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <i v-if="saveToastTone === 'ok'" class="ph-bold ph-check-circle text-emerald-600"></i>
        <i v-else class="ph-bold ph-warning-circle text-rose-600"></i>
        {{ saveToast }}
      </div>
    </div>

    <div
      v-if="clipboardToast"
      class="fixed top-20 sm:top-24 right-3 sm:right-6 z-[120] glass-card px-4 py-2 rounded-xl border border-white/70 text-sm font-semibold text-slate-800 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <i v-if="clipboardToastTone === 'ok'" class="ph-bold ph-check-circle text-emerald-600"></i>
        <i v-else class="ph-bold ph-warning-circle text-rose-600"></i>
        {{ clipboardToast }}
      </div>
    </div>

    <div
      v-if="missingAudioAssets.length"
      class="fixed top-20 sm:top-24 left-3 sm:left-6 z-[120] glass-card px-4 py-3 rounded-xl border border-amber-200/70 bg-amber-50/80 text-sm text-amber-800 shadow-lg max-w-[360px]"
    >
      <div class="flex items-start gap-2">
        <i class="ph-bold ph-warning-circle text-amber-500 mt-0.5"></i>
        <div class="space-y-1">
          <div class="font-semibold">检测到本地音频缺失</div>
          <div class="text-xs text-amber-700">
            这些音频是本地导入的，重启后需要重新导入同名文件：
            <span v-for="(item, idx) in missingAudioAssets" :key="item.id">
              {{ item.name || item.id }}<span v-if="idx < missingAudioAssets.length - 1">、</span>
            </span>
          </div>
          <div class="flex justify-end">
            <UiButton
              variant="ghost"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold"
              @click="missingAudioAssets = []"
            >
              知道了
            </UiButton>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="isLoadingProject"
      class="fixed inset-0 z-[110] flex items-center justify-center bg-white/40 backdrop-blur-sm"
    >
      <div class="glass-card px-6 py-4 rounded-2xl border border-white/70 shadow-xl text-slate-800">
        <div class="flex items-center gap-3 text-sm font-semibold">
          <i class="ph-bold ph-spinner animate-spin"></i>
          正在加载工程...
        </div>
      </div>
    </div>

    <div v-if="publishOpen" class="fixed inset-0 z-[130] flex items-center justify-center px-4">
      <div class="absolute inset-0 bg-slate-900/35 backdrop-blur-sm" @click="publishOpen = false"></div>
      <div class="glass-card w-full max-w-lg rounded-2xl border border-white/70 shadow-2xl relative z-10 overflow-hidden">
        <div class="p-4 border-b border-slate-200/70 bg-white/30 flex items-center justify-between">
          <div class="text-lg font-extrabold text-slate-900">发布作品</div>
          <UiButton variant="ghost" class="px-2 py-2 rounded-lg" @click="publishOpen = false">
            <i class="ph-bold ph-x"></i>
          </UiButton>
        </div>

        <div class="p-5 space-y-4">
          <div>
            <div class="text-xs text-slate-500 font-semibold mb-1">标题</div>
            <input v-model="publishTitle" class="w-full input-glass rounded-lg px-3 py-2 text-sm" placeholder="作品标题" />
          </div>

          <div>
            <div class="text-xs text-slate-500 font-semibold mb-1">封面（可选：颜色渐变或图片 URL）</div>
            <input v-model="publishCover" class="w-full input-glass rounded-lg px-3 py-2 text-sm" placeholder="例如 linear-gradient(...) 或 https://..." />
          </div>

          <div>
            <div class="text-xs text-slate-500 font-semibold mb-1">标签（可选，逗号分隔，最多 10 个）</div>
            <input v-model="publishTagsText" class="w-full input-glass rounded-lg px-3 py-2 text-sm" placeholder="Pop, Electronic, Chill" />
          </div>

          <div>
            <div class="text-xs text-slate-500 font-semibold mb-1">试听音频（建议上传 wav/mp3）</div>
            <input type="file" accept="audio/wav,audio/x-wav,audio/mpeg,.wav,.mp3" class="w-full text-sm" @change="onPickPublishAudio" />
            <div class="mt-2 flex items-center justify-between gap-3">
              <div class="text-[11px] text-slate-500 font-semibold">
                {{ publishAudioFile ? `已选择：${publishAudioFile.name}` : '未生成试听：发布时会自动生成一个 wav' }}
              </div>
              <UiButton
                variant="secondary"
                class="px-3 py-2 rounded-lg text-xs font-semibold"
                :disabled="isRenderingPreview || isPublishing"
                @click="generatePreviewNow"
              >
                <i v-if="isRenderingPreview" class="ph-bold ph-spinner animate-spin"></i>
                {{ isRenderingPreview ? '生成中...' : '生成试听' }}
              </UiButton>
            </div>
          </div>
        </div>

        <div class="p-4 border-t border-slate-200/70 bg-white/30 flex justify-end gap-2">
          <UiButton variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold" :disabled="isPublishing" @click="publishOpen = false">取消</UiButton>
          <UiButton variant="primary" class="px-5 py-2 rounded-lg text-sm font-semibold text-white" :disabled="isPublishing" @click="publishNow">
            <i v-if="isPublishing" class="ph-bold ph-spinner animate-spin"></i>
            {{ isPublishing ? '发布中...' : '发布' }}
          </UiButton>
        </div>
      </div>
    </div>

    <div v-if="exportOpen" class="fixed inset-0 z-[130] flex items-center justify-center px-4">
      <div class="absolute inset-0 bg-slate-900/35 backdrop-blur-sm" @click="exportOpen = false"></div>
      <div class="glass-card w-full max-w-lg rounded-2xl border border-white/70 shadow-2xl relative z-10 overflow-hidden">
        <div class="p-4 border-b border-slate-200/70 bg-white/30 flex items-center justify-between">
          <div class="text-lg font-extrabold text-slate-900">导出</div>
          <UiButton variant="ghost" class="px-2 py-2 rounded-lg" @click="exportOpen = false">
            <i class="ph-bold ph-x"></i>
          </UiButton>
        </div>

        <div class="p-5 space-y-3">
          <div class="text-sm text-slate-600">
            支持导出工程 JSON、离线混音导出 WAV；MP3 需要服务端 ffmpeg 转码。
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <UiButton
              variant="secondary"
              class="px-4 py-3 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2"
              @click="exportProjectJson"
            >
              <i class="ph-bold ph-file-code"></i>
              JSON
            </UiButton>

            <UiButton
              variant="secondary"
              class="px-4 py-3 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2"
              :disabled="isExportingWav"
              @click="exportMixdownWav"
            >
              <i v-if="isExportingWav" class="ph-bold ph-spinner animate-spin"></i>
              <i v-else class="ph-bold ph-waveform"></i>
              WAV
            </UiButton>

            <UiButton
              variant="secondary"
              class="px-4 py-3 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2"
              :disabled="isExportingMp3"
              @click="exportMixdownMp3"
            >
              <i v-if="isExportingMp3" class="ph-bold ph-spinner animate-spin"></i>
              <i v-else class="ph-bold ph-music-notes"></i>
              MP3
            </UiButton>
          </div>
        </div>

        <div class="p-4 border-t border-slate-200/70 bg-white/30 flex justify-end gap-2">
          <UiButton variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold" @click="exportOpen = false">关闭</UiButton>
        </div>
      </div>
    </div>

    <div v-if="fxOpen" class="fixed inset-0 z-[130] flex items-center justify-center px-4">
      <div class="absolute inset-0 bg-slate-900/35 backdrop-blur-sm" @click="fxOpen = false"></div>
      <div class="glass-card w-full max-w-3xl rounded-2xl border border-white/70 shadow-2xl relative z-10 overflow-hidden">
        <div class="p-4 border-b border-slate-200/70 bg-white/30 flex items-center justify-between">
          <div class="text-lg font-extrabold text-slate-900">混音 / 母带 FX</div>
          <UiButton variant="ghost" class="px-2 py-2 rounded-lg" @click="fxOpen = false">
            <i class="ph-bold ph-x"></i>
          </UiButton>
        </div>

        <div v-if="project.fx" class="p-5 space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-slate-900">启用 FX</div>
              <div class="text-xs text-slate-500 mt-1">关闭时不会构建节点，降低 CPU 占用</div>
            </div>
            <label class="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" v-model="project.fx.enabled" @change="commitFxSettings" />
              {{ project.fx.enabled ? '已开启' : '已关闭' }}
            </label>
          </div>

          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-white/70 bg-white/45 p-4">
            <div>
              <div class="text-sm font-semibold text-slate-900">质量档位</div>
              <div class="text-xs text-slate-500 mt-1">导出时将自动使用高质量</div>
            </div>
            <select
              v-model="project.fx.quality"
              class="input-glass rounded-lg px-3 py-2 text-sm"
              :disabled="!project.fx.enabled"
              @change="commitFxSettings"
            >
              <option value="low">低（预听）</option>
              <option value="mid">中</option>
              <option value="high">高</option>
            </select>
          </div>

          <div class="grid md:grid-cols-2 gap-4">
            <div class="rounded-xl border border-white/70 bg-white/45 p-4 space-y-3">
              <div class="flex items-center justify-between">
                <div class="text-sm font-semibold text-slate-900">EQ</div>
                <label class="text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    v-model="project.fx.master.eq.enabled"
                    :disabled="!project.fx.enabled"
                    @change="commitFxSettings"
                  />
                  启用
                </label>
              </div>
              <div class="space-y-2">
                <div class="text-xs text-slate-500">低频 {{ project.fx.master.eq.low.toFixed(1) }} dB</div>
                <input
                  type="range"
                  min="-18"
                  max="18"
                  step="0.5"
                  v-model.number="project.fx.master.eq.low"
                  :disabled="!project.fx.enabled || !project.fx.master.eq.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">中频 {{ project.fx.master.eq.mid.toFixed(1) }} dB</div>
                <input
                  type="range"
                  min="-18"
                  max="18"
                  step="0.5"
                  v-model.number="project.fx.master.eq.mid"
                  :disabled="!project.fx.enabled || !project.fx.master.eq.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">高频 {{ project.fx.master.eq.high.toFixed(1) }} dB</div>
                <input
                  type="range"
                  min="-18"
                  max="18"
                  step="0.5"
                  v-model.number="project.fx.master.eq.high"
                  :disabled="!project.fx.enabled || !project.fx.master.eq.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
              </div>
            </div>

            <div class="rounded-xl border border-white/70 bg-white/45 p-4 space-y-3">
              <div class="flex items-center justify-between">
                <div class="text-sm font-semibold text-slate-900">压缩</div>
                <label class="text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    v-model="project.fx.master.compressor.enabled"
                    :disabled="!project.fx.enabled"
                    @change="commitFxSettings"
                  />
                  启用
                </label>
              </div>
              <div class="space-y-2">
                <div class="text-xs text-slate-500">阈值 {{ project.fx.master.compressor.threshold.toFixed(0) }} dB</div>
                <input
                  type="range"
                  min="-60"
                  max="0"
                  step="1"
                  v-model.number="project.fx.master.compressor.threshold"
                  :disabled="!project.fx.enabled || !project.fx.master.compressor.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">比例 {{ project.fx.master.compressor.ratio.toFixed(1) }}:1</div>
                <input
                  type="range"
                  min="1"
                  max="12"
                  step="0.1"
                  v-model.number="project.fx.master.compressor.ratio"
                  :disabled="!project.fx.enabled || !project.fx.master.compressor.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">起音 {{ project.fx.master.compressor.attack.toFixed(3) }} s</div>
                <input
                  type="range"
                  min="0.001"
                  max="0.08"
                  step="0.001"
                  v-model.number="project.fx.master.compressor.attack"
                  :disabled="!project.fx.enabled || !project.fx.master.compressor.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">释放 {{ project.fx.master.compressor.release.toFixed(2) }} s</div>
                <input
                  type="range"
                  min="0.05"
                  max="0.8"
                  step="0.01"
                  v-model.number="project.fx.master.compressor.release"
                  :disabled="!project.fx.enabled || !project.fx.master.compressor.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">补偿 {{ project.fx.master.compressor.makeup.toFixed(1) }} dB</div>
                <input
                  type="range"
                  min="-6"
                  max="12"
                  step="0.5"
                  v-model.number="project.fx.master.compressor.makeup"
                  :disabled="!project.fx.enabled || !project.fx.master.compressor.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
              </div>
            </div>

            <div class="rounded-xl border border-white/70 bg-white/45 p-4 space-y-3">
              <div class="flex items-center justify-between">
                <div class="text-sm font-semibold text-slate-900">延迟</div>
                <label class="text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    v-model="project.fx.master.delay.enabled"
                    :disabled="!project.fx.enabled"
                    @change="commitFxSettings"
                  />
                  启用
                </label>
              </div>
              <div class="space-y-2">
                <div class="text-xs text-slate-500">时间 {{ project.fx.master.delay.time.toFixed(2) }} s</div>
                <input
                  type="range"
                  min="0.02"
                  max="1.2"
                  step="0.01"
                  v-model.number="project.fx.master.delay.time"
                  :disabled="!project.fx.enabled || !project.fx.master.delay.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">反馈 {{ Math.round(project.fx.master.delay.feedback * 100) }}%</div>
                <input
                  type="range"
                  min="0"
                  max="0.92"
                  step="0.01"
                  v-model.number="project.fx.master.delay.feedback"
                  :disabled="!project.fx.enabled || !project.fx.master.delay.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">混合 {{ Math.round(project.fx.master.delay.mix * 100) }}%</div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  v-model.number="project.fx.master.delay.mix"
                  :disabled="!project.fx.enabled || !project.fx.master.delay.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
              </div>
            </div>

            <div class="rounded-xl border border-white/70 bg-white/45 p-4 space-y-3">
              <div class="flex items-center justify-between">
                <div class="text-sm font-semibold text-slate-900">混响</div>
                <label class="text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    v-model="project.fx.master.reverb.enabled"
                    :disabled="!project.fx.enabled"
                    @change="commitFxSettings"
                  />
                  启用
                </label>
              </div>
              <div class="space-y-2">
                <div class="text-xs text-slate-500">混合 {{ Math.round(project.fx.master.reverb.mix * 100) }}%</div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  v-model.number="project.fx.master.reverb.mix"
                  :disabled="!project.fx.enabled || !project.fx.master.reverb.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">时长 {{ project.fx.master.reverb.seconds.toFixed(2) }} s</div>
                <input
                  type="range"
                  min="0.3"
                  max="6"
                  step="0.05"
                  v-model.number="project.fx.master.reverb.seconds"
                  :disabled="!project.fx.enabled || !project.fx.master.reverb.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">衰减 {{ project.fx.master.reverb.decay.toFixed(2) }}</div>
                <input
                  type="range"
                  min="0.2"
                  max="6"
                  step="0.05"
                  v-model.number="project.fx.master.reverb.decay"
                  :disabled="!project.fx.enabled || !project.fx.master.reverb.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">预延迟 {{ project.fx.master.reverb.preDelay.toFixed(3) }} s</div>
                <input
                  type="range"
                  min="0"
                  max="0.15"
                  step="0.005"
                  v-model.number="project.fx.master.reverb.preDelay"
                  :disabled="!project.fx.enabled || !project.fx.master.reverb.enabled"
                  @input="previewFxSettings"
                  @change="commitFxSettings"
                />
                <div class="text-xs text-slate-500">IR 资源（可选 URL）</div>
                <input
                  v-model="project.fx.master.reverb.irUrl"
                  class="w-full input-glass rounded-lg px-3 py-2 text-xs"
                  :disabled="!project.fx.enabled || !project.fx.master.reverb.enabled"
                  placeholder="https://example.com/ir.wav"
                  @change="commitFxSettings"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="p-4 border-t border-slate-200/70 bg-white/30 flex justify-end gap-2">
          <UiButton variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold" @click="fxOpen = false">关闭</UiButton>
        </div>
      </div>
    </div>

    <div v-if="versionsOpen" class="fixed inset-0 z-[130] flex items-center justify-center px-4">
      <div class="absolute inset-0 bg-slate-900/35 backdrop-blur-sm" @click="versionsOpen = false"></div>
      <div class="glass-card w-full max-w-2xl rounded-2xl border border-white/70 shadow-2xl relative z-10 overflow-hidden">
        <div class="p-4 border-b border-slate-200/70 bg-white/30 flex items-center justify-between">
          <div class="text-lg font-extrabold text-slate-900">版本历史</div>
          <div class="flex items-center gap-2">
            <UiButton variant="ghost" class="px-2 py-2 rounded-lg" @click="loadVersions" :disabled="isLoadingVersions">
              <i v-if="isLoadingVersions" class="ph-bold ph-spinner animate-spin"></i>
              <i v-else class="ph-bold ph-arrow-clockwise"></i>
            </UiButton>
            <UiButton variant="ghost" class="px-2 py-2 rounded-lg" @click="versionsOpen = false">
              <i class="ph-bold ph-x"></i>
            </UiButton>
          </div>
        </div>

        <div class="p-5 space-y-4">
          <div v-if="!isLoggedIn" class="rounded-xl border border-amber-200/70 bg-amber-50/70 p-4">
            <div class="text-sm font-semibold text-amber-700">未登录</div>
            <div class="text-xs text-amber-700/90 mt-1">版本管理需要登录并同步到云端草稿。</div>
            <div class="mt-3">
              <div
                class="relative inline-flex"
                @pointerenter="isVersionLoginTipOpen = true"
                @pointerleave="isVersionLoginTipOpen = false"
              >
                <UiButton
                  variant="secondary"
                  class="px-3 py-2 rounded-lg text-xs font-semibold"
                  @click="goLoginFromVersions"
                >
                  去登录
                </UiButton>
                <div
                  v-if="isVersionLoginTipOpen"
                  class="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 glass-card rounded-xl border border-white/70 p-3 text-xs text-slate-700 shadow-xl"
                >
                  <div class="font-semibold text-slate-900">登录后可用</div>
                  <div class="mt-1">保存版本历史、查看记录、回滚工程。</div>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-xl border border-white/70 bg-white/50 p-4 space-y-3">
            <div class="text-xs text-slate-500 font-semibold">创建快照（建议填备注便于回溯）</div>
            <input v-model="versionTitle" class="w-full input-glass rounded-lg px-3 py-2 text-sm" placeholder="版本标题（可选）" />
            <textarea v-model="versionNote" rows="3" class="w-full input-glass rounded-lg px-3 py-2 text-sm" placeholder="版本说明 / 变更记录"></textarea>
            <div class="flex justify-end">
              <UiButton
                variant="primary"
                class="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                :disabled="isCreatingVersion || !isLoggedIn"
                @click="createVersionSnapshot"
              >
                <i v-if="isCreatingVersion" class="ph-bold ph-spinner animate-spin"></i>
                {{ isCreatingVersion ? '创建中...' : '创建快照' }}
              </UiButton>
            </div>
          </div>

          <div class="space-y-2 max-h-[420px] overflow-auto">
            <div v-if="isLoadingVersions" class="text-sm text-slate-500">加载中...</div>
            <div v-else-if="!versions.length" class="rounded-xl border border-white/70 bg-white/45 p-4 text-sm text-slate-500">
              <div>暂无版本记录</div>
              <div class="text-xs text-slate-400 mt-1">可以先编辑并创建快照；若未登录请先登录。</div>
            </div>
            <div
              v-for="item in versions"
              :key="item.versionId"
              class="rounded-xl border border-white/70 bg-white/45 p-4"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <div class="text-sm font-bold text-slate-900 truncate">
                    {{ item.title || '未命名版本' }}
                  </div>
                  <div class="text-xs text-slate-500">
                    {{ formatVersionTime(item.createdAt) }} · {{ versionKindLabel(item.kind) }}
                    <span v-if="item.restoredFrom"> · 来源 {{ item.restoredFrom }}</span>
                  </div>
                  <div v-if="item.note" class="text-xs text-slate-600 mt-1 whitespace-pre-wrap">
                    {{ item.note }}
                  </div>
                  <div class="text-[10px] text-slate-400 font-mono mt-2">#{{ item.versionId }}</div>
                </div>
                <div class="flex flex-col items-end gap-2 shrink-0">
                  <span
                    v-if="String(item.versionId || '') === String(headVersionId || '')"
                    class="text-[10px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold"
                  >
                    当前
                  </span>
                  <UiButton
                    variant="ghost"
                    class="px-3 py-2 rounded-lg text-xs font-semibold"
                    :disabled="isRestoringVersion"
                    @click="restoreVersionSnapshot(item)"
                  >
                    回滚
                  </UiButton>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="p-4 border-t border-slate-200/70 bg-white/30 flex justify-end gap-2">
          <UiButton variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold" @click="versionsOpen = false">关闭</UiButton>
        </div>
      </div>
    </div>

    <TransportBar
      :project-id="projectId"
      :title="project.meta.title"
      :transport="project.transport"
      :is-playing="isPlaying"
      :is-importing="isImportingAudio"
      :snap-enabled="snapEnabled"
      :auto-crossfade="autoCrossfade"
      :can-undo="undoStack.length > 0"
      :can-redo="redoStack.length > 0"
      :is-region-drawing="isRegionDrawing"
      @toggle-play="togglePlay"
      @undo="undo"
      @redo="redo"
      @update:bpm="updateBpm"
      @update:grid="updateGrid"
      @update:time-signature="updateTimeSignature"
      @update:loop-range="updateLoopRange"
      @update:snap-enabled="updateSnapEnabled"
      @update:auto-crossfade="updateAutoCrossfade"
      @add-marker="addMarker"
      @add-region="addRegion"
      @cancel-region-draw="isRegionDrawing = false"
      @import-audio="importAudio"
      @open-versions="openVersionsPanel"
      @open-fx="fxOpen = true"
      @publish="openPublish"
      @export="openExport"
      @new-project="createNewProject"
      @clear-project="clearProject"
      @save-draft="saveDraftNow"
    />

    <div class="flex-1 flex overflow-hidden">
      <TrackList
        :tracks="project.tracks"
        :selected-clip="selectedClip"
        :selected-asset="selectedAsset"
        :selected-track="selectedTrack"
        :selected-track-id="selectedTrackId"
        @add-track="addTrack"
        @select-track="selectTrack"
        @update-track="updateTrack"
        @update-clip="updateClip"
        @delete-clip="deleteClip"
        @normalize-clip="normalizeClip"
      />
      <div class="flex-1 flex flex-col overflow-hidden relative">
        <div
          v-if="!isLoadingProject && isProjectEmpty"
          class="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div class="glass-card px-6 py-4 rounded-2xl border border-white/70 text-sm text-slate-600 shadow-lg">
            当前工程为空，可先导入音频或创建轨道开始编辑。
          </div>
        </div>
        <Timeline
          :transport="project.transport"
          :tracks="project.tracks"
          :assets="project.assets"
          :clips="project.clips"
          :markers="project.markers"
          :regions="project.regions"
          :is-playing="isPlaying"
          :selected-clip-ids="selectedClipIds"
          :px-per-second="pxPerSecond"
          :snap-enabled="snapEnabled"
          :is-region-drawing="isRegionDrawing"
          @update-zoom="updateZoom"
          @scrub-start="onScrubStart"
          @preview-playhead="previewPlayhead"
          @update-playhead="commitPlayhead"
          @update-clip="updateClip"
          @update-region="updateRegion"
          @delete-region="deleteRegion"
          @create-region="createRegionFromRange"
          @finish-region-draw="isRegionDrawing = false"
          @select-clip="selectClip"
          @set-selection="setSelection"
        />

        <MidiPianoRoll
          v-if="selectedClip && selectedAsset && selectedAsset.type === 'midi'"
          :asset="selectedAsset"
          :clip="selectedClip"
          :transport="project.transport"
          :px-per-second="pxPerSecond"
          :snap-enabled="snapEnabled"
          @update-asset="updateAsset"
        />
      </div>
    </div>
  </div>
</template>
