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
import AudioEngine from '../audio/AudioEngine.js';
import MidiEngine from '../audio/MidiEngine.js';
import { getSharedAudioContext } from '../audio/sharedAudioContext.js';
import { notifyPlaybackStop, registerPlaybackSource, requestPlaybackStart } from '../audio/playbackCoordinator.js';
import { noteToMidi } from '../utils/musicNotes.js';
import { loadProjectDraft, saveProjectDraft } from '../utils/projectStorage.js';
import {
  apiCreateProjectDraft,
  apiGetProjectSource,
  apiPublishProject,
  apiUpdateProjectDraft,
  apiUploadAudioFile,
  isMongoObjectId,
} from '../api/projects.js';

const route = useRoute();
const router = useRouter();

const projectId = computed(() => String(route.params.projectId || route.query.projectId || 'proj_demo'));
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

const exportOpen = ref(false);
const isExportingWav = ref(false);
const isExportingMp3 = ref(false);

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
          project.value.meta.id = newId;
          skipNextLoadId = newId;
          router.replace({ name: 'Studio', params: { projectId: newId } }).catch(() => {});
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
  const pid = String(id || '').trim();

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

  // 1) Prefer server (only works for owner).
  if (hasToken() && isMongoObjectId(pid)) {
    try {
      const data = await apiGetProjectSource(pid);
      const loaded = hydrateProjectForRuntime(data?.project || {});
      if (loaded?.meta) loaded.meta.id = pid;
      project.value = loaded?.meta ? loaded : createMockProject(pid);
      resolvedProjectDocId.value = pid;
      audioEngine.value?.applyTrackMix?.(project.value);
      audioEngine.value?.applyClipMix?.(project.value);
      midiEngine.value?.applyTrackMix?.(project.value);
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
    audioEngine.value?.applyTrackMix?.(project.value);
    audioEngine.value?.applyClipMix?.(project.value);
    midiEngine.value?.applyTrackMix?.(project.value);
    return;
  }

  // 3) Fallback mock
  project.value = createMockProject(pid);
  resolvedProjectDocId.value = isMongoObjectId(pid) ? pid : '';
};

watch(projectId, async (id) => {
  if (String(id) && String(id) === String(skipNextLoadId)) {
    skipNextLoadId = '';
    return;
  }
  await loadProjectById(id);
}, { immediate: true });

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
  pushHistory();
  const transport = project.value.transport || {};
  const loop = transport.loopRange || {};
  let start = Math.max(0, Number(loop.start) || 0);
  let end = Math.max(0, Number(loop.end) || 0);

  if (!(loop.enabled && end > start + 0.01)) {
    const t = Math.max(0, Number(transport.playhead) || 0);
    start = t;
    end = t + 4;
  }

  if (!(end > start + 0.01)) end = start + 1;

  const list = Array.isArray(project.value.regions) ? project.value.regions : [];
  const region = { id: createId('region'), start, end, label: `R${list.length + 1}` };
  project.value.regions = [...list, region];
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

    const asset = {
      id: assetId,
      type: 'audio',
      url,
      duration: Number(audioBuffer.duration || 0),
      sampleRate: Number(audioBuffer.sampleRate || 0),
      channels: Number(audioBuffer.numberOfChannels || 1),
      hash: `local:${file.name}:${file.size}:${file.lastModified}`,
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
  midiEngine.value = new MidiEngine({ context: engine.context });
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
  <div class="h-screen flex flex-col overflow-hidden">
    <div
      v-if="saveToast"
      class="fixed top-24 right-6 z-[120] glass-card px-4 py-2 rounded-xl border border-white/70 text-sm font-semibold text-slate-800 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <i v-if="saveToastTone === 'ok'" class="ph-bold ph-check-circle text-emerald-600"></i>
        <i v-else class="ph-bold ph-warning-circle text-rose-600"></i>
        {{ saveToast }}
      </div>
    </div>

    <div
      v-if="clipboardToast"
      class="fixed top-24 right-6 z-[120] glass-card px-4 py-2 rounded-xl border border-white/70 text-sm font-semibold text-slate-800 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <i v-if="clipboardToastTone === 'ok'" class="ph-bold ph-check-circle text-emerald-600"></i>
        <i v-else class="ph-bold ph-warning-circle text-rose-600"></i>
        {{ clipboardToast }}
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
      @import-audio="importAudio"
      @publish="openPublish"
      @export="openExport"
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
      <div class="flex-1 flex flex-col overflow-hidden">
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
          @update-zoom="updateZoom"
          @scrub-start="onScrubStart"
          @preview-playhead="previewPlayhead"
          @update-playhead="commitPlayhead"
          @update-clip="updateClip"
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
