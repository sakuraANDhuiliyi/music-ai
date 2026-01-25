<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';
import { postSSE } from '../utils/ssePost.js';
import { apiUrl, API_ENDPOINTS } from '../config/appConfig.js';
import { identifyChordName } from '../utils/chordIdentify.js';
import { addAiChordCollection, getAiChordCollectionById, updateAiChordCollection } from '../utils/aiChordStorage.js';
import { playChordNotes, playMelody, playProgression, stopPlayback } from '../utils/chordPlayer.js';
import { authFetch } from '../composables/useUser.js';
import { PROMPT_TEMPLATE_SCOPES } from '../config/promptTemplates.js';
import { loadPromptTemplates, saveCustomPromptTemplates } from '../utils/promptTemplateStore.js';
import { parseNoteString, pcToName } from '../utils/musicNotes.js';
import { transposeChordNotes, transposeNoteString } from '../utils/noteTransform.js';

const router = useRouter();
const route = useRoute();

const prompt = ref('浮游感的和弦进行');
const isCreating = ref(false);
const progress = ref(0);
const streamMessage = ref('');
const result = ref(null);
const errorMsg = ref('');

const withMelody = ref(true);
const generationProvider = ref('auto');
const sparkThinking = ref('disabled');

const genre = ref('');
const keySig = ref('');
const scale = ref('major');
const bars = ref(32);
const structure = ref('A(Verse)-B(Chorus)-A(Verse)-B(Chorus)');

const editableChords = ref([]);
const editableMelody = ref([]);
const bpm = ref(120);
const chordBeats = ref(4);
const isPreviewPlaying = ref(false);

const songMeta = ref({ genre: '', key: '', scale: '', structure: '' });
const songSections = ref([]);
const allowSong = computed(() =>
  generationProvider.value === 'llm' || generationProvider.value === 'spark' || generationProvider.value === 'auto'
);

const abortController = ref(null);
const sectionAbortController = ref(null);

const templatePanelOpen = ref(false);
const templates = ref([]);
const selectedGenerateTemplateId = ref('');
const selectedSectionTemplateId = ref('');
const sectionEditExtraPrompt = ref('');

const sectionEditBusyIndex = ref(-1);
const sectionEditProgress = ref(0);
const sectionEditMessage = ref('');
const sectionEditError = ref('');

const sectionTransposeTargets = ref({});

const editId = computed(() => String(route.query?.edit || '').trim());
const editSrc = computed(() => String(route.query?.src || '').trim());
const isEditMode = computed(() => Boolean(editId.value));

const hasToken = computed(() => {
  try {
    return Boolean(localStorage.getItem('token'));
  } catch {
    return false;
  }
});

const remainingCount = computed(() => {
  if (hasToken.value) return null;
  try {
    const today = new Date().toDateString();
    const key = `universal_create_count_${today}`;
    const used = Number(localStorage.getItem(key) || '0');
    return Math.max(0, 3 - used);
  } catch {
    return null;
  }
});

const canCreate = computed(() => !isCreating.value && prompt.value.trim().length > 0);

const generateTemplates = computed(() => (templates.value || []).filter((t) => t?.scope === PROMPT_TEMPLATE_SCOPES.generate));
const sectionEditTemplates = computed(() => (templates.value || []).filter((t) => t?.scope === PROMPT_TEMPLATE_SCOPES.sectionEdit));

const findTemplateById = (id) => (templates.value || []).find((t) => String(t?.id) === String(id));

const insertGenerateTemplate = () => {
  const tpl = findTemplateById(selectedGenerateTemplateId.value);
  if (!tpl?.content) return;
  const base = prompt.value.trim();
  prompt.value = base ? `${base}\n\n${tpl.content}` : String(tpl.content);
};

const saveCurrentPromptAsTemplate = () => {
  const content = String(prompt.value || '').trim();
  if (!content) return;
  const title = window.prompt('模板标题（用于“生成”）', '我的生成模板');
  const safeTitle = String(title || '').trim();
  if (!safeTitle) return;
  const tpl = {
    id: `custom_generate_${Date.now()}`,
    scope: PROMPT_TEMPLATE_SCOPES.generate,
    title: safeTitle,
    content,
  };
  const next = [...(templates.value || []), tpl];
  templates.value = next;
  saveCustomPromptTemplates(next);
  selectedGenerateTemplateId.value = tpl.id;
};

const applySectionEditTemplate = (mode = 'replace') => {
  const tpl = findTemplateById(selectedSectionTemplateId.value);
  if (!tpl?.content) return;
  const base = sectionEditExtraPrompt.value.trim();
  if (mode === 'append') {
    sectionEditExtraPrompt.value = base ? `${base}\n${tpl.content}` : String(tpl.content);
    return;
  }
  sectionEditExtraPrompt.value = String(tpl.content);
};

const saveCurrentSectionEditPromptAsTemplate = () => {
  const content = String(sectionEditExtraPrompt.value || '').trim();
  if (!content) return;
  const title = window.prompt('模板标题（用于“局部编辑”）', '我的局部编辑模板');
  const safeTitle = String(title || '').trim();
  if (!safeTitle) return;
  const tpl = {
    id: `custom_section_${Date.now()}`,
    scope: PROMPT_TEMPLATE_SCOPES.sectionEdit,
    title: safeTitle,
    content,
  };
  const next = [...(templates.value || []), tpl];
  templates.value = next;
  saveCustomPromptTemplates(next);
  selectedSectionTemplateId.value = tpl.id;
};

const normalizeNotesText = (text) => {
  const raw = String(text || '')
    .replace(/[\n\r\t]+/g, ' ')
    .trim();
  if (!raw) return [];
  return raw
    .split(/[\s,，]+/g)
    .map((x) => String(x || '').trim())
    .filter(Boolean);
};

const getChordValueFromResult = (data) => {
  if (!data) return null;
  if (data.type === 'chord' && Array.isArray(data.value)) return data.value;
  if (data.type === 'song' && Array.isArray(data.chords)) return data.chords;
  return null;
};

const flattenSongSections = (sections) => {
  const list = Array.isArray(sections) ? sections : [];
  const chords = [];
  const melody = [];
  for (const s of list) {
    const ch = Array.isArray(s?.chords) ? s.chords : [];
    const ml = Array.isArray(s?.melody) ? s.melody : [];
    ch.forEach((x) => chords.push(x));
    ml.forEach((x) => melody.push(x));
  }
  return { chords, melody };
};

const initEditableChordsFromResult = (data) => {
  let value = getChordValueFromResult(data);
  if (!value && data?.type === 'song' && Array.isArray(data?.sections)) {
    value = flattenSongSections(data.sections).chords;
  }
  if (!value) {
    editableChords.value = [];
    return;
  }

  editableChords.value = value.map((notes, idx) => {
    const safeNotes = Array.isArray(notes) ? notes.map((x) => String(x)) : [];
    const autoName = identifyChordName(safeNotes) || `Chord_${idx + 1}`;
    return {
      id: `${Date.now()}_${idx}`,
      name: autoName,
      autoName: true,
      notes: safeNotes,
      notesText: safeNotes.join(' '),
    };
  });
};

const initEditableMelodyFromResult = (data) => {
  if (!data || data.type !== 'song') {
    editableMelody.value = [];
    songSections.value = [];
    songMeta.value = { genre: '', key: '', scale: '', structure: '' };
    return;
  }

  bpm.value = Math.max(40, Math.min(240, Math.round(Number(data.bpm) || 120)));
  chordBeats.value = Math.max(1, Math.min(16, Number(data.chordBeats) || 4));

  songMeta.value = {
    genre: String(data?.genre || '').trim(),
    key: String(data?.key || '').trim(),
    scale: String(data?.scale || '').trim(),
    structure: String(data?.structure || '').trim(),
  };

  const sectionsRaw = Array.isArray(data?.sections) ? data.sections : [];
  sectionsRaw.forEach((s) => {
    if (s && !Array.isArray(s.chords)) s.chords = [];
    if (s && !Array.isArray(s.melody)) s.melody = [];
  });
  songSections.value = sectionsRaw
    .map((s) => ({
      name: String(s?.name || '').trim(),
      label: String(s?.label || '').trim(),
      bars: Number(s?.bars) || 0,
    }))
    .filter((s) => s.name || s.label);

  let melodyRaw = Array.isArray(data?.melody) ? data.melody : [];
  if (!melodyRaw.length && sectionsRaw.length) {
    melodyRaw = flattenSongSections(sectionsRaw).melody;
  }

  editableMelody.value = melodyRaw
    .map((m, idx) => {
      const note = String(m?.note || '').trim();
      const d = Number(m?.durBeats);
      const durBeatsSafe = Number.isFinite(d) ? Math.max(0.125, Math.min(16, d)) : 1;
      return {
        id: `${Date.now()}_m_${idx}`,
        note,
        durBeats: durBeatsSafe,
      };
    })
    .filter((m) => m.note);
};

const sectionInfos = computed(() => {
  if (result.value?.type !== 'song') return [];
  const sections = Array.isArray(result.value?.sections) ? result.value.sections : [];
  let chordStart = 0;
  let melodyStart = 0;
  return sections.map((s, idx) => {
    const chords = Array.isArray(s?.chords) ? s.chords : [];
    const melody = Array.isArray(s?.melody) ? s.melody : [];
    const info = {
      idx,
      name: String(s?.name || '').trim(),
      label: String(s?.label || '').trim(),
      bars: Number(s?.bars) || 0,
      chordStart,
      chordCount: chords.length,
      melodyStart,
      melodyCount: melody.length,
    };
    chordStart += chords.length;
    melodyStart += melody.length;
    return info;
  });
});

const normalizeChordMatrix = (value, targetCount) => {
  const list = Array.isArray(value) ? value : [];
  const chords = list
    .map((c) => (Array.isArray(c) ? c.map((n) => String(n || '').trim()).filter(Boolean) : []))
    .filter((c) => c.length);

  const target = Math.max(0, Number(targetCount) || 0);
  if (target === 0) return chords;
  if (chords.length > target) return chords.slice(0, target);
  if (chords.length === target) return chords;
  const last = chords[chords.length - 1] || ['C4', 'E4', 'G4'];
  const padded = [...chords];
  while (padded.length < target) padded.push([...last]);
  return padded;
};

const normalizeMelodyList = (value, targetCount) => {
  const list = Array.isArray(value) ? value : [];
  const melody = list.map((m) => {
    const noteRaw = String(m?.note || '').trim();
    const note = noteRaw.toUpperCase() === 'REST' ? 'REST' : noteRaw;
    const d = Number(m?.durBeats);
    const durBeats = Number.isFinite(d) && d > 0 ? d : 1;
    return { note, durBeats };
  });

  const target = Math.max(0, Number(targetCount) || 0);
  if (target === 0) return melody;
  if (melody.length > target) return melody.slice(0, target);
  if (melody.length === target) return melody;
  const padded = [...melody];
  while (padded.length < target) padded.push({ note: 'REST', durBeats: 1 });
  return padded;
};

const buildSectionPayloadFromEditable = (info) => {
  const chords = (editableChords.value || [])
    .slice(info.chordStart, info.chordStart + info.chordCount)
    .map((b) => (Array.isArray(b?.notes) ? b.notes.map((n) => String(n)).filter(Boolean) : []));

  const melody = (editableMelody.value || [])
    .slice(info.melodyStart, info.melodyStart + info.melodyCount)
    .map((m) => ({ note: String(m?.note || '').trim(), durBeats: Number(m?.durBeats) }));

  return { chords, melody };
};

