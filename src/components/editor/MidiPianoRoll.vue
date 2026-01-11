<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  asset: { type: Object, required: true },
  clip: { type: Object, required: true },
  transport: { type: Object, required: true },
  pxPerSecond: { type: Number, default: 96 },
  snapEnabled: { type: Boolean, default: true },
});

const emit = defineEmits(['updateAsset']);

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const parseGridDivision = (val) => {
  const raw = String(val || '').trim();
  const m = raw.match(/1\/(\d+)/);
  const d = m ? Number(m[1]) : Number(raw);
  if (!Number.isFinite(d) || d <= 0) return 16;
  return d;
};

const bpm = computed(() => Math.max(20, Math.min(300, Number(props.transport?.bpm || 120))));
const gridDivision = computed(() => parseGridDivision(props.transport?.grid));
const gridSec = computed(() => (60 / bpm.value) * (4 / gridDivision.value));

const clipLen = computed(() => Math.max(0.1, Number(props.clip?.length) || 0.1));
const clipOffset = computed(() => Math.max(0, Number(props.clip?.offset) || 0));

const notes = computed(() => {
  const list = props.asset?.data?.notes;
  return Array.isArray(list) ? list : [];
});

const visibleNotes = computed(() => {
  const off = clipOffset.value;
  const len = clipLen.value;
  const end = off + len;
  return notes.value.filter((n) => {
    const s = Number(n?.start) || 0;
    const d = Number(n?.dur) || 0;
    return s + d > off && s < end;
  });
});

const pitchRange = computed(() => {
  const list = visibleNotes.value;
  const mids = list.map((n) => Number(n?.midi)).filter((m) => Number.isFinite(m));
  if (!mids.length) return { min: 48, max: 72 };
  const min = Math.min(...mids);
  const max = Math.max(...mids);
  const pad = 6;
  return { min: clamp(min - pad, 0, 127), max: clamp(max + pad, 0, 127) };
});

const rowH = 10;
const pianoHeight = computed(() => Math.max(160, (pitchRange.value.max - pitchRange.value.min + 1) * rowH));

const rollRef = ref(null);
const innerRef = ref(null);
const focused = ref(false);

const widthPx = computed(() => Math.ceil(clipLen.value * props.pxPerSecond));

const snapSec = (sec) => {
  if (!props.snapEnabled) return sec;
  const step = gridSec.value;
  if (!(step > 0)) return sec;
  return Math.round(sec / step) * step;
};

const midiFromY = (y) => {
  const min = pitchRange.value.min;
  const max = pitchRange.value.max;
  const idx = Math.floor(y / rowH);
  const midi = max - idx;
  return clamp(midi, min, max);
};

const yFromMidi = (midi) => {
  const max = pitchRange.value.max;
  const idx = max - Number(midi);
  return idx * rowH;
};

const xToLocalSec = (x) => clamp(x / Math.max(1, props.pxPerSecond), 0, clipLen.value);

const selectedNoteId = ref(null);
const drag = ref(null); // { id, mode, startX, startY, baseStart, baseDur, baseMidi }

const updateNotes = (nextNotes, commit) => {
  emit('updateAsset', props.asset.id, { data: { notes: nextNotes } }, { commit });
};

const findNote = (id) => notes.value.find((n) => String(n?.id) === String(id));

const onKeyDown = (e) => {
  if (!focused.value) return;
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const id = selectedNoteId.value;
  if (!id) return;
  e.preventDefault();
  const next = notes.value.filter((n) => String(n?.id) !== String(id));
  selectedNoteId.value = null;
  updateNotes(next, true);
};

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
});

const startDrag = (noteId, mode, event) => {
  const n = findNote(noteId);
  if (!n) return;
  event.preventDefault();
  event.stopPropagation();

  selectedNoteId.value = String(noteId);

  drag.value = {
    id: String(noteId),
    mode,
    startX: event.clientX,
    startY: event.clientY,
    baseStart: Number(n.start) || 0,
    baseDur: Math.max(0.03, Number(n.dur) || 0.12),
    baseMidi: Number(n.midi) || 60,
  };

  const onMove = (e) => {
    if (!drag.value) return;
    const dxPx = e.clientX - drag.value.startX;
    const dyPx = e.clientY - drag.value.startY;
    const dxSec = dxPx / Math.max(1, props.pxPerSecond);

    const next = notes.value.map((it) => {
      if (String(it?.id) !== String(drag.value.id)) return it;

      if (drag.value.mode === 'resize') {
        const dur = Math.max(0.03, snapSec(drag.value.baseDur + dxSec));
        return { ...it, dur };
      }

      const localBase = drag.value.baseStart - clipOffset.value;
      const local = clamp(localBase + dxSec, 0, clipLen.value - 0.03);
      const start = snapSec(local) + clipOffset.value;
      const midi = midiFromY(yFromMidi(drag.value.baseMidi) + dyPx);
      return { ...it, start, midi };
    });

    updateNotes(next, false);
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    drag.value = null;
    // Commit latest state.
    updateNotes(notes.value.slice(), true);
  };

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp, { once: true });
};

