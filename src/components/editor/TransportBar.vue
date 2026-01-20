<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import UiButton from '../UiButton.vue';

const props = defineProps({
  projectId: { type: String, default: '' },
  title: { type: String, default: '' },
  transport: { type: Object, required: true },
  isPlaying: { type: Boolean, default: false },
  isImporting: { type: Boolean, default: false },
  isSavingDraft: { type: Boolean, default: false },
  snapEnabled: { type: Boolean, default: true },
  autoCrossfade: { type: Boolean, default: true },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
  isRegionDrawing: { type: Boolean, default: false },
});

const emit = defineEmits([
  'togglePlay',
  'undo',
  'redo',
  'update:bpm',
  'update:grid',
  'update:timeSignature',
  'update:loopRange',
  'update:snapEnabled',
  'update:autoCrossfade',
  'addMarker',
  'addRegion',
  'cancelRegionDraw',
  'importAudio',
  'publish',
  'export',
  'open-fx',
  'open-versions',
  'new-project',
  'clear-project',
  'save-draft',
]);

const router = useRouter();

const fileInputRef = ref(null);

const bpmDraft = ref(Number(props.transport?.bpm ?? 120));
watch(
  () => props.transport?.bpm,
  (v) => {
    const next = Number(v);
    if (Number.isFinite(next)) bpmDraft.value = next;
  }
);

const gridDraft = ref(String(props.transport?.grid ?? '1/16'));
watch(
  () => props.transport?.grid,
  (v) => {
    if (typeof v === 'string') gridDraft.value = v;
  }
);

const tsNumDraft = ref(Number(props.transport?.timeSignature?.numerator ?? 4));
const tsDenDraft = ref(Number(props.transport?.timeSignature?.denominator ?? 4));
watch(
  () => [props.transport?.timeSignature?.numerator, props.transport?.timeSignature?.denominator],
  ([n, d]) => {
    const nn = Number(n);
    const dd = Number(d);
    if (Number.isFinite(nn)) tsNumDraft.value = nn;
    if (Number.isFinite(dd)) tsDenDraft.value = dd;
  }
);

const loopEnabledDraft = ref(Boolean(props.transport?.loopRange?.enabled));
const loopStartDraft = ref(Number(props.transport?.loopRange?.start ?? 0));
const loopEndDraft = ref(Number(props.transport?.loopRange?.end ?? 8));
watch(
  () => [props.transport?.loopRange?.enabled, props.transport?.loopRange?.start, props.transport?.loopRange?.end],
  ([en, s, e]) => {
    loopEnabledDraft.value = Boolean(en);
    const ss = Number(s);
    const ee = Number(e);
    if (Number.isFinite(ss)) loopStartDraft.value = ss;
    if (Number.isFinite(ee)) loopEndDraft.value = ee;
  }
);