const applySectionPatchToEditable = (info, patch) => {
  const nextChords = normalizeChordMatrix(patch?.chords, info.chordCount);
  const nextMelody = normalizeMelodyList(patch?.melody, info.melodyCount);

  for (let i = 0; i < info.chordCount; i += 1) {
    const block = editableChords.value?.[info.chordStart + i];
    if (!block) continue;
    const notes = nextChords[i] || [];
    block.notes = notes;
    block.notesText = notes.join(' ');
    if (block.autoName) block.name = identifyChordName(notes) || block.name;
  }

  for (let i = 0; i < info.melodyCount; i += 1) {
    const m = editableMelody.value?.[info.melodyStart + i];
    if (!m) continue;
    const row = nextMelody[i] || { note: 'REST', durBeats: 1 };
    m.note = row.note;
    m.durBeats = row.durBeats;
  }

  const sec = result.value?.sections?.[info.idx];
  if (sec) {
    sec.chords = nextChords;
    sec.melody = nextMelody;
  }
};

const NOTE_TO_PC = Object.freeze({
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
});

const parseKeyRootPc = (keyLike) => {
  const s = String(keyLike || '').trim();
  if (!s) return null;
  const m = s.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const name = `${m[1].toUpperCase()}${m[2] || ''}`;
  const pc = NOTE_TO_PC[name];
  return pc == null ? null : pc;
};

const nearestSemitoneDelta = (fromPc, toPc) => {
  const a = ((Number(fromPc) % 12) + 12) % 12;
  const b = ((Number(toPc) % 12) + 12) % 12;
  const up = (b - a + 12) % 12;
  const down = up - 12;
  return Math.abs(down) < Math.abs(up) ? down : up;
};

const transposeSection = (info) => {
  const targetKey = String(sectionTransposeTargets.value?.[info.idx] || '').trim();
  const fromPc = parseKeyRootPc(songMeta.value?.key || keySig.value || result.value?.key);
  const toPc = parseKeyRootPc(targetKey);
  if (fromPc == null || toPc == null) return;
  const delta = nearestSemitoneDelta(fromPc, toPc);
  if (!delta) return;

  for (let i = 0; i < info.chordCount; i += 1) {
    const block = editableChords.value?.[info.chordStart + i];
    if (!block) continue;
    const next = transposeChordNotes(block.notes || [], delta);
    block.notes = next;
    block.notesText = next.join(' ');
    if (block.autoName) block.name = identifyChordName(next) || block.name;
  }
  for (let i = 0; i < info.melodyCount; i += 1) {
    const m = editableMelody.value?.[info.melodyStart + i];
    if (!m) continue;
    m.note = transposeNoteString(m.note, delta);
  }

  const sec = result.value?.sections?.[info.idx];
  if (sec) {
    sec.chords = normalizeChordMatrix((sec.chords || []).map((c) => transposeChordNotes(c || [], delta)), info.chordCount);
    sec.melody = normalizeMelodyList((sec.melody || []).map((x) => ({ ...x, note: transposeNoteString(x?.note, delta) })), info.melodyCount);
  }
};