const onBackgroundDblClick = (event) => {
  const el = rollRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left + el.scrollLeft, 0, widthPx.value);
  const y = clamp(event.clientY - rect.top + el.scrollTop, 0, pianoHeight.value);

  const local = snapSec(xToLocalSec(x));
  const start = clipOffset.value + local;
  const dur = Math.max(0.03, gridSec.value);
  const midi = midiFromY(y);

  const id = `note_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  const next = [...notes.value, { id, midi, start, dur, velocity: 0.85 }].sort((a, b) => (a.start || 0) - (b.start || 0));
  selectedNoteId.value = id;
  updateNotes(next, true);
};

watch(
  () => props.asset?.id,
  () => {
    selectedNoteId.value = null;
    drag.value = null;
  }
);
</script>

<template>
  <div class="h-64 border-t border-white/60 bg-white/20 backdrop-blur-xl">
    <div class="px-4 py-2 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-extrabold text-slate-900 truncate">MIDI 钢琴卷帘</div>
        <div class="text-[11px] text-slate-500 font-mono truncate">
          双击空白新增音符 · 拖动移动 · 右侧拖拽改时值 · Delete 删除
        </div>
      </div>
      <div class="text-[11px] text-slate-600 font-mono">
        grid {{ transport.grid }} · bpm {{ transport.bpm }}
      </div>
    </div>

    <div
      ref="rollRef"
      class="mx-4 mb-3 rounded-xl border border-white/70 bg-white/35 overflow-auto relative"
      :style="{ height: 'calc(100% - 44px)' }"
      tabindex="0"
      @focus="focused = true"
      @blur="focused = false"
      @dblclick="onBackgroundDblClick"
    >
      <div
        ref="innerRef"
        class="relative"
        :style="{ width: widthPx + 'px', height: pianoHeight + 'px' }"
      >
        <!-- Grid (vertical by gridSec) -->
        <div
          v-for="i in Math.ceil(clipLen / gridSec)"
          :key="i"
          class="absolute top-0 bottom-0 w-px bg-slate-200/70"
          :style="{ left: Math.round((i - 1) * gridSec * pxPerSecond) + 'px' }"
        ></div>

        <!-- Horizontal pitch lines -->
        <div
          v-for="m in (pitchRange.max - pitchRange.min + 1)"
          :key="m"
          class="absolute left-0 right-0 h-px"
          :class="m % 12 === 1 || m % 12 === 4 || m % 12 === 6 || m % 12 === 9 || m % 12 === 11 ? 'bg-slate-200/60' : 'bg-slate-200/35'"
          :style="{ top: (m - 1) * rowH + 'px' }"
        ></div>

        <!-- Notes -->
        <div
          v-for="n in visibleNotes"
          :key="n.id"
          class="absolute rounded-md border border-white/70 bg-white/65 text-slate-900 shadow-sm"
          :class="String(selectedNoteId) === String(n.id) ? 'ring-4 ring-sky-300/30' : ''"
          :style="{
            left: Math.round((Math.max(0, (Number(n.start) || 0) - clipOffset) * pxPerSecond)) + 'px',
            top: Math.round(yFromMidi(Number(n.midi) || 60)) + 'px',
            width: Math.max(8, Math.round(Math.max(0.03, Number(n.dur) || 0.12) * pxPerSecond)) + 'px',
            height: (rowH - 2) + 'px',
          }"
          @pointerdown="startDrag(n.id, 'move', $event)"
        >
          <div
            class="absolute top-0 right-0 h-full w-2 cursor-ew-resize bg-slate-900/10 rounded-r-md"
            @pointerdown="startDrag(n.id, 'resize', $event)"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>