const formatTime = (seconds) => {
  const s = Math.max(0, Number(seconds) || 0);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${mm}:${ss}`;
};

const timeLabel = computed(() => formatTime(props.transport?.playhead ?? 0));
const tsLabel = computed(() => {
  const ts = props.transport?.timeSignature;
  const n = Number(ts?.numerator || 4);
  const d = Number(ts?.denominator || 4);
  return `${n}/${d}`;
});

const commitBpm = () => {
  const next = Number(bpmDraft.value);
  if (!Number.isFinite(next)) return;
  emit('update:bpm', Math.max(20, Math.min(300, next)));
};

const commitGrid = () => {
  emit('update:grid', String(gridDraft.value || '1/16'));
};

const commitTimeSignature = () => {
  let n = Math.round(Number(tsNumDraft.value) || 4);
  let d = Math.round(Number(tsDenDraft.value) || 4);
  n = Math.max(1, Math.min(32, n));
  // Common denominators only.
  const allowed = new Set([1, 2, 4, 8, 16, 32]);
  if (!allowed.has(d)) d = 4;
  emit('update:timeSignature', { numerator: n, denominator: d });
};

const commitLoopRange = () => {
  const start = Math.max(0, Number(loopStartDraft.value) || 0);
  const end = Math.max(0, Number(loopEndDraft.value) || 0);
  emit('update:loopRange', { enabled: Boolean(loopEnabledDraft.value), start, end });
};

const triggerImport = () => fileInputRef.value?.click?.();

const onPickFile = (e) => {
  const file = e?.target?.files?.[0];
  if (!file) return;
  emit('importAudio', file);
  e.target.value = '';
};
</script>

<template>
  <header class="h-16 border-b border-white/70 glass flex items-center justify-between px-4 shrink-0">
    <div class="flex items-center gap-3 min-w-0">
      <UiButton
        variant="ghost"
        class="px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-2"
        @click="router.push('/')"
      >
        <i class="ph-bold ph-house"></i>
        首页
      </UiButton>

      <div class="h-6 w-px bg-slate-200/80 mx-1"></div>

      <div class="min-w-0">
        <div class="text-sm font-extrabold text-slate-900 truncate">
          {{ title || 'Studio' }}
        </div>
        <div class="text-[11px] text-slate-500 font-mono truncate">
          {{ projectId ? `#${projectId}` : 'mock project' }} · {{ tsLabel }} · {{ transport.grid }}
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2 flex-wrap justify-end">
      <UiButton
        variant="ghost"
        class="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-semibold"
        :disabled="!canUndo"
        aria-label="撤销"
        @click="emit('undo')"
      >
        <i class="ph-bold ph-arrow-counter-clockwise"></i>
      </UiButton>
      <UiButton
        variant="ghost"
        class="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-semibold"
        :disabled="!canRedo"
        aria-label="重做"
        @click="emit('redo')"
      >
        <i class="ph-bold ph-arrow-clockwise"></i>
      </UiButton>

      <button
        class="w-9 h-9 bg-white/70 border border-white/70 backdrop-blur-xl rounded-full flex items-center justify-center text-slate-900 transition shadow-[0_18px_45px_-35px_rgba(34,199,184,0.55)] hover:scale-[1.03]"
        @click="emit('togglePlay')"
        :aria-label="isPlaying ? '暂停' : '播放'"
      >
        <i v-if="isPlaying" class="ph-fill ph-pause text-xl"></i>
        <i v-else class="ph-fill ph-play text-xl ml-0.5"></i>
      </button>

      <UiButton
        variant="ghost"
        class="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-semibold"
        aria-label="添加标记点"
        @click="emit('addMarker')"
      >
        <i class="ph-bold ph-bookmark-simple"></i>
        标记
      </UiButton>
      <UiButton
        variant="ghost"
        class="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-semibold"
        aria-label="添加区域"
        @click="emit('addRegion')"
      >
        <i class="ph-bold ph-selection-plus"></i>
        区域
      </UiButton>
      <div
        v-if="props.isRegionDrawing"
        class="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-100/80 border border-amber-200 text-amber-700"
      >
        <i class="ph-bold ph-pencil"></i>
        绘制中
        <button
          class="ml-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/70 border border-white/70 text-amber-700"
          @click="emit('cancelRegionDraw')"
        >
          取消
        </button>
      </div>

      <input
        ref="fileInputRef"
        type="file"
        accept="audio/wav,audio/x-wav,audio/mpeg,.wav,.mp3"
        class="hidden"
        @change="onPickFile"
      />
      <UiButton
        variant="secondary"
        class="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
        :disabled="isImporting"
        @click="triggerImport"
      >
        <i v-if="isImporting" class="ph-bold ph-spinner animate-spin"></i>
        <i v-else class="ph-bold ph-upload-simple"></i>
        导入音频
      </UiButton>

      <UiButton
        variant="secondary"
        class="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
        @click="emit('open-versions')"
      >
        <i class="ph-bold ph-git-branch"></i>
        版本
      </UiButton>

      <UiButton
        variant="secondary"
        class="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
        :disabled="isSavingDraft"
        @click="emit('save-draft')"
      >
        <i v-if="isSavingDraft" class="ph-bold ph-spinner animate-spin"></i>
        <i v-else class="ph-bold ph-floppy-disk"></i>
        {{ isSavingDraft ? '保存中…' : '保存草稿' }}
      </UiButton>

      <UiButton
        variant="secondary"
        class="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
        @click="emit('new-project')"
      >
        <i class="ph-bold ph-plus"></i>
        新建
      </UiButton>

      <UiButton
        variant="ghost"
        class="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-rose-600"
        @click="emit('clear-project')"
      >
        <i class="ph-bold ph-trash"></i>
        清空
      </UiButton>

      <UiButton
        variant="secondary"
        class="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
        @click="emit('open-fx')"
      >
        <i class="ph-bold ph-waveform"></i>
        FX
      </UiButton>

      <UiButton
        variant="primary"
        class="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-white"
        @click="emit('publish')"
      >
        <i class="ph-bold ph-upload"></i>
        发布
      </UiButton>

      <UiButton
        variant="secondary"
        class="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
        @click="emit('export')"
      >
        <i class="ph-bold ph-download-simple"></i>
        导出
      </UiButton>

      <div class="hidden sm:flex items-center gap-2 bg-white/55 border border-white/70 backdrop-blur-xl p-1 rounded-xl shadow-[0_18px_45px_-40px_rgba(34,199,184,0.35)]">
        <span class="text-slate-600 text-xs font-semibold px-2">节拍</span>
        <input
          v-model.number="bpmDraft"
          type="number"
          min="20"
          max="300"
          class="w-14 bg-transparent text-sm text-center text-slate-900 focus:outline-none"
          @change="commitBpm"
          @blur="commitBpm"
        />
      </div>

      <div class="hidden sm:flex items-center gap-2 bg-white/55 border border-white/70 backdrop-blur-xl p-1 rounded-xl shadow-[0_18px_45px_-40px_rgba(34,199,184,0.25)]">
        <span class="text-slate-600 text-xs font-semibold px-2">拍号</span>
        <input
          v-model.number="tsNumDraft"
          type="number"
          min="1"
          max="32"
          class="w-10 bg-transparent text-sm text-center text-slate-900 focus:outline-none"
          @change="commitTimeSignature"
          @blur="commitTimeSignature"
        />
        <span class="text-slate-500 text-sm font-mono">/</span>
        <select
          v-model.number="tsDenDraft"
          class="bg-transparent text-sm text-slate-900 focus:outline-none pr-2"
          @change="commitTimeSignature"
        >
          <option :value="1">1</option>
          <option :value="2">2</option>
          <option :value="4">4</option>
          <option :value="8">8</option>
          <option :value="16">16</option>
          <option :value="32">32</option>
        </select>
      </div>

      <div class="hidden sm:flex items-center gap-2 bg-white/55 border border-white/70 backdrop-blur-xl p-1 rounded-xl shadow-[0_18px_45px_-40px_rgba(34,199,184,0.25)]">
        <span class="text-slate-600 text-xs font-semibold px-2">网格</span>
        <select
          v-model="gridDraft"
          class="bg-transparent text-sm text-slate-900 focus:outline-none pr-2"
          @change="commitGrid"
        >
          <option value="1/4">1/4</option>
          <option value="1/8">1/8</option>
          <option value="1/16">1/16</option>
          <option value="1/32">1/32</option>
        </select>
      </div>

      <div class="hidden lg:flex items-center gap-2 bg-white/55 border border-white/70 backdrop-blur-xl p-1 rounded-xl shadow-[0_18px_45px_-40px_rgba(34,199,184,0.18)]">
        <button
          class="px-2 py-1 rounded-lg text-xs font-extrabold"
          :class="loopEnabledDraft ? 'text-emerald-800 bg-emerald-500/10 border border-emerald-500/20' : 'text-slate-500'"
          @click="loopEnabledDraft = !loopEnabledDraft; commitLoopRange()"
          :aria-label="loopEnabledDraft ? '关闭循环' : '开启循环'"
        >
          循环
        </button>
        <button
          class="px-2 py-1 rounded-lg text-xs font-extrabold"
          :class="snapEnabled ? 'text-teal-800 bg-teal-500/10 border border-teal-500/20' : 'text-slate-500'"
          @click="emit('update:snapEnabled', !snapEnabled)"
          :aria-label="snapEnabled ? '关闭吸附' : '开启吸附'"
        >
          吸附
        </button>
        <button
          class="px-2 py-1 rounded-lg text-xs font-extrabold"
          :class="autoCrossfade ? 'text-amber-800 bg-amber-500/10 border border-amber-500/20' : 'text-slate-500'"
          @click="emit('update:autoCrossfade', !autoCrossfade)"
          :aria-label="autoCrossfade ? '关闭自动交叉淡化' : '开启自动交叉淡化'"
        >
          交叉
        </button>
        <input
          v-model.number="loopStartDraft"
          type="number"
          min="0"
          step="0.1"
          class="w-16 bg-transparent text-sm text-center text-slate-900 focus:outline-none"
          @change="commitLoopRange"
          @blur="commitLoopRange"
        />
        <span class="text-slate-500 text-sm font-mono">-</span>
        <input
          v-model.number="loopEndDraft"
          type="number"
          min="0"
          step="0.1"
          class="w-16 bg-transparent text-sm text-center text-slate-900 focus:outline-none"
          @change="commitLoopRange"
          @blur="commitLoopRange"
        />
      </div>

      <div class="hidden md:flex items-center gap-2 bg-white/55 border border-white/70 backdrop-blur-xl px-3 py-2 rounded-xl shadow-[0_18px_45px_-40px_rgba(34,199,184,0.20)]">
        <i class="ph-bold ph-timer text-slate-500"></i>
        <span class="font-mono text-sm text-teal-700 font-semibold">{{ timeLabel }}</span>
      </div>
    </div>
  </header>
</template>
