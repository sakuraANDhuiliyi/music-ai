<script setup>
import { useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { loadAiChordCollections, removeAiChordCollection, updateAiChordCollection } from '../utils/aiChordStorage.js';
import { playMelody, playProgression, stopPlayback } from '../utils/chordPlayer.js';
import { authFetch } from '../composables/useUser.js';
import { identifyChordName } from '../utils/chordIdentify.js';
const router = useRouter();

const hasToken = computed(() => {
  try {
    return Boolean(localStorage.getItem('token'));
  } catch {
    return false;
  }
});

const collections = ref([]);
const errorMsg = ref('');
const isSaving = ref(false);

const copyToast = ref('');
const copyToastTone = ref('ok');
let copyToastTimer = null;

const editingId = ref('');
const editDraft = ref(null);
const editChords = ref([]);
const playingId = ref('');

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

const buildEditDraftFromRow = (row) => {
  const base = {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    prompt: String(row?.prompt || ''),
    desc: String(row?.desc || ''),
    bpm: Math.max(40, Math.min(240, Math.round(Number(row?.bpm) || 120))),
    chordBeats: Math.max(1, Math.min(16, Number(row?.chordBeats) || 4)),
    melody: Array.isArray(row?.melody) ? row.melody : [],
  };
  const chords = Array.isArray(row?.chords) ? row.chords : [];
  const editable = chords.map((c, idx) => {
    const notes = Array.isArray(c?.notes) ? c.notes.map((n) => String(n)).filter(Boolean) : [];
    const savedName = String(c?.name || '').trim();
    const auto = savedName ? savedName : identifyChordName(notes) || `Chord_${idx + 1}`;
    return {
      key: `${base.id}_${idx}`,
      name: savedName || auto,
      autoName: !savedName,
      notes,
      notesText: notes.join(' '),
    };
  });
  return { base, editable };
};

const applyChordNotesText = (block, idx) => {
  if (!block) return;
  const notes = normalizeNotesText(block.notesText);
  block.notes = notes;
  if (!String(block.name || '').trim() || block.autoName) {
    block.name = identifyChordName(notes) || `Chord_${idx + 1}`;
    block.autoName = true;
  }
};

const startEdit = (row) => {
  const id = String(row?.id || '');
  if (!id) return;

  if (editingId.value === id) {
    // toggle off
    editingId.value = '';
    editDraft.value = null;
    editChords.value = [];
    return;
  }

  errorMsg.value = '';
  const payload = collections.value.find((x) => String(x._id || x.id) === String(id)) || row;
  const { base, editable } = buildEditDraftFromRow({ ...row, ...payload });
  editingId.value = id;
  editDraft.value = base;
  editChords.value = editable;
};

const cancelEdit = () => {
  editingId.value = '';
  editDraft.value = null;
  editChords.value = [];
};

const saveEdit = async () => {
  if (!editDraft.value) return;

  const chordsForSave = (editChords.value || [])
    .map((c) => ({
      name: String(c?.name || '').trim(),
      notes: Array.isArray(c?.notes) ? c.notes.map((n) => String(n)).filter(Boolean) : [],
    }))
    .filter((c) => c.notes.length > 0);

  if (!String(editDraft.value.name || '').trim() && !String(editDraft.value.prompt || '').trim()) {
    errorMsg.value = '名称或提示词至少填写一个';
    return;
  }
  if (chordsForSave.length === 0) {
    errorMsg.value = '请至少保留一个包含音符的和弦';
    return;
  }

  isSaving.value = true;
  errorMsg.value = '';
  try {
    const payload = {
      name: String(editDraft.value.name || '').trim(),
      prompt: String(editDraft.value.prompt || '').trim(),
      desc: String(editDraft.value.desc || '').trim(),
      chords: chordsForSave,
      bpm: Math.max(40, Math.min(240, Math.round(Number(editDraft.value.bpm) || 120))),
      chordBeats: Math.max(1, Math.min(16, Number(editDraft.value.chordBeats) || 4)),
      melody: Array.isArray(editDraft.value.melody) ? editDraft.value.melody : [],
    };

    if (hasToken.value) {
      const res = await authFetch(`/api/ai-chords/${editDraft.value.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || '保存失败');
    } else {
      updateAiChordCollection(editDraft.value.id, payload);
    }

    await refresh();
    cancelEdit();
  } catch (e) {
    errorMsg.value = e?.message || '保存失败';
  } finally {
    isSaving.value = false;
  }
};

const rows = computed(() =>
  collections.value.map((c) => ({
    id: c._id || c.id,
    name: c.name,
    type: 'Chord Progression',
    createdAt: c.createdAt,
    prompt: c.prompt,
    chords: c.chords || [],
  }))
);

const refresh = async () => {
  errorMsg.value = '';
  if (!hasToken.value) {
    collections.value = loadAiChordCollections();
    return;
  }
  try {
    const res = await authFetch('/api/ai-chords');
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || '加载失败');
    collections.value = Array.isArray(data) ? data : [];
  } catch (e) {
    errorMsg.value = e?.message || '加载失败';
    // fallback
    collections.value = loadAiChordCollections();
  }
};

const playItem = async (row) => {
  const id = String(row?.id || '');
  if (!id) return;

  if (playingId.value === id) {
    stopPlayback();
    playingId.value = '';
    return;
  }

  stopPlayback();
  playingId.value = id;

  const payload = collections.value.find((x) => String(x._id || x.id) === String(row?.id)) || row;
  const chords = (payload?.chords || []).map((x) => ({ notes: x.notes }));
  const bpm = Math.max(40, Math.min(240, Math.round(Number(payload?.bpm) || 120)));
  const chordBeats = Math.max(1, Math.min(16, Number(payload?.chordBeats) || 4));
  const perChordSec = (60 / bpm) * chordBeats;
  const melody = Array.isArray(payload?.melody) ? payload.melody : [];
  try {
    if (melody.length) {
      await Promise.all([
        playProgression(chords, Math.max(0.2, perChordSec)),
        playMelody(melody, bpm),
      ]);
    } else {
      await playProgression(chords, Math.max(0.2, perChordSec));
    }
  } finally {
    if (playingId.value === id) playingId.value = '';
  }
};

const downloadItem = (row) => {
  const payload = collections.value.find((x) => String(x._id || x.id) === String(row?.id)) || row;
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(row?.name || 'ai-chords').replace(/[\\/:*?\"<>|]/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const writeClipboardText = async (text) => {
  const t = String(text || '');
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    // fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
};

const copyItem = async (row) => {
  const payload = collections.value.find((x) => String(x._id || x.id) === String(row?.id)) || row;
  const exportData = {
    museai: 1,
    kind: 'aiChordCollection',
    version: 1,
    name: payload?.name || '',
    prompt: payload?.prompt || '',
    desc: payload?.desc || '',
    chords: Array.isArray(payload?.chords) ? payload.chords : [],
    bpm: payload?.bpm,
    chordBeats: payload?.chordBeats,
    melody: Array.isArray(payload?.melody) ? payload.melody : [],
    genre: payload?.genre,
    key: payload?.key,
    scale: payload?.scale,
    structure: payload?.structure,
    sections: Array.isArray(payload?.sections) ? payload.sections : [],
  };

  const ok = await writeClipboardText(JSON.stringify(exportData));
  copyToastTone.value = ok ? 'ok' : 'error';
  copyToast.value = ok ? '已复制素材，可到多轨编辑器粘贴' : '复制失败：浏览器限制或权限不足';
  if (copyToastTimer) window.clearTimeout(copyToastTimer);
  copyToastTimer = window.setTimeout(() => {
    copyToast.value = '';
  }, 1800);
};

const editItem = (row) => startEdit(row);

const removeItem = async (row) => {
  if (!hasToken.value) {
    removeAiChordCollection(row?.id);
    await refresh();
    return;
  }
  try {
    const res = await authFetch(`/api/ai-chords/${row?.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || '删除失败');
    await refresh();
  } catch (e) {
    errorMsg.value = e?.message || '删除失败';
  }
};

onMounted(() => {
  refresh();
});

onBeforeUnmount(() => {
  stopPlayback();
  if (copyToastTimer) window.clearTimeout(copyToastTimer);
});
</script>

<template>
  <div class="min-h-screen pt-24 pb-12 px-6">
    <div
      v-if="copyToast"
      class="fixed top-24 right-6 z-[120] glass-card px-4 py-2 rounded-xl border border-white/70 text-sm font-semibold text-slate-800 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <i v-if="copyToastTone === 'ok'" class="ph-bold ph-check-circle text-emerald-600"></i>
        <i v-else class="ph-bold ph-warning-circle text-rose-600"></i>
        {{ copyToast }}
      </div>
    </div>

    <div class="max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-8">
        <div v-reveal class="flex items-center gap-4">
          <UiButton @click="router.push('/')" variant="ghost" class="px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-semibold"><i class="ph-bold ph-arrow-left"></i> 返回</UiButton>
          <h2 class="text-2xl font-extrabold text-slate-900">AI 乐句素材库</h2>
        </div>
        <UiButton v-reveal variant="primary" class="text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2" @click="router.push('/ai-chord')">
          <i class="ph-fill ph-lightning"></i> 生成新素材
        </UiButton>
      </div>
      <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
        <div v-if="errorMsg" class="px-6 py-3 text-sm text-rose-700 bg-rose-500/10 border-b border-rose-500/20">
          {{ errorMsg }}
        </div>
        <table class="w-full text-left">
          <thead class="bg-white/40 text-slate-600 text-xs uppercase font-semibold">
          <tr>
            <th class="px-6 py-4">名称</th>
            <th class="px-6 py-4">类型</th>
            <th class="px-6 py-4">提示词</th>
            <th class="px-6 py-4 text-right">操作</th>
          </tr>
          </thead>
          <template v-if="rows.length">
            <tbody v-for="row in rows" :key="row.id" class="divide-y divide-slate-200/70">
            <tr class="hover:bg-white/35 transition group">
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <button
                    class="w-8 h-8 rounded-lg bg-white/60 border border-white/70 backdrop-blur-xl flex items-center justify-center text-slate-700 group-hover:text-sky-700 transition shadow-[0_18px_45px_-40px_rgba(2,132,199,0.55)]"
                    @click="playItem(row)"
                    aria-label="播放"
                  >
                    <i v-if="playingId === row.id" class="ph-fill ph-stop"></i>
                    <i v-else class="ph-fill ph-play"></i>
                  </button>
                  <span class="text-slate-900 font-semibold">{{ row.name }}</span>
                </div>
              </td>
              <td class="px-6 py-4"><span class="px-2 py-1 rounded-lg bg-white/55 border border-white/70 text-xs text-slate-700 font-semibold">{{ row.type }}</span></td>
              <td class="px-6 py-4 text-slate-700 text-sm">
                <span class="block max-w-[380px] truncate">{{ row.prompt }}</span>
              </td>
              <td class="px-6 py-4 text-right">
                <UiButton variant="ghost" class="px-2 py-2 rounded-lg mr-2" @click="editItem(row)"><i class="ph-bold ph-pencil-simple"></i></UiButton>
                <UiButton variant="ghost" class="px-2 py-2 rounded-lg mr-2" @click="copyItem(row)"><i class="ph-bold ph-copy"></i></UiButton>
                <UiButton variant="ghost" class="px-2 py-2 rounded-lg mr-2" @click="downloadItem(row)"><i class="ph-bold ph-download-simple"></i></UiButton>
                <UiButton variant="ghost" class="px-2 py-2 rounded-lg" @click="removeItem(row)"><i class="ph-bold ph-trash"></i></UiButton>
              </td>
            </tr>

            <tr v-if="editingId === row.id" class="bg-white/25">
              <td colspan="4" class="px-6 py-5">
                <div class="space-y-4">
                  <div class="flex items-center gap-3">
                    <div class="text-sm font-semibold text-slate-700">编辑素材</div>
                    <div class="ml-auto flex items-center gap-2">
                      <UiButton :disabled="isSaving" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold" @click="cancelEdit">取消</UiButton>
                      <UiButton :disabled="isSaving" variant="primary" class="text-white px-4 py-2 rounded-lg text-sm font-semibold" @click="saveEdit">保存修改</UiButton>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div class="text-xs text-slate-500 mb-1">名称</div>
                      <input v-model="editDraft.name" class="w-full input-glass rounded-lg px-3 py-2 text-sm" placeholder="素材名称" />
                    </div>
                    <div>
                      <div class="text-xs text-slate-500 mb-1">提示词</div>
                      <input v-model="editDraft.prompt" class="w-full input-glass rounded-lg px-3 py-2 text-sm" placeholder="生成提示词" />
                    </div>
                  </div>

                  <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
                    <table class="w-full text-left">
                      <thead class="bg-white/40 text-slate-600 text-xs uppercase font-semibold">
                        <tr>
                          <th class="px-6 py-4">和弦</th>
                          <th class="px-6 py-4">音符</th>
                          <th class="px-6 py-4"></th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-200/70">
                        <tr v-for="(block, idx) in editChords" :key="block.key" class="hover:bg-white/35 transition">
                          <td class="px-6 py-4">
                            <input
                              v-model="block.name"
                              @input="block.autoName = false"
                              class="w-40 input-glass rounded-lg px-3 py-2 text-sm font-semibold text-slate-900"
                              placeholder="和弦名称"
                            />
                          </td>
                          <td class="px-6 py-4 text-sm font-mono">
                            <input
                              v-model="block.notesText"
                              @change="applyChordNotesText(block, idx)"
                              @blur="applyChordNotesText(block, idx)"
                              class="w-full input-glass rounded-lg px-3 py-2 text-sm font-mono"
                              placeholder="例如：C4 E4 G4（空格或逗号分隔）"
                            />
                          </td>
                          <td class="px-6 py-4 text-right text-xs text-slate-500">
                            {{ block.notes.length }} 音
                          </td>
                        </tr>
                        <tr v-if="editChords.length === 0">
                          <td colspan="3" class="px-6 py-6 text-center text-slate-500 text-sm">该素材没有和弦数据</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </td>
            </tr>
            </tbody>
          </template>

          <tbody v-else class="divide-y divide-slate-200/70">
            <tr>
              <td colspan="4" class="px-6 py-10 text-center text-slate-500 text-sm">
                还没有导入任何 AI 和弦素材，点击右上角「生成新素材」开始。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