const addBassToSection = (info) => {
  for (let i = 0; i < info.chordCount; i += 1) {
    const block = editableChords.value?.[info.chordStart + i];
    if (!block) continue;
    const notes = Array.isArray(block.notes) ? [...block.notes] : [];
    if (notes.length >= 6) continue;

    const chordName = identifyChordName(notes) || '';
    const m = chordName.match(/^([A-G](?:#|b)?)/);
    const rootPc = NOTE_TO_PC[m?.[1] || ''];
    if (rootPc == null) continue;

    let minOctave = 3;
    for (const n of notes) {
      const p = parseNoteString(n);
      if (!p) continue;
      if (p.octave < minOctave) minOctave = p.octave;
    }
    const bassOct = Math.max(-1, minOctave - 1);
    const bass = `${pcToName(rootPc)}${bassOct}`;
    if (!notes.includes(bass)) notes.unshift(bass);

    block.notes = notes;
    block.notesText = notes.join(' ');
    if (block.autoName) block.name = identifyChordName(notes) || block.name;

    const sec = result.value?.sections?.[info.idx];
    if (sec?.chords?.[i]) {
      const base = Array.isArray(sec.chords[i]) ? [...sec.chords[i]] : [];
      if (base.length < 6 && !base.includes(bass)) base.unshift(bass);
      sec.chords[i] = base;
    }
  }
};

const handleSectionAiEdit = async (info, operation) => {
  if (result.value?.type !== 'song') return;
  if (sectionEditBusyIndex.value !== -1) return;
  if (!info || typeof info.idx !== 'number') return;

  sectionEditBusyIndex.value = info.idx;
  sectionEditProgress.value = 0;
  sectionEditMessage.value = '';
  sectionEditError.value = '';

  const ac = new AbortController();
  sectionAbortController.value = ac;

  try {
    const { chords, melody } = buildSectionPayloadFromEditable(info);
    await postSSE(apiUrl(API_ENDPOINTS.aiSectionEdit), {
      body: {
        operation,
        prompt: prompt.value,
        extraPrompt: sectionEditExtraPrompt.value,
        songMeta: {
          genre: songMeta.value?.genre || genre.value,
          bpm: bpm.value,
          key: songMeta.value?.key || keySig.value,
          scale: songMeta.value?.scale || scale.value,
          chordBeats: chordBeats.value,
          structure: songMeta.value?.structure || structure.value,
        },
        section: {
          name: info.name,
          label: info.label,
          bars: info.bars,
          chordCount: info.chordCount,
          melodyCount: info.melodyCount,
          chords,
          melody,
        },
      },
      signal: ac.signal,
      onEvent: (evt) => {
        if (!evt?.data) return;
        let payload;
        try {
          payload = JSON.parse(evt.data);
        } catch {
          return;
        }

        switch (payload.type) {
          case 'start':
            sectionEditMessage.value = payload.message || '正在处理本段...';
            sectionEditProgress.value = 15;
            break;
          case 'progress':
            sectionEditMessage.value = payload.message || '正在生成...';
            sectionEditProgress.value = Math.min(sectionEditProgress.value + 10, 90);
            break;
          case 'result': {
            sectionEditProgress.value = 100;
            sectionEditMessage.value = '本段已更新';
            const sec = payload.data?.section || payload.data;
            if (sec) applySectionPatchToEditable(info, sec);
            break;
          }
          case 'error':
            sectionEditError.value = payload.message || '本段编辑失败，请稍后重试';
            break;
          default:
            break;
        }
      },
    });
  } catch (e) {
    if (e?.name !== 'AbortError') {
      sectionEditError.value = e?.message || '本段编辑失败，请稍后重试';
    }
  } finally {
    sectionAbortController.value = null;
    sectionEditBusyIndex.value = -1;
    sectionEditProgress.value = 0;
    sectionEditMessage.value = '';
  }
};

const markManualName = (block) => {
  if (!block) return;
  block.autoName = false;
};

const applyNotesText = (block, idx) => {
  if (!block) return;
  const notes = normalizeNotesText(block.notesText);
  block.notes = notes;
  if (!block.name || block.autoName) {
    block.name = identifyChordName(notes) || `Chord_${idx + 1}`;
    block.autoName = true;
  }
};

const checkCreateLimit = () => {
  if (hasToken.value) return true;
  try {
    const today = new Date().toDateString();
    const key = `universal_create_count_${today}`;
    const used = Number(localStorage.getItem(key) || '0');
    if (used >= 3) return false;
    return true;
  } catch {
    return true;
  }
};

const incrementCreateCount = () => {
  if (hasToken.value) return;
  try {
    const today = new Date().toDateString();
    const key = `universal_create_count_${today}`;
    const used = Number(localStorage.getItem(key) || '0');
    localStorage.setItem(key, String(used + 1));
  } catch {
    // ignore
  }
};

const handleCreate = async () => {
  if (!checkCreateLimit()) {
    errorMsg.value = '未登录用户每日最多创建3次';
    return;
  }

  isCreating.value = true;
  progress.value = 0;
  streamMessage.value = '';
  result.value = null;
  errorMsg.value = '';

  const ac = new AbortController();
  abortController.value = ac;

  try {
    await postSSE(apiUrl(API_ENDPOINTS.aiCreator), {
      body: {
        prompt: prompt.value,
        mode: withMelody.value ? 'song' : 'chords',
        provider: generationProvider.value,
        thinkingType: generationProvider.value === 'spark' ? sparkThinking.value : undefined,
        genre: withMelody.value ? genre.value : undefined,
        bpm: withMelody.value ? bpm.value : undefined,
        key: withMelody.value ? keySig.value : undefined,
        scale: withMelody.value ? scale.value : undefined,
        bars: withMelody.value ? bars.value : undefined,
        structure: withMelody.value ? structure.value : undefined,
      },
      signal: ac.signal,
      onEvent: (evt) => {
        if (!evt?.data) return;
        let payload;
        try {
          payload = JSON.parse(evt.data);
        } catch {
          return;
        }

        switch (payload.type) {
          case 'start':
            streamMessage.value = payload.message || '容我想想...';
            progress.value = Math.min(progress.value + 10, 90);
            break;
          case 'progress':
            streamMessage.value = payload.message || '正在生成...';
            progress.value = Math.min(progress.value + 5, 90);
            break;
          case 'result':
            progress.value = 100;
            streamMessage.value = '创作完成！';
            result.value = payload.data;
            initEditableChordsFromResult(payload.data);
            initEditableMelodyFromResult(payload.data);
            if (payload.data?.type === 'song') {
              if (payload.data?.genre) genre.value = String(payload.data.genre);
              if (payload.data?.key) keySig.value = String(payload.data.key);
              if (payload.data?.scale) scale.value = String(payload.data.scale);
              if (payload.data?.structure) structure.value = String(payload.data.structure);
            }
            if (payload.data?.type !== 'NOT_SUPPORT') incrementCreateCount();
            isCreating.value = false;
            break;
          case 'too_many_requests':
            errorMsg.value = payload.message || '当前服务繁忙，请稍后重试';
            streamMessage.value = '';
            progress.value = 0;
            isCreating.value = false;
            abortController.value?.abort?.();
            break;
          case 'error':
            errorMsg.value = payload.message || '发生错误，可稍后重试';
            if (payload.details) {
              const detailsText = String(payload.details).slice(0, 300);
              errorMsg.value += `\n${detailsText}`;
            }
            console.error('[AiChordCreator] server error event:', JSON.stringify(payload));
            streamMessage.value = '';
            progress.value = 0;
            isCreating.value = false;
            abortController.value?.abort?.();
            break;
          default:
            break;
        }
      },
    });

    // If stream ends without result
    if (isCreating.value) {
      isCreating.value = false;
      if (progress.value !== 100) {
        errorMsg.value = '连接已结束但未返回结果，请确认后端已重启并检查 /api/ai-creator 日志';
        console.warn('[AiChordCreator] SSE ended without result/error');
      }
    }
  } catch (e) {
    if (e?.name === 'AbortError') {
      errorMsg.value = '';
    } else {
      errorMsg.value = e?.message || '当前服务繁忙，请稍后重试';
      console.error('[AiChordCreator] request failed:', e);
    }
    isCreating.value = false;
    progress.value = 0;
    streamMessage.value = '';
  } finally {
    abortController.value = null;
  }
};

const handleCancel = () => {
  abortController.value?.abort?.();
  abortController.value = null;
  isCreating.value = false;
  progress.value = 0;
  streamMessage.value = '';
};

const handleImport = async () => {
  if (!result.value || (result.value.type !== 'chord' && result.value.type !== 'song')) return;
  const chordsForSave = (editableChords.value || [])
    .map((c) => ({
      name: String(c?.name || '').trim(),
      notes: Array.isArray(c?.notes) ? c.notes.map((n) => String(n)).filter(Boolean) : [],
    }))
    .filter((c) => c.notes.length > 0);

  const melodyForSave = (editableMelody.value || [])
    .map((m) => ({
      note: String(m?.note || '').trim(),
      durBeats: Math.max(0.125, Math.min(16, Number(m?.durBeats) || 1)),
    }))
    .filter((m) => m.note);

  if (chordsForSave.length === 0) {
    errorMsg.value = '请至少保留一个包含音符的和弦';
    return;
  }

  const name = prompt.value.trim().slice(0, 20) + (prompt.value.trim().length > 20 ? '...' : '');
  const payload = {
    name,
    prompt: prompt.value.trim(),
    chords: chordsForSave,
    desc: result.value.desc || '',
    bpm: Math.max(40, Math.min(240, Math.round(Number(bpm.value) || 120))),
    chordBeats: Math.max(1, Math.min(16, Number(chordBeats.value) || 4)),
    melody: melodyForSave,
    genre: String(genre.value || '').trim(),
    key: String(keySig.value || '').trim(),
    scale: String(scale.value || '').trim(),
    structure: String(structure.value || '').trim(),
    sections: Array.isArray(songSections.value) ? songSections.value : [],
  };

  // 编辑模式：保存修改
  if (isEditMode.value) {
    if (editSrc.value === 'db') {
      try {
        const res = await authFetch(`/api/ai-chords/${editId.value}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.message || '保存失败');
        router.push('/library');
        return;
      } catch (e) {
        errorMsg.value = e?.message || '保存失败';
        return;
      }
    }

    // local 编辑
    updateAiChordCollection(editId.value, {
      name: payload.name,
      prompt: payload.prompt,
      chords: payload.chords,
      desc: payload.desc,
      bpm: payload.bpm,
      chordBeats: payload.chordBeats,
      melody: payload.melody,
      genre: payload.genre,
      key: payload.key,
      scale: payload.scale,
      structure: payload.structure,
      sections: payload.sections,
    });
    router.push('/library');
    return;
  }

  if (hasToken.value) {
    try {
      const res = await authFetch('/api/ai-chords', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || '保存失败');
      router.push('/library');
      return;
    } catch (e) {
      errorMsg.value = e?.message || '保存失败';
      return;
    }
  }

  // 未登录：回退到本地存储
  addAiChordCollection({
    id: `${Date.now()}`,
    createdAt: Date.now(),
    ...payload,
  });
  router.push('/library');
};

const playOne = async (block) => {
  await playChordNotes(block.notes, 1.1);
};

const playAll = async () => {
  const playable = (editableChords.value || []).filter((c) => Array.isArray(c?.notes) && c.notes.length > 0);
  if (!playable.length) return;
  const perChordSec = (60 / Math.max(40, Math.min(240, Number(bpm.value) || 120))) * (Number(chordBeats.value) || 4);
  isPreviewPlaying.value = true;
  try {
    if (editableMelody.value?.length) {
      await Promise.all([
        playProgression(playable, Math.max(0.2, perChordSec)),
        playMelody(editableMelody.value, bpm.value),
      ]);
    } else {
      await playProgression(playable, Math.max(0.2, perChordSec));
    }
  } finally {
    isPreviewPlaying.value = false;
  }
};

const togglePreviewPlayback = async () => {
  if (isPreviewPlaying.value) {
    stopPlayback();
    isPreviewPlaying.value = false;
    return;
  }
  await playAll();
};

onBeforeUnmount(() => {
  abortController.value?.abort?.();
  stopPlayback();
});

watch(generationProvider, () => {
  if (!allowSong.value) {
    withMelody.value = false;
  }
});

const loadEditTarget = async () => {
  if (!isEditMode.value) return;

  errorMsg.value = '';
  streamMessage.value = '';

  if (editSrc.value === 'db') {
    try {
      const res = await authFetch(`/api/ai-chords/${editId.value}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || '加载失败');

      prompt.value = String(data?.prompt || data?.name || '').trim() || prompt.value;
      result.value = {
        type: 'song',
        bpm: data?.bpm,
        chordBeats: data?.chordBeats,
        chords: Array.isArray(data?.chords) ? data.chords.map((c) => c?.notes || []) : [],
        melody: Array.isArray(data?.melody) ? data.melody : [],
        genre: data?.genre,
        key: data?.key,
        scale: data?.scale,
        structure: data?.structure,
        sections: Array.isArray(data?.sections) ? data.sections : [],
        desc: data?.desc || '',
      };
      initEditableChordsFromResult(result.value);
      initEditableMelodyFromResult(result.value);
      // 覆盖为用户保存的名称（如果有）
      if (Array.isArray(data?.chords)) {
        editableChords.value = editableChords.value.map((c, i) => {
          const savedName = String(data.chords?.[i]?.name || '').trim();
          if (!savedName) return c;
          return { ...c, name: savedName, autoName: false };
        });
      }
    } catch (e) {
      errorMsg.value = e?.message || '加载失败';
    }
    return;
  }

  const local = getAiChordCollectionById(editId.value);
  if (!local) {
    errorMsg.value = '未找到本地素材';
    return;
  }
  prompt.value = String(local?.prompt || local?.name || '').trim() || prompt.value;
  result.value = {
    type: 'song',
    bpm: local?.bpm,
    chordBeats: local?.chordBeats,
    chords: Array.isArray(local?.chords) ? local.chords.map((c) => c?.notes || []) : [],
    melody: Array.isArray(local?.melody) ? local.melody : [],
    genre: local?.genre,
    key: local?.key,
    scale: local?.scale,
    structure: local?.structure,
    sections: Array.isArray(local?.sections) ? local.sections : [],
    desc: local?.desc || '',
  };
  initEditableChordsFromResult(result.value);
  initEditableMelodyFromResult(result.value);
  if (Array.isArray(local?.chords)) {
    editableChords.value = editableChords.value.map((c, i) => {
      const savedName = String(local.chords?.[i]?.name || '').trim();
      if (!savedName) return c;
      return { ...c, name: savedName, autoName: false };
    });
  }
};

onMounted(() => {
  try {
    templates.value = loadPromptTemplates();
  } catch {
    templates.value = [];
  }
  loadEditTarget();
});
</script>

<template>
  <div class="page pb-12">
    <div class="page-container max-w-5xl">
      <div class="flex items-center justify-between mb-8">
        <div v-reveal class="flex items-center gap-4">
          <UiButton @click="router.push('/library')" variant="ghost" class="px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-semibold">
            <i class="ph-bold ph-arrow-left"></i> 返回
          </UiButton>
          <h2 class="text-2xl font-extrabold text-slate-900">{{ isEditMode ? '编辑和弦素材' : 'AI 生成和弦' }}</h2>
        </div>
        <div v-reveal class="text-xs text-slate-500" v-if="remainingCount !== null">
          未登录今日剩余：{{ remainingCount }} 次
        </div>
      </div>

      <div class="glass-card rounded-2xl border border-white/70 p-6">
        <div class="space-y-4">
          <div>
            <label class="text-sm font-semibold text-slate-700">描述你想要的和弦/和弦进行</label>
            <textarea
              v-model="prompt"
              class="w-full mt-2 input-glass rounded-xl py-3 px-4 text-sm min-h-[96px]"
              placeholder="例如：Lo-fi 夜晚、浮游感、日系城市..."
              :disabled="isCreating"
            ></textarea>
          </div>

          <div class="glass-card rounded-2xl border border-white/70 p-4">
            <button
              type="button"
              class="w-full flex items-center justify-between text-sm font-semibold text-slate-700"
              @click="templatePanelOpen = !templatePanelOpen"
            >
              <span class="flex items-center gap-2"><i class="ph-bold ph-book-open"></i> 提示词模板库</span>
              <i class="ph-bold" :class="templatePanelOpen ? 'ph-caret-up' : 'ph-caret-down'"></i>
            </button>

            <div v-if="templatePanelOpen" class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="space-y-2">
                <div class="text-xs text-slate-500">生成模板</div>
                <select v-model="selectedGenerateTemplateId" class="w-full input-glass rounded-lg px-3 py-2 text-sm">
                  <option value="">选择模板…</option>
                  <option v-for="t in generateTemplates" :key="t.id" :value="t.id">{{ t.title }}</option>
                </select>
                <div class="grid grid-cols-2 gap-2">
                  <UiButton @click="insertGenerateTemplate" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold">插入</UiButton>
                  <UiButton @click="saveCurrentPromptAsTemplate" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold">保存</UiButton>
                </div>
              </div>

              <div class="space-y-2">
                <div class="text-xs text-slate-500">局部编辑模板</div>
                <select v-model="selectedSectionTemplateId" class="w-full input-glass rounded-lg px-3 py-2 text-sm">
                  <option value="">选择模板…</option>
                  <option v-for="t in sectionEditTemplates" :key="t.id" :value="t.id">{{ t.title }}</option>
                </select>
                <div class="grid grid-cols-2 gap-2">
                  <UiButton @click="applySectionEditTemplate('replace')" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold">套用</UiButton>
                  <UiButton @click="applySectionEditTemplate('append')" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold">追加</UiButton>
                </div>
              </div>

              <div class="space-y-2 md:col-span-3">
                <div class="flex items-center justify-between">
                  <div class="text-xs text-slate-500">局部编辑补充提示（用于“重生成/变奏/补旋律”）</div>
                  <UiButton @click="saveCurrentSectionEditPromptAsTemplate" variant="ghost" class="px-3 py-2 rounded-lg text-xs font-semibold">保存为模板</UiButton>
                </div>
                <textarea
                  v-model="sectionEditExtraPrompt"
                  class="w-full input-glass rounded-xl py-3 px-4 text-sm min-h-[84px]"
                  placeholder="例如：更像副歌、更明亮、更有律动，旋律更抓耳…"
                  :disabled="isCreating"
                ></textarea>
              </div>
            </div>
          </div>

          <div class="flex flex-col md:flex-row md:items-center gap-3">
            <label class="inline-flex items-center gap-2 text-sm text-slate-700 font-semibold select-none">
              <input v-model="withMelody" type="checkbox" class="accent-slate-900" :disabled="isCreating || isEditMode || !allowSong" />
              同时生成旋律（一次生成和弦+旋律）
            </label>
            <div class="text-xs text-slate-500" v-if="!allowSong">仅大模型支持旋律</div>
            <div v-if="editableMelody.length" class="text-xs text-slate-500">
              BPM：{{ bpm }}，每个和弦：{{ chordBeats }} 拍
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div class="text-xs text-slate-500 mb-1">生成模型</div>
              <select v-model="generationProvider" class="w-full input-glass rounded-lg px-3 py-2 text-sm" :disabled="isCreating">
                <option value="auto">自动（优先本地和弦模型）</option>
                <option value="local-chord">本地和弦模型</option>
                <option value="local-roman">本地 Roman 模型</option>
                <option value="llm">大模型（云端）</option>
                <option value="spark">Spark X1.5（云端）</option>
              </select>
            </div>
            <div v-if="generationProvider === 'spark'">
              <div class="text-xs text-slate-500 mb-1">思考模式</div>
              <select v-model="sparkThinking" class="w-full input-glass rounded-lg px-3 py-2 text-sm" :disabled="isCreating">
                <option value="enabled">开启（更强推理）</option>
                <option value="auto">自动</option>
                <option value="disabled">关闭（更快）</option>
              </select>
            </div>
          </div>

          <div v-if="withMelody" class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div class="text-xs text-slate-500 mb-1">歌曲类型</div>
              <select v-model="genre" class="w-full input-glass rounded-lg px-3 py-2 text-sm" :disabled="isCreating">
                <option value="">自动</option>
                <option value="R&B">R&B</option>
                <option value="Gospel">福音</option>
                <option value="古风">古风</option>
                <option value="说唱">说唱</option>
                <option value="摇滚">摇滚</option>
                <option value="Lo-fi">Lo-fi</option>
                <option value="Pop">流行</option>
              </select>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">BPM</div>
              <input v-model.number="bpm" type="number" min="40" max="240" step="1" class="w-full input-glass rounded-lg px-3 py-2 text-sm" :disabled="isCreating" />
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">调式</div>
              <select v-model="scale" class="w-full input-glass rounded-lg px-3 py-2 text-sm" :disabled="isCreating">
                <option value="major">大调（major）</option>
                <option value="minor">小调（minor）</option>
                <option value="pentatonic">五声音阶（pentatonic）</option>
              </select>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">主调（Key）</div>
              <input v-model="keySig" class="w-full input-glass rounded-lg px-3 py-2 text-sm" placeholder="例如：C / Dm / F#" :disabled="isCreating" />
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">长度（小节）</div>
              <input v-model.number="bars" type="number" min="4" max="128" step="4" class="w-full input-glass rounded-lg px-3 py-2 text-sm" :disabled="isCreating" />
            </div>
            <div class="md:col-span-3">
              <div class="text-xs text-slate-500 mb-1">结构（A/B/副歌）</div>
              <input v-model="structure" class="w-full input-glass rounded-lg px-3 py-2 text-sm" placeholder="例如：A(Verse)-B(Chorus)-A(Verse)-B(Chorus)" :disabled="isCreating" />
            </div>
          </div>

          <div class="flex items-center gap-3">
            <UiButton
              v-if="!isCreating"
              :disabled="!canCreate"
              @click="handleCreate"
              variant="primary"
              class="text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            >
              <i class="ph-fill ph-lightning"></i> 生成
            </UiButton>
            <UiButton
              v-else
              @click="handleCancel"
              variant="ghost"
              class="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            >
              <i class="ph-bold ph-x"></i> 取消
            </UiButton>

            <div class="text-sm text-slate-600" v-if="isCreating || streamMessage">{{ streamMessage }}</div>
          </div>

          <div v-if="(isCreating && progress > 0) || progress === 100" class="w-full">
            <div class="h-2 w-full rounded-full bg-white/60 border border-white/70 overflow-hidden">
              <div class="h-full bg-slate-900/70" :style="{ width: progress + '%' }"></div>
            </div>
            <div class="mt-2 text-xs text-slate-500">{{ progress }}%</div>
          </div>

          <div v-if="errorMsg" class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-700 text-sm flex items-center gap-2">
            <i class="ph-bold ph-warning-circle"></i>
            {{ errorMsg }}
          </div>

          <div v-if="result && result.type === 'NOT_SUPPORT'" class="p-3 bg-amber-500/10 border border-amber-500/25 rounded-lg text-amber-800 text-sm">
            抱歉不支持此命令，当前支持：和弦进行、和弦、旋律+和弦（一次生成）
          </div>

          <div v-if="editableChords.length" class="space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-sm font-semibold text-slate-700">预览</div>
              <div class="flex items-center gap-2">
                <UiButton @click="togglePreviewPlayback" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
                  <i :class="isPreviewPlaying ? 'ph-fill ph-stop' : 'ph-fill ph-play'"></i>
                  {{ isPreviewPlaying ? '停止' : '播放' }}
                </UiButton>
                <UiButton @click="handleImport" variant="primary" class="text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
                  <i class="ph-bold ph-check"></i> {{ isEditMode ? '保存修改' : '导入到素材库' }}
                </UiButton>
              </div>
            </div>

            <div v-if="sectionInfos.length" class="space-y-3">
              <div class="flex items-center justify-between">
                <div class="text-sm font-semibold text-slate-700">段落局部编辑</div>
                <div v-if="sectionEditBusyIndex !== -1" class="text-xs text-slate-500">
                  {{ sectionEditMessage }}（{{ sectionEditProgress }}%）
                </div>
              </div>

              <div v-if="sectionEditError" class="text-sm text-rose-600 whitespace-pre-wrap">{{ sectionEditError }}</div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div v-for="sec in sectionInfos" :key="sec.idx" class="glass-card rounded-2xl border border-white/70 p-4 space-y-3">
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <div class="text-sm font-semibold text-slate-800">
                        {{ sec.name || `Section ${sec.idx + 1}` }}
                        <span v-if="sec.label" class="text-xs text-slate-500 ml-2">{{ sec.label }}</span>
                      </div>
                      <div class="text-xs text-slate-500">
                        bars: {{ sec.bars || '-' }} · chords: {{ sec.chordCount }} · melody: {{ sec.melodyCount }}
                      </div>
                    </div>
                    <div class="text-xs text-slate-500" v-if="sectionEditBusyIndex === sec.idx">处理中…</div>
                  </div>

                  <div class="flex flex-wrap gap-2">
                    <UiButton
                      @click="handleSectionAiEdit(sec, 'regenerate')"
                      :disabled="isCreating || sectionEditBusyIndex !== -1"
                      variant="ghost"
                      class="px-3 py-2 rounded-lg text-sm font-semibold"
                    >重生成</UiButton>
                    <UiButton
                      @click="handleSectionAiEdit(sec, 'variation')"
                      :disabled="isCreating || sectionEditBusyIndex !== -1"
                      variant="ghost"
                      class="px-3 py-2 rounded-lg text-sm font-semibold"
                    >变奏</UiButton>
                    <UiButton
                      @click="handleSectionAiEdit(sec, 'add_melody')"
                      :disabled="isCreating || sectionEditBusyIndex !== -1"
                      variant="ghost"
                      class="px-3 py-2 rounded-lg text-sm font-semibold"
                    >补旋律</UiButton>
                    <UiButton
                      @click="addBassToSection(sec)"
                      :disabled="isCreating || sectionEditBusyIndex !== -1"
                      variant="ghost"
                      class="px-3 py-2 rounded-lg text-sm font-semibold"
                    >补低音</UiButton>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select v-model="sectionTransposeTargets[sec.idx]" class="w-full input-glass rounded-lg px-3 py-2 text-sm">
                      <option value="">转调到…</option>
                      <option value="C">C</option>
                      <option value="C#">C#</option>
                      <option value="D">D</option>
                      <option value="Eb">Eb</option>
                      <option value="E">E</option>
                      <option value="F">F</option>
                      <option value="F#">F#</option>
                      <option value="G">G</option>
                      <option value="Ab">Ab</option>
                      <option value="A">A</option>
                      <option value="Bb">Bb</option>
                      <option value="B">B</option>
                    </select>
                    <UiButton
                      @click="transposeSection(sec)"
                      :disabled="isCreating || sectionEditBusyIndex !== -1"
                      variant="ghost"
                      class="px-3 py-2 rounded-lg text-sm font-semibold sm:col-span-2"
                    >转调</UiButton>
                  </div>

                  <div class="text-xs text-slate-500">
                    提示：重生成/变奏/补旋律会调用 AI；补低音/转调为本地处理。
                  </div>
                </div>
              </div>
            </div>

            <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
              <table class="w-full text-left">
                <thead class="bg-white/40 text-slate-600 text-xs uppercase font-semibold">
                  <tr>
                    <th class="px-6 py-4">和弦</th>
                    <th class="px-6 py-4">音符</th>
                    <th class="px-6 py-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200/70">
                  <tr v-for="(block, idx) in editableChords" :key="block.id" class="hover:bg-white/35 transition group">
                    <td class="px-6 py-4">
                      <div class="flex items-center gap-3">
                        <button
                          class="w-8 h-8 rounded-lg bg-white/60 border border-white/70 backdrop-blur-xl flex items-center justify-center text-slate-700 group-hover:text-teal-700 transition shadow-[0_18px_45px_-40px_rgba(34,199,184,0.55)]"
                          @click="playOne(block)"
                          aria-label="播放"
                        >
                          <i class="ph-fill ph-play"></i>
                        </button>
                        <input
                          v-model="block.name"
                          @input="markManualName(block)"
                          class="w-40 input-glass rounded-lg px-3 py-2 text-sm font-semibold text-slate-900"
                          placeholder="和弦名称"
                        />
                      </div>
                    </td>
                    <td class="px-6 py-4 text-slate-700 text-sm font-mono">
                      <input
                        v-model="block.notesText"
                        @change="applyNotesText(block, idx)"
                        @blur="applyNotesText(block, idx)"
                        class="w-full input-glass rounded-lg px-3 py-2 text-sm font-mono"
                        placeholder="例如：C4 E4 G4（用空格或逗号分隔）"
                      />
                    </td>
                    <td class="px-6 py-4 text-right"></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="result?.desc" class="text-sm text-slate-600">
              {{ result.desc }}
            </div>

            <div v-if="withMelody && (songMeta.genre || songMeta.key || songMeta.scale || songMeta.structure)" class="text-xs text-slate-500">
              <span v-if="songMeta.genre">类型：{{ songMeta.genre }} </span>
              <span v-if="songMeta.key">主调：{{ songMeta.key }} </span>
              <span v-if="songMeta.scale">调式：{{ songMeta.scale }} </span>
              <span v-if="songMeta.structure">结构：{{ songMeta.structure }}</span>
            </div>

            <div v-if="editableMelody.length" class="space-y-2">
              <div class="text-sm font-semibold text-slate-700">旋律（单声部）</div>
              <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
                <table class="w-full text-left">
                  <thead class="bg-white/40 text-slate-600 text-xs uppercase font-semibold">
                    <tr>
                      <th class="px-6 py-4">音符</th>
                      <th class="px-6 py-4">时值（拍）</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-200/70">
                    <tr v-for="m in editableMelody" :key="m.id" class="hover:bg-white/35 transition">
                      <td class="px-6 py-4">
                        <input v-model="m.note" class="w-40 input-glass rounded-lg px-3 py-2 text-sm font-mono" placeholder="例如：E5 或 REST" />
                      </td>
                      <td class="px-6 py-4">
                        <input v-model.number="m.durBeats" type="number" step="0.25" min="0.125" max="16" class="w-28 input-glass rounded-lg px-3 py-2 text-sm" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="text-xs text-slate-500">提示：REST 表示休止</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
