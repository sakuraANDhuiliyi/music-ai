<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import UiButton from '../components/UiButton.vue';
import { identifyChordName } from '../utils/chordIdentify.js';
import { playMelody, playProgression, stopPlayback } from '../utils/chordPlayer.js';

const inputText = ref('');
const errorMsg = ref('');
const result = ref(null);

const editableChords = ref([]);
const editableMelody = ref([]);
const bpm = ref(120);
const chordBeats = ref(4);
const meta = ref({ genre: '', key: '', scale: '', structure: '' });

const stripCodeFences = (text) => {
  let t = String(text || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\s*/m, '');
    t = t.replace(/```\s*$/m, '').trim();
  }
  return t;
};

const extractJsonCandidate = (text) => {
  const t = String(text || '');
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  let start = -1;
  if (firstObj !== -1 && firstArr !== -1) start = Math.min(firstObj, firstArr);
  else start = Math.max(firstObj, firstArr);
  if (start === -1) return null;
  const lastObj = t.lastIndexOf('}');
  const lastArr = t.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end === -1 || end <= start) return null;
  return t.slice(start, end + 1).trim();
};

const parseAiCreatorJson = (text) => {
  const raw = String(text || '');
  const variants = [];
  variants.push(raw.trim());
  variants.push(stripCodeFences(raw));
  variants.push(extractJsonCandidate(stripCodeFences(raw)) || '');
  variants.push(extractJsonCandidate(raw) || '');

  for (const v of variants) {
    if (!v) continue;
    try {
      return JSON.parse(v);
    } catch {
      // continue
    }
  }
  return null;
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
      notes: safeNotes,
      notesText: safeNotes.join(' '),
    };
  });
};

const initEditableMelodyFromResult = (data) => {
  if (!data || data.type !== 'song') {
    editableMelody.value = [];
    meta.value = { genre: '', key: '', scale: '', structure: '' };
    return;
  }

  bpm.value = Math.max(40, Math.min(240, Math.round(Number(data.bpm) || 120)));
  chordBeats.value = Math.max(1, Math.min(16, Number(data.chordBeats) || 4));

  meta.value = {
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

const parseInput = () => {
  errorMsg.value = '';
  result.value = null;
  const parsed = parseAiCreatorJson(inputText.value);
  if (!parsed) {
    errorMsg.value = '未解析到有效 JSON，请确认输出包含 JSON。';
    editableChords.value = [];
    editableMelody.value = [];
    return;
  }
  if (!parsed?.type) {
    errorMsg.value = '缺少 type 字段（chord/song/NOT_SUPPORT）。';
  }
  result.value = parsed;
  initEditableChordsFromResult(parsed);
  initEditableMelodyFromResult(parsed);
};

const clearInput = () => {
  inputText.value = '';
  errorMsg.value = '';
  result.value = null;
  editableChords.value = [];
  editableMelody.value = [];
};

const metaChips = computed(() => {
  const list = [];
  if (meta.value.genre) list.push(`genre: ${meta.value.genre}`);
  if (meta.value.key) list.push(`key: ${meta.value.key}`);
  if (meta.value.scale) list.push(`scale: ${meta.value.scale}`);
  if (meta.value.structure) list.push(`structure: ${meta.value.structure}`);
  if (result.value?.type === 'song') {
    list.push(`bpm: ${bpm.value}`);
    list.push(`chordBeats: ${chordBeats.value}`);
  }
  return list;
});

const playableChords = computed(() => (editableChords.value || []).filter((c) => Array.isArray(c?.notes) && c.notes.length > 0));

const playAll = async () => {
  if (!playableChords.value.length && !editableMelody.value.length) return;
  const perChordSec = (60 / Math.max(40, Math.min(240, Number(bpm.value) || 120))) * (Number(chordBeats.value) || 4);
  if (editableMelody.value?.length) {
    await Promise.all([
      playProgression(playableChords.value, Math.max(0.2, perChordSec)),
      playMelody(editableMelody.value, bpm.value),
    ]);
  } else {
    await playProgression(playableChords.value, Math.max(0.2, perChordSec));
  }
};

onBeforeUnmount(() => {
  stopPlayback();
});
</script>

<template>
  <div class="page pb-12">
    <div class="page-container max-w-5xl">
      <div class="flex items-center justify-between mb-8">
        <div class="flex items-center gap-4">
          <UiButton @click="$router.back()" variant="ghost" class="px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-semibold">
            <i class="ph-bold ph-arrow-left"></i> 返回
          </UiButton>
          <h2 class="text-2xl font-extrabold text-slate-900">AI 和弦测试页</h2>
        </div>
      </div>

      <div class="glass-card rounded-2xl border border-white/70 p-6 space-y-4">
        <div>
          <label class="text-sm font-semibold text-slate-700">粘贴大模型输出（JSON 或含 JSON 的文本）</label>
          <textarea
            v-model="inputText"
            class="w-full mt-2 input-glass rounded-xl py-3 px-4 text-sm min-h-[160px]"
            placeholder="直接粘贴模型输出..."
          ></textarea>
        </div>
        <div class="flex items-center gap-2">
          <UiButton @click="parseInput" class="px-4 py-2 rounded-lg text-sm font-semibold">解析并预览</UiButton>
          <UiButton @click="clearInput" variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold">清空</UiButton>
          <UiButton @click="playAll" variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold">播放预览</UiButton>
        </div>

        <div v-if="errorMsg" class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-700 text-sm flex items-center gap-2">
          <i class="ph-bold ph-warning-circle"></i>
          {{ errorMsg }}
        </div>
      </div>

      <div v-if="result" class="mt-6 space-y-6">
        <div class="glass-card rounded-2xl border border-white/70 p-6 space-y-3">
          <div class="text-sm font-semibold text-slate-700">解析结果</div>
          <div class="text-xs text-slate-500" v-if="metaChips.length">
            <span class="inline-flex flex-wrap gap-2">
              <span v-for="(chip, i) in metaChips" :key="i" class="px-2 py-1 rounded-full bg-slate-100 text-slate-600">{{ chip }}</span>
            </span>
          </div>
          <div v-if="result?.desc" class="text-sm text-slate-600">{{ result.desc }}</div>
          <div v-if="result?.type === 'NOT_SUPPORT'" class="text-sm text-amber-700">{{ result?.desc || '当前输出为 NOT_SUPPORT' }}</div>
        </div>

        <div v-if="editableChords.length" class="glass-card rounded-2xl border border-white/70 overflow-hidden">
          <table class="w-full text-left">
            <thead class="bg-white/40 text-slate-600 text-xs uppercase font-semibold">
              <tr>
                <th class="px-6 py-4">和弦</th>
                <th class="px-6 py-4">音符</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200/70">
              <tr v-for="block in editableChords" :key="block.id" class="hover:bg-white/35 transition">
                <td class="px-6 py-4 text-slate-800 text-sm font-semibold">{{ block.name }}</td>
                <td class="px-6 py-4 text-slate-700 text-sm font-mono">{{ block.notesText }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="editableMelody.length" class="glass-card rounded-2xl border border-white/70 overflow-hidden">
          <table class="w-full text-left">
            <thead class="bg-white/40 text-slate-600 text-xs uppercase font-semibold">
              <tr>
                <th class="px-6 py-4">序号</th>
                <th class="px-6 py-4">音符</th>
                <th class="px-6 py-4">时值 (durBeats)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200/70">
              <tr v-for="(m, idx) in editableMelody" :key="m.id" class="hover:bg-white/35 transition">
                <td class="px-6 py-4 text-slate-500 text-sm">{{ idx + 1 }}</td>
                <td class="px-6 py-4 text-slate-800 text-sm font-mono">{{ m.note }}</td>
                <td class="px-6 py-4 text-slate-700 text-sm">{{ m.durBeats }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>