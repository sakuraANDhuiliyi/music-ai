<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  clip: { type: Object, required: true },
  asset: { type: Object, default: null },
  selected: { type: Boolean, default: false },
  pxPerSecond: { type: Number, default: 96 },
  bpm: { type: Number, default: 120 },
  gridDivision: { type: [Number, String], default: 16 }, // 8 / 16 / 32...
  snapEnabled: { type: Boolean, default: true },
  colorClass: { type: String, default: '' },
});

const emit = defineEmits(['update', 'select']);

const scrollRootRef = inject('timelineScrollEl', ref(null));
const spaceDownRef = inject('timelineSpaceDown', ref(false));

const isInteracting = ref(false);
const interactionMode = ref('');

const wrapRef = ref(null);
const canvasRef = ref(null);
const isVisible = ref(true);
let observer = null;
let rafId = null;
let lastDrawSig = '';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const MIN_LEN = 0.1;

const timeToPx = (timeSec) => Math.round((Number(timeSec) || 0) * props.pxPerSecond);
const pxToTime = (px) => (Number(px) || 0) / props.pxPerSecond;

const parseGridDivision = (val) => {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  const raw = String(val || '').trim();
  const m = raw.match(/1\/(\d+)/);
  const d = m ? Number(m[1]) : Number(raw);
  if (!Number.isFinite(d) || d <= 0) return 16;
  return d;
};

// Snap to nearest grid point using bpm + division (e.g. 16 => 1/16).
const snapTime = (timeSec, gridDivision) => {
  const bpm = Math.max(20, Math.min(300, Number(props.bpm || 120)));
  const div = parseGridDivision(gridDivision);
  const stepSec = (60 / bpm) * (4 / div);
  if (!(stepSec > 0)) return Number(timeSec) || 0;
  return Math.round((Number(timeSec) || 0) / stepSec) * stepSec;
};

const draftStart = ref(null);
const draftLength = ref(null);
const draftOffset = ref(null);
const draftTrackId = ref(null);
const draftTranslateY = ref(0);

const effectiveStart = computed(() => {
  if (isInteracting.value && typeof draftStart.value === 'number') return draftStart.value;
  return Math.max(0, Number(props.clip?.start) || 0);
});
const effectiveLength = computed(() => {
  if (isInteracting.value && typeof draftLength.value === 'number') return draftLength.value;
  return Math.max(MIN_LEN, Number(props.clip?.length) || 0);
});
const effectiveOffset = computed(() => {
  if (isInteracting.value && typeof draftOffset.value === 'number') return draftOffset.value;
  return Math.max(0, Number(props.clip?.offset) || 0);
});

const scheduleDraw = () => {
  if (!isVisible.value) return;
  if (rafId) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = null;
    drawWaveform();
  });
};

const setupObserver = (rootEl) => {
  observer?.disconnect?.();
  observer = null;
  if (!rootEl || !wrapRef.value) return;

  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      isVisible.value = Boolean(entry?.isIntersecting);
      if (isVisible.value) scheduleDraw();
    },
    { root: rootEl, threshold: 0.05 }
  );
  observer.observe(wrapRef.value);
};

const onScroll = () => scheduleDraw();

watch(
  () => scrollRootRef?.value,
  (el, prev) => {
    if (prev) prev.removeEventListener?.('scroll', onScroll);
    if (el) el.addEventListener?.('scroll', onScroll, { passive: true });
    setupObserver(el);
  },
  { immediate: true }
);

watch(
  () => [
    props.asset?.peaks,
    props.asset?.duration,
    effectiveStart.value,
    effectiveLength.value,
    effectiveOffset.value,
    props.pxPerSecond,
  ],
  () => scheduleDraw(),
  { deep: false }
);

onMounted(() => {
  scheduleDraw();
  window.addEventListener('resize', scheduleDraw, { passive: true });
});

onBeforeUnmount(() => {
  observer?.disconnect?.();
  observer = null;
  if (rafId) window.cancelAnimationFrame(rafId);
  rafId = null;
  window.removeEventListener('resize', scheduleDraw);
  scrollRootRef?.value?.removeEventListener?.('scroll', onScroll);
});

const clipName = computed(() => {
  if (!props.asset?.url) return props.clip?.id || 'clip';
  try {
    const raw = String(props.asset.url);
    const last = raw.split('/').pop() || raw;
    return decodeURIComponent(last);
  } catch {
    return String(props.asset.url);
  }
});

const leftPx = computed(() => timeToPx(effectiveStart.value));
const widthPx = computed(() => Math.max(10, timeToPx(effectiveLength.value)));

const translateYPx = computed(() => {
  if (!isInteracting.value) return 0;
  if (interactionMode.value !== 'move') return 0;
  return Number(draftTranslateY.value) || 0;
});

const style = computed(() => ({
  left: `${leftPx.value}px`,
  width: `${widthPx.value}px`,
  transform: translateYPx.value ? `translateY(${Math.round(translateYPx.value)}px)` : undefined,
  zIndex: isInteracting.value ? 60 : props.selected ? 40 : 10,
}));

const drawWaveform = () => {
  const canvas = canvasRef.value;
  const wrap = wrapRef.value;
  if (!canvas || !wrap) return;

  // MIDI preview: draw simple piano-roll rectangles for note events.
  if (props.asset?.type === 'midi') {
    const dur = Math.max(0, Number(props.asset?.duration || 0));
    const clipOffset = Math.max(0, Number(effectiveOffset.value || 0));
    const clipLen = Math.max(0, Number(effectiveLength.value || 0));
    if (!(dur > 0) || !(clipLen > 0)) return;

    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    const sig = `midi:${width}x${height}@${dpr}:${clipOffset}:${clipLen}`;
    if (sig !== lastDrawSig) {
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      lastDrawSig = sig;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const notes = Array.isArray(props.asset?.data?.notes) ? props.asset.data.notes : [];
    if (!notes.length) {
      ctx.fillStyle = 'rgba(148,163,184,0.25)';
      ctx.fillRect(0, Math.floor(height / 2) - 1, width, 2);
      return;
    }

    const visible = notes.filter((n) => {
      const s = Number(n?.start) || 0;
      const d = Number(n?.dur) || 0;
      return s + d > clipOffset && s < clipOffset + clipLen;
    });
    if (!visible.length) return;

    const mids = visible.map((n) => Number(n?.midi)).filter((m) => Number.isFinite(m));
    const minMidi = Math.max(0, Math.min(...mids) - 2);
    const maxMidi = Math.min(127, Math.max(...mids) + 2);
    const span = Math.max(1, maxMidi - minMidi + 1);

    const yForMidi = (m) => {
      const rel = (maxMidi - Number(m)) / span;
      return Math.round(rel * (height - 6)) + 3;
    };

    ctx.fillStyle = 'rgba(34,199,184,0.55)';
    for (const n of visible) {
      const s = Number(n?.start) || 0;
      const d = Math.max(0.02, Number(n?.dur) || 0.12);
      const localS = Math.max(0, s - clipOffset);
      const localE = Math.min(clipLen, s + d - clipOffset);
      if (localE <= 0 || localS >= clipLen) continue;

      const x = Math.round((localS / Math.max(1e-6, clipLen)) * width);
      const w = Math.max(2, Math.round(((localE - localS) / Math.max(1e-6, clipLen)) * width));
      const y = yForMidi(Number(n?.midi) || 60);
      ctx.fillRect(x, y - 2, w, 4);
    }
    return;
  }

  const peaks = props.asset?.peaks;
  const hasPeaks =
    peaks &&
    peaks.kind === 'minmax' &&
    peaks.points &&
    peaks.min instanceof Float32Array &&
    peaks.max instanceof Float32Array;

  const dur = Number(props.asset?.duration || 0);
  const clipOffset = Math.max(0, Number(effectiveOffset.value || 0));
  const clipLen = Math.max(0, Number(effectiveLength.value || 0));
  if (!(dur > 0) || !(clipLen > 0)) return;

  const root = scrollRootRef?.value;

  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const sig = `${width}x${height}@${dpr}:${clipOffset}:${clipLen}:${hasPeaks ? peaks.points : 'na'}`;
  if (sig !== lastDrawSig) {
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    lastDrawSig = sig;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let visibleLeft = rect.left;
  let visibleRight = rect.right;
  if (root) {
    const rootRect = root.getBoundingClientRect();
    visibleLeft = Math.max(visibleLeft, rootRect.left);
    visibleRight = Math.min(visibleRight, rootRect.right);
  }
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);
  if (visibleWidth <= 0.5) return;

  const x0 = clamp(Math.floor(visibleLeft - rect.left), 0, width);
  const x1 = clamp(Math.ceil(x0 + visibleWidth), 0, width);
  const w = Math.max(0, x1 - x0);
  if (w <= 0) return;

  ctx.clearRect(x0, 0, w, height);

  ctx.save();
  ctx.translate(0.5, 0.5);

  const centerY = Math.floor(height / 2);
  const amp = Math.max(1, Math.floor(height / 2) - 6);

  ctx.strokeStyle = hasPeaks ? 'rgba(34,199,184,0.65)' : 'rgba(148,163,184,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();

  if (!hasPeaks) {
    ctx.moveTo(x0, centerY);
    ctx.lineTo(x1, centerY);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const points = Number(peaks.points || 0);
  const startT = clamp(clipOffset, 0, dur);
  const endT = clamp(clipOffset + clipLen, 0, dur);
  const startP = Math.floor((startT / dur) * points);
  const endP = Math.max(startP + 1, Math.ceil((endT / dur) * points));
  const span = Math.max(1, endP - startP);
  const stride = Math.max(1, Math.floor(span / Math.max(1, width)));

  const stepPx = Math.max(1, Math.floor(stride));
  for (let x = x0; x < x1; x += stepPx) {
    const rel = x / Math.max(1, width);
    const idx = clamp(startP + Math.floor(rel * span), 0, points - 1);
    const mn = peaks.min[idx] ?? 0;
    const mx = peaks.max[idx] ?? 0;
    const y1 = centerY - mx * amp;
    const y2 = centerY - mn * amp;
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
  }
  ctx.stroke();
  ctx.restore();
};

const startPan = (event) => {
  const el = scrollRootRef?.value;
  if (!el) return;

  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = el.scrollLeft;
  const startTop = el.scrollTop;

  const onMove = (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.scrollLeft = startLeft - dx;
    el.scrollTop = startTop - dy;
  };

  const onUp = () => window.removeEventListener('pointermove', onMove);

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { once: true });
};

const startInteraction = (mode, event) => {
  const wantPan =
    event.pointerType === 'mouse' &&
    (event.button === 1 || (event.button === 0 && Boolean(spaceDownRef?.value)));
  if (wantPan) {
    startPan(event);
    return;
  }

  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  emit('select', {
    id: props.clip.id,
    additive: Boolean(event.shiftKey),
    toggle: Boolean(event.metaKey || event.ctrlKey),
  });

  isInteracting.value = true;
  const resolvedMode = mode === 'move' && event.shiftKey ? 'slip' : mode;
  interactionMode.value = resolvedMode;

  const snapEnabled = Boolean(props.snapEnabled) && !event.altKey;

  const startX = event.clientX;
  const startY = event.clientY;
  let lastClientX = startX;
  let lastClientY = startY;
  const startScrollLeft = Number(scrollRootRef?.value?.scrollLeft) || 0;
  const baseRate = clamp(Number(props.clip?.playbackRate) || 1, 0.25, 4);
  const base = {
    start: Math.max(0, Number(props.clip?.start) || 0),
    length: Math.max(MIN_LEN, Number(props.clip?.length) || 0),
    offset: Math.max(0, Number(props.clip?.offset) || 0),
    trackId: String(props.clip?.trackId || ''),
  };

  draftStart.value = base.start;
  draftLength.value = base.length;
  draftOffset.value = base.offset;
  draftTrackId.value = base.trackId;
  draftTranslateY.value = 0;
  scheduleDraw();

  const assetDur = Math.max(0, Number(props.asset?.duration || 0));
  const maxLenByAsset =
    assetDur > 0 ? Math.max(MIN_LEN, (assetDur - base.offset) / Math.max(1e-6, baseRate)) : Number.POSITIVE_INFINITY;
  const maxOffsetByAsset =
    assetDur > 0
      ? Math.max(0, assetDur - base.length * Math.max(1e-6, baseRate))
      : Number.POSITIVE_INFINITY;

  const deltaSecFromClientX = (clientX) => {
    const el = scrollRootRef?.value;
    if (!el) return pxToTime((Number(clientX) || 0) - startX);
    const scrollLeftNow = Number(el.scrollLeft) || 0;
    const worldDx = (Number(clientX) || 0) + scrollLeftNow - (startX + startScrollLeft);
    return pxToTime(worldDx);
  };

  const applyDragAt = (clientX, clientY) => {
    lastClientX = Number(clientX) || lastClientX;
    lastClientY = Number(clientY) || lastClientY;

    const deltaY = lastClientY - startY;
    const deltaSec = deltaSecFromClientX(lastClientX);

    if (resolvedMode === 'move') {
      applyMove(deltaSec);
      draftTranslateY.value = deltaY;

      draftTrackId.value = base.trackId;

      try {
        const stack = typeof document.elementsFromPoint === 'function'
          ? document.elementsFromPoint(lastClientX, lastClientY)
          : [document.elementFromPoint(lastClientX, lastClientY)];
        const dragged = wrapRef.value;
        for (const el of stack || []) {
          if (!el) continue;
          if (dragged && (el === dragged || dragged.contains(el))) continue;
          const lane = el.closest?.('[data-track-id]');
          if (lane) {
            const tid = lane.getAttribute('data-track-id');
            if (tid && String(tid) !== String(base.trackId)) {
              draftTrackId.value = String(tid);
              break;
            }
          }
        }
      } catch {
        // ignore
      }
      return;
    }

    if (resolvedMode === 'slip') return applySlip(deltaSec);
    if (resolvedMode === 'resize-right') return applyResizeRight(deltaSec);
    if (resolvedMode === 'resize-left') return applyResizeLeft(deltaSec);
  };

  let autoScrollRaf = 0;
  const autoScrollTick = () => {
    autoScrollRaf = 0;
    if (!isInteracting.value) return;
    const el = scrollRootRef?.value;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const width = Number(el.clientWidth) || 0;
    const maxScrollLeft = Math.max(0, (Number(el.scrollWidth) || 0) - width);
    if (width <= 0 || maxScrollLeft <= 0) {
      autoScrollRaf = window.requestAnimationFrame(autoScrollTick);
      return;
    }

    const margin = Math.max(48, Math.round(width * 0.12));
    const leftEdge = rect.left + margin;
    const rightEdge = rect.right - margin;

    let strength = 0;
    let dir = 0;
    if (lastClientX < leftEdge) {
      dir = -1;
      strength = clamp((leftEdge - lastClientX) / Math.max(1, margin), 0, 1);
    } else if (lastClientX > rightEdge) {
      dir = 1;
      strength = clamp((lastClientX - rightEdge) / Math.max(1, margin), 0, 1);
    }

    if (dir !== 0 && strength > 0) {
      const pxPerFrame = 2 + strength * 22;
      const prev = Number(el.scrollLeft) || 0;
      el.scrollLeft = clamp(prev + dir * pxPerFrame, 0, maxScrollLeft);
      applyDragAt(lastClientX, lastClientY);
      scheduleDraw();
    }

    autoScrollRaf = window.requestAnimationFrame(autoScrollTick);
  };

  const commit = () => {
    const nextStart = typeof draftStart.value === 'number' ? draftStart.value : base.start;
    const nextLen = typeof draftLength.value === 'number' ? draftLength.value : base.length;
    const nextOffset = typeof draftOffset.value === 'number' ? draftOffset.value : base.offset;
    const nextTrack = String(draftTrackId.value || base.trackId || '');

    const patch = {};
    if (resolvedMode === 'move') {
      if (Math.abs(nextStart - base.start) > 1e-6) patch.start = nextStart;
      if (nextTrack && nextTrack !== base.trackId) patch.trackId = nextTrack;
    } else if (resolvedMode === 'slip') {
      if (Math.abs(nextOffset - base.offset) > 1e-6) patch.offset = nextOffset;
    } else if (resolvedMode === 'resize-right') {
      if (Math.abs(nextLen - base.length) > 1e-6) patch.length = nextLen;
    } else if (resolvedMode === 'resize-left') {
      if (Math.abs(nextStart - base.start) > 1e-6) patch.start = nextStart;
      if (Math.abs(nextLen - base.length) > 1e-6) patch.length = nextLen;
      if (Math.abs(nextOffset - base.offset) > 1e-6) patch.offset = nextOffset;
    }

    if (Object.keys(patch).length) emit('update', props.clip.id, patch);

    isInteracting.value = false;
    interactionMode.value = '';
    draftStart.value = null;
    draftLength.value = null;
    draftOffset.value = null;
    draftTrackId.value = null;
    draftTranslateY.value = 0;
    scheduleDraw();
  };

  const maybeSnap = (t) => {
    if (!snapEnabled) return Number(t) || 0;
    return snapTime(t, props.gridDivision);
  };

  const applyMove = (deltaSecRaw) => {
    const raw = Math.max(0, base.start + deltaSecRaw);
    let next = maybeSnap(raw);
    next = Math.max(0, next);
    draftStart.value = next;
  };

  const applySlip = (deltaSecRaw) => {
    const raw = base.offset + deltaSecRaw * Math.max(1e-6, baseRate);
    const next = clamp(raw, 0, maxOffsetByAsset);
    draftOffset.value = next;
  };

  const applyResizeRight = (deltaSecRaw) => {
    const minEnd = base.start + MIN_LEN;
    const maxEnd = Number.isFinite(maxLenByAsset) ? base.start + maxLenByAsset : Number.POSITIVE_INFINITY;

    let end = base.start + base.length + deltaSecRaw;
    end = clamp(end, minEnd, maxEnd);
    end = maybeSnap(end);
    end = clamp(end, minEnd, maxEnd);
    const nextLen = Math.max(MIN_LEN, end - base.start);
    draftLength.value = Math.min(nextLen, maxLenByAsset);
  };

  const applyResizeLeft = (deltaSecRaw) => {
    // Keep: start>=0, offset>=0, length>=MIN_LEN. Overlaps allowed (no collision checks yet).
    const lower = Math.max(-base.start, -base.offset / Math.max(1e-6, baseRate));
    const upper = base.length - MIN_LEN;
    const clamped = clamp(deltaSecRaw, lower, upper);

    const minStart = Math.max(0, base.start + lower);
    const maxStart = base.start + upper;

    let nextStart = base.start + clamped;
    nextStart = clamp(nextStart, minStart, maxStart);
    nextStart = maybeSnap(nextStart);
    nextStart = clamp(nextStart, minStart, maxStart);

    const delta = nextStart - base.start;
    const nextOffset = Math.max(0, base.offset + delta * Math.max(1e-6, baseRate));
    let nextLen = Math.max(MIN_LEN, base.length - delta);
    if (assetDur > 0) nextLen = Math.min(nextLen, Math.max(MIN_LEN, (assetDur - nextOffset) / Math.max(1e-6, baseRate)));

    draftStart.value = nextStart;
    draftOffset.value = nextOffset;
    draftLength.value = nextLen;
  };

  const onMove = (e) => {
    applyDragAt(e.clientX, e.clientY);
    scheduleDraw();
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    if (autoScrollRaf) window.cancelAnimationFrame(autoScrollRaf);
    commit();
  };

  autoScrollRaf = window.requestAnimationFrame(autoScrollTick);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { once: true });
};
</script>

<template>
  <div
    class="clip absolute top-3 h-[66px] rounded-2xl border border-white/70 bg-white/55 backdrop-blur-xl shadow-[0_18px_45px_-45px_rgba(34,199,184,0.55)] cursor-grab active:cursor-grabbing select-none group"
    :class="[
      colorClass || 'border-teal-200/60',
      isInteracting
        ? 'ring-4 ring-teal-300/30 border-teal-300/70'
        : selected
          ? 'ring-4 ring-amber-300/25 border-amber-300/70'
          : 'hover:border-teal-300/70'
    ]"
    :style="style"
    role="button"
    tabindex="0"
    @pointerdown="startInteraction('move', $event)"
    ref="wrapRef"
  >
    <canvas
      ref="canvasRef"
      class="absolute inset-0 pointer-events-none opacity-70 rounded-2xl"
      aria-hidden="true"
    ></canvas>

    <div class="px-3 pt-2.5 flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="text-xs font-extrabold text-slate-900 truncate">{{ clipName }}</div>
        <div class="text-[10px] text-slate-500 font-mono truncate">
          start {{ Number(effectiveStart || 0).toFixed(2) }}s · len {{ Number(effectiveLength || 0).toFixed(2) }}s · off
          {{ Number(effectiveOffset || 0).toFixed(2) }}s
        </div>
      </div>
      <div class="text-[10px] font-bold text-slate-500 bg-white/60 border border-white/70 px-2 py-0.5 rounded-full">
        {{ asset?.type || 'asset' }}
      </div>
    </div>

    <div class="absolute bottom-2 left-3 right-3 flex items-center justify-between text-[10px] text-slate-600 font-semibold">
      <div class="flex items-center gap-2">
        <span class="px-2 py-0.5 rounded-full bg-white/50 border border-white/70">
          gain {{ Number(clip.gain || 0).toFixed(1) }} dB
        </span>
      </div>
      <div class="flex items-center gap-1">
        <span v-if="interactionMode" class="text-teal-700 font-mono">{{ interactionMode }}</span>
      </div>
    </div>

    <!-- Resize handles -->
    <div
      class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition"
      @pointerdown.stop="startInteraction('resize-left', $event)"
      aria-label="Resize left"
    >
      <div class="h-full w-full rounded-l-2xl bg-teal-500/15 border-r border-white/60"></div>
    </div>
    <div
      class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition"
      @pointerdown.stop="startInteraction('resize-right', $event)"
      aria-label="Resize right"
    >
      <div class="h-full w-full rounded-r-2xl bg-teal-500/15 border-l border-white/60"></div>
    </div>
  </div>
</template>
