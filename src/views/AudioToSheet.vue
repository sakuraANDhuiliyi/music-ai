<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { authFetch, useUser } from '../composables/useUser.js';
import { API_ENDPOINTS } from '../config/appConfig.js';
import UiButton from '../components/UiButton.vue';

const router = useRouter();
const { user } = useUser();

const file = ref(null);
const isRunning = ref(false);
const error = ref('');
const result = ref(null);

const maxSeconds = ref(45);
const grid = ref(16);
const polyphony = ref(4);
const sr = ref(22050);
const separate = ref('hpss'); // hpss | none

const canRun = computed(() => Boolean(user.value) && Boolean(file.value) && !isRunning.value);

const pickFile = (e) => {
  const f = e?.target?.files?.[0];
  file.value = f || null;
  error.value = '';
  result.value = null;
};

const run = async () => {
  if (!user.value) return router.push('/login');
  if (!file.value) return;

  error.value = '';
  result.value = null;
  isRunning.value = true;

  try {
    const fd = new FormData();
    fd.append('file', file.value);
    fd.append('maxSeconds', String(maxSeconds.value));
    fd.append('grid', String(grid.value));
    fd.append('polyphony', String(polyphony.value));
    fd.append('sr', String(sr.value));
    fd.append('separate', String(separate.value));

    const res = await authFetch(API_ENDPOINTS.audioToSheet, { method: 'POST', body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || '转谱失败');
    if (!data?.ok) throw new Error(data?.message || '转谱失败');
    result.value = data;
  } catch (e) {
    error.value = e?.message || '转谱失败，请稍后重试';
  } finally {
    isRunning.value = false;
  }
};

const copySheet = async () => {
  const text = result.value?.sheet || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
};

const downloadSheet = () => {
  const text = result.value?.sheet || '';
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'piano_sheet.txt';
  a.click();
  URL.revokeObjectURL(url);
};

const buildMidiNotesFromResult = (payload) => {
  const list = Array.isArray(payload?.midiNotes) ? payload.midiNotes : [];
  if (list.length) return list;
  const tickSeconds = Number(payload?.tickSeconds || 0);
  const events = Array.isArray(payload?.events) ? payload.events : [];
  if (!(tickSeconds > 0) || !events.length) return [];
  const notes = [];
  for (const ev of events) {
    const tick = Number(ev?.tick) || 0;
    const start = tick * tickSeconds;
    const ns = Array.isArray(ev?.notes) ? ev.notes : [];
    for (const midi of ns) {
      const m = Number(midi);
      if (!Number.isFinite(m)) continue;
      notes.push({ midi: Math.round(m), start, dur: tickSeconds, velocity: 0.8 });
    }
  }
  return notes;
};

const importToStudio = () => {
  const notes = buildMidiNotesFromResult(result.value || {});
  if (!notes.length) return;
  const key = `studio:importMidi:${Date.now()}`;
  try {
    localStorage.setItem(key, JSON.stringify({ notes, title: '转谱导入' }));
  } catch {
    return;
  }
  router.push({ name: 'Studio', query: { importMidiKey: key } });
};
</script>

<template>
  <div class="page pb-16">
    <div class="page-container max-w-5xl space-y-6">
      <div v-reveal class="glass-card rounded-2xl p-6 border border-white/70">
        <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div class="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <i class="ph-bold ph-waveform text-teal-600"></i>
              音频转钢琴键位文字谱
            </div>
            <div class="text-xs text-slate-500 font-semibold mt-1">
              低配友好：HPSS（谐波/打击）分离 + 频谱峰值转谱。建议上传 30~60 秒以内的 WAV/FLAC。
            </div>
          </div>

          <UiButton
            v-if="!user"
            variant="primary"
            class="px-5 py-2.5 rounded-xl text-white font-semibold"
            @click="router.push('/login')"
          >
            登录后使用
          </UiButton>
        </div>

        <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="glass-card rounded-2xl p-5 border border-white/70">
            <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <i class="ph-bold ph-upload-simple text-teal-600"></i>
              上传音频
            </div>
            <div class="mt-3">
              <input
                type="file"
                accept="audio/*"
                class="block w-full text-sm text-slate-700 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-white/70 file:text-slate-900 hover:file:bg-white/80"
                @change="pickFile"
              />
              <div class="mt-2 text-xs text-slate-500 font-semibold">
                提示：若 mp3 无法解析，请先转为 wav（电脑未安装 ffmpeg 时常见）。
              </div>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div class="text-[11px] font-bold text-slate-600 mb-1">最长处理（秒）</div>
                <input v-model.number="maxSeconds" type="number" min="5" max="300" class="w-full input-glass rounded-xl px-3 py-2 text-sm" />
              </div>
              <div>
                <div class="text-[11px] font-bold text-slate-600 mb-1">采样率</div>
                <select v-model.number="sr" class="w-full input-glass rounded-xl px-3 py-2 text-sm">
                  <option :value="16000">16000（更快）</option>
                  <option :value="22050">22050（推荐）</option>
                  <option :value="44100">44100（更准更慢）</option>
                </select>
              </div>
              <div>
                <div class="text-[11px] font-bold text-slate-600 mb-1">节奏网格</div>
                <select v-model.number="grid" class="w-full input-glass rounded-xl px-3 py-2 text-sm">
                  <option :value="8">8（八分）</option>
                  <option :value="16">16（十六分）</option>
                  <option :value="32">32（更细更慢）</option>
                </select>
              </div>
              <div>
                <div class="text-[11px] font-bold text-slate-600 mb-1">复调上限</div>
                <input v-model.number="polyphony" type="number" min="1" max="8" class="w-full input-glass rounded-xl px-3 py-2 text-sm" />
              </div>
              <div class="col-span-2">
                <div class="text-[11px] font-bold text-slate-600 mb-1">分离方式</div>
                <select v-model="separate" class="w-full input-glass rounded-xl px-3 py-2 text-sm">
                  <option value="hpss">hpss（谐波/打击分离）</option>
                  <option value="none">none（不分离，更快但更噪）</option>
                </select>
              </div>
            </div>

            <div class="mt-4 flex items-center gap-2">
              <UiButton
                variant="primary"
                class="px-5 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50"
                :disabled="!canRun"
                @click="run"
              >
                <i v-if="isRunning" class="ph-bold ph-spinner animate-spin"></i>
                开始转谱
              </UiButton>
              <div v-if="isRunning" class="text-xs text-slate-500 font-semibold">
                正在处理…（低配可能需要几十秒）
              </div>
            </div>

            <div
              v-if="error"
              class="mt-4 glass-card rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-700 text-sm font-semibold px-4 py-3 flex items-center gap-2"
            >
              <i class="ph-bold ph-warning-circle"></i>
              {{ error }}
            </div>
          </div>

          <div class="glass-card rounded-2xl p-5 border border-white/70">
            <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <i class="ph-bold ph-file-text text-teal-600"></i>
              输出（键位文字谱）
            </div>

            <div v-if="!result && !isRunning" class="mt-6 text-sm text-slate-500 font-semibold">
              运行后会在这里显示转换结果：单音符如 <span class="text-slate-900 font-extrabold">t</span>，和弦如
              <span class="text-slate-900 font-extrabold">[ty]</span>，停顿用空格/ <span class="text-slate-900 font-extrabold">|</span>。
            </div>

            <div v-else class="mt-4 space-y-3">
              <div v-if="result" class="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                <span class="px-2 py-1 rounded-lg bg-white/55 border border-white/70">
                  BPM：<span class="text-slate-900 font-extrabold">{{ Math.round(result.tempo || 0) }}</span>
                </span>
                <span class="px-2 py-1 rounded-lg bg-white/55 border border-white/70">
                  网格：<span class="text-slate-900 font-extrabold">{{ result.grid }}</span>
                </span>
                <span class="px-2 py-1 rounded-lg bg-white/55 border border-white/70">
                  事件数：<span class="text-slate-900 font-extrabold">{{ result.events?.length || 0 }}</span>
                </span>
              </div>

              <textarea
                v-if="result"
                class="w-full h-72 input-glass rounded-2xl px-4 py-3 text-sm font-mono text-slate-800"
                readonly
                :value="result.sheet"
              />

              <div class="flex items-center gap-2">
                <UiButton
                  v-if="result?.sheet"
                  variant="secondary"
                  class="px-4 py-2 rounded-xl text-xs font-semibold"
                  @click="copySheet"
                >
                  <i class="ph-bold ph-copy"></i>
                  复制
                </UiButton>
                <UiButton
                  v-if="result?.sheet"
                  variant="secondary"
                  class="px-4 py-2 rounded-xl text-xs font-semibold"
                  @click="downloadSheet"
                >
                  <i class="ph-bold ph-download-simple"></i>
                  下载 .txt
                </UiButton>
                <UiButton
                  v-if="result"
                  variant="primary"
                  class="px-4 py-2 rounded-xl text-xs font-semibold text-white"
                  @click="importToStudio"
                >
                  <i class="ph-bold ph-upload-simple"></i>
                  导入 Studio
                </UiButton>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-reveal class="glass-card rounded-2xl p-6 border border-white/70">
        <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <i class="ph-bold ph-lightbulb text-teal-600"></i>
          提升精度的小建议（低配）
        </div>
        <ul class="mt-3 text-sm text-slate-600 font-semibold space-y-2 list-disc pl-5">
          <li>尽量上传钢琴或主旋律更清晰的音频；鼓点很强的混音会显著干扰转谱。</li>
          <li>把音频裁剪到 30~60 秒做实验，确认参数后再转完整片段。</li>
          <li>若出现大小写混合的和弦，本工具会自动拆成两段（避免 Shift 物理冲突）。</li>
        </ul>
      </div>
    </div>
  </div>
</template>
