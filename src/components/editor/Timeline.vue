<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import ClipBlock from './ClipBlock.vue';

const props = defineProps({
  transport: { type: Object, required: true },
  tracks: { type: Array, required: true },
  assets: { type: Array, required: true },
  clips: { type: Array, required: true },
  markers: { type: Array, default: () => [] },
  regions: { type: Array, default: () => [] },
  isPlaying: { type: Boolean, default: false },
  selectedClipIds: { type: Array, default: () => [] },
  pxPerSecond: { type: Number, default: 96 },
  snapEnabled: { type: Boolean, default: true },
  isRegionDrawing: { type: Boolean, default: false },
});

const emit = defineEmits([
  'updatePlayhead',
  'previewPlayhead',
  'scrubStart',
  'updateClip',
  'updateRegion',
  'deleteRegion',
  'createRegion',
  'finishRegionDraw',
  'selectClip',
  'setSelection',
  'updateZoom',
]);

const scrollEl = ref(null);
const gridRef = ref(null);
const rulerRef = ref(null);
provide('timelineScrollEl', scrollEl);

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const selectedSet = computed(() => new Set((props.selectedClipIds || []).map((x) => String(x))));
const isSelected = (id) => selectedSet.value.has(String(id));
const snapEnabled = computed(() => Boolean(props.snapEnabled));

const parseGridDenom = (grid) => {
  const raw = String(grid || '');
  const m = raw.match(/1\/(\d+)/);
  if (!m) return 16;
  const d = Number(m[1]);
  return Number.isFinite(d) && d > 0 ? d : 16;
};

const bpm = computed(() => Math.max(20, Math.min(300, Number(props.transport?.bpm || 120))));
const ts = computed(() => props.transport?.timeSignature || { numerator: 4, denominator: 4 });
const beatSec = computed(() => {
  const denom = Number(ts.value?.denominator || 4);
  return (60 / bpm.value) * (4 / (denom || 4));
});
const barSec = computed(() => Math.max(beatSec.value, beatSec.value * Number(ts.value?.numerator || 4)));

const gridDenom = computed(() => parseGridDenom(props.transport?.grid));
const gridSec = computed(() => (60 / bpm.value) * (4 / gridDenom.value));
const snapTime = (timeSec) => {
  if (!snapEnabled.value) return Number(timeSec) || 0;
  const step = Number(gridSec.value) || 0;
  if (!(step > 0)) return Number(timeSec) || 0;
  return Math.round((Number(timeSec) || 0) / step) * step;
};
const pxToTime = (px) => (Number(px) || 0) / Math.max(1, props.pxPerSecond);

const maxEnd = computed(() => {
  const list = Array.isArray(props.clips) ? props.clips : [];
  const ends = list.map((c) => (Number(c?.start) || 0) + (Number(c?.length) || 0));
  const max = Math.max(0, ...ends);
  // Keep some room to scrub / paste at the end.
  return Math.max(16, max + 4);
});

const contentWidth = computed(() => Math.max(1200, Math.ceil(maxEnd.value * props.pxPerSecond) + 240));
const playheadX = computed(() => Math.round((Number(props.transport?.playhead) || 0) * props.pxPerSecond));

// =========================
// Auto-follow playhead
// =========================
const followLockUntilMs = ref(0);
let followRaf = 0;
let pendingPlayheadX = 0;
let lastAutoScrollAtMs = 0;

const isScrubbing = ref(false);
const isSelecting = ref(false);
const isPanning = ref(false);

const scheduleFollow = (x) => {
  pendingPlayheadX = Number(x) || 0;
  if (followRaf) return;
  followRaf = window.requestAnimationFrame(() => {
    followRaf = 0;
    followPlayheadIfNeeded(pendingPlayheadX);
  });
};

const followPlayheadIfNeeded = (x) => {
  if (!props.isPlaying) return;
  if (isScrubbing.value || isSelecting.value || isPanning.value) return;
  const el = scrollEl.value;
  if (!el) return;

  const now = Date.now();
  if (now < followLockUntilMs.value) return;

  const left = Number(el.scrollLeft) || 0;
  const width = Number(el.clientWidth) || 0;
  const right = left + width;
  if (width <= 0) return;

  const margin = Math.max(64, Math.round(width * 0.2));
  const maxScrollLeft = Math.max(0, (Number(el.scrollWidth) || 0) - width);

  let nextLeft = left;
  if (x < left + margin) nextLeft = x - margin;
  else if (x > right - margin) nextLeft = x - (width - margin);

  nextLeft = clamp(nextLeft, 0, maxScrollLeft);
  if (Math.abs(nextLeft - left) < 1) return;

  lastAutoScrollAtMs = Date.now();
  el.scrollLeft = nextLeft;
};

const onScroll = () => {
  if (!props.isPlaying) return;
  if (Date.now() - lastAutoScrollAtMs < 160) return;
  followLockUntilMs.value = Date.now() + 1200;
};

// =========================
// Zoom (wheel) + pan (space/middle)
// =========================
const pendingZoom = ref(null); // { time:number, cursorX:number }

const applyZoomAnchor = () => {
  const z = pendingZoom.value;
  const el = scrollEl.value;
  if (!z || !el) return;

  const width = Number(el.clientWidth) || 0;
  const maxScrollLeft = Math.max(0, (Number(el.scrollWidth) || 0) - width);
  el.scrollLeft = clamp(z.time * props.pxPerSecond - z.cursorX, 0, maxScrollLeft);
  pendingZoom.value = null;
};

watch(
  () => props.pxPerSecond,
  () => applyZoomAnchor(),
  { flush: 'post' }
);

const onWheel = (e) => {
  const el = scrollEl.value;
  if (!el) return;

  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const cursorX = clamp(e.clientX - rect.left, 0, rect.width || 0);
    const time = (Number(el.scrollLeft) + cursorX) / Math.max(1, props.pxPerSecond);

    const scale = Math.pow(1.0018, -e.deltaY);
    const next = clamp((Number(props.pxPerSecond) || 96) * scale, 24, 480);
    pendingZoom.value = { time, cursorX };
    emit('updateZoom', next);
    return;
  }

  if (e.shiftKey) {
    e.preventDefault();
    el.scrollLeft += e.deltaY;
    return;
  }

  if (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0) {
    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    el.scrollLeft += delta;
  }
};

const spaceDown = ref(false);
provide('timelineSpaceDown', spaceDown);
const shouldIgnoreKeyEventTarget = (e) => {
  const tag = String(e?.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e?.target?.isContentEditable) return true;
  return false;
};

const onKeyDown = (e) => {
  if (shouldIgnoreKeyEventTarget(e)) return;
  if (e.code === 'Space') {
    spaceDown.value = true;
    e.preventDefault();
  }
};

const onKeyUp = (e) => {
  if (e.code === 'Space') {
    spaceDown.value = false;
  }
};

const startPan = (event) => {
  if (event.pointerType === 'mouse' && event.button !== 1 && !spaceDown.value) return false;
  const el = scrollEl.value;
  if (!el) return false;

  event.preventDefault();
  event.stopPropagation();

  isPanning.value = true;
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

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    isPanning.value = false;
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { once: true });
  return true;
};

// =========================
// Ruler / playhead scrubbing
// =========================
const timeFromClientX = (clientX) => {
  const el = scrollEl.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  const x = Number(clientX) - rect.left + el.scrollLeft;
  const t = x / Math.max(1, props.pxPerSecond);
  return clamp(t, 0, maxEnd.value);
};

const scheduleScrubPreview = (() => {
  let raf = 0;
  let pendingX = 0;
  return (clientX) => {
    pendingX = Number(clientX) || 0;
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      emit('previewPlayhead', timeFromClientX(pendingX));
    });
  };
})();

const startScrub = (event) => {
  if (event.pointerType === 'touch') return;
  if (startPan(event)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  event.preventDefault();
  event.stopPropagation();

  isScrubbing.value = true;
  emit('scrubStart');

  const clampClientXToViewport = (clientX) => {
    const el = scrollEl.value;
    if (!el) return Number(clientX) || 0;
    const rect = el.getBoundingClientRect();
    const width = Number(rect.width) || 0;
    if (width <= 0) return Number(clientX) || 0;
    // Clamp to viewport bounds only; do not add a margin here, otherwise time=0 becomes unreachable.
    return clamp(Number(clientX) || 0, rect.left, rect.right);
  };

  let lastClientX = Number(event.clientX) || 0;
  let autoScrollRaf = 0;

  const autoScrollTick = () => {
    autoScrollRaf = 0;
    if (!isScrubbing.value) return;
    const el = scrollEl.value;
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

    let dir = 0;
    let strength = 0;
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
      scheduleScrubPreview(clampClientXToViewport(lastClientX));
    }

    autoScrollRaf = window.requestAnimationFrame(autoScrollTick);
  };

  emit('previewPlayhead', timeFromClientX(clampClientXToViewport(lastClientX)));

  const onMove = (e) => {
    lastClientX = Number(e.clientX) || 0;
    scheduleScrubPreview(clampClientXToViewport(lastClientX));
  };
  const onUp = (e) => {
    window.removeEventListener('pointermove', onMove);
    if (autoScrollRaf) window.cancelAnimationFrame(autoScrollRaf);
    isScrubbing.value = false;
    const x = clampClientXToViewport(e.clientX);
    emit('updatePlayhead', timeFromClientX(x));
  };

  autoScrollRaf = window.requestAnimationFrame(autoScrollTick);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { once: true });
};

// =========================
// Selection (box) + background click
// =========================
const LANE_HEIGHT = 96;
const CLIP_TOP = 12;
const CLIP_HEIGHT = 66;

const minGridHeight = computed(() => Math.max(320, (props.tracks?.length || 0) * LANE_HEIGHT + 24));

const trackIndexById = computed(() => {
  const map = new Map();
  (props.tracks || []).forEach((t, idx) => map.set(String(t?.id || ''), idx));
  return map;
});

const selection = ref({
  active: false,
  dragging: false,
  additive: false,
  x0: 0,
  y0: 0,
  x1: 0,
  y1: 0,
  base: [],
});

const selectionStyle = computed(() => {
  if (!selection.value.active) return null;
  const left = Math.min(selection.value.x0, selection.value.x1);
  const top = Math.min(selection.value.y0, selection.value.y1);
  const width = Math.abs(selection.value.x1 - selection.value.x0);
  const height = Math.abs(selection.value.y1 - selection.value.y0);
  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    height: `${Math.round(height)}px`,
  };
});

const clipsByTrack = computed(() => {
  const out = new Map();
  for (const t of props.tracks || []) out.set(String(t.id), []);
  for (const c of props.clips || []) {
    const tid = String(c?.trackId || '');
    if (!out.has(tid)) out.set(tid, []);
    out.get(tid).push(c);
  }
  return out;
});

const assetById = computed(() => {
  const map = new Map();
  for (const a of props.assets || []) {
    if (a?.id) map.set(String(a.id), a);
  }
  return map;
});

const colorForTrack = (trackId) => {
  const id = String(trackId || '');
  if (id.includes('drum')) return 'border-orange-200/70';
  if (id.includes('vox')) return 'border-fuchsia-200/70';
  if (id.includes('piano')) return 'border-amber-200/70';
  return 'border-teal-200/70';
};

const computeHitClips = (rect) => {
  const hits = [];
  const left = rect.left;
  const right = rect.right;
  const top = rect.top;
  const bottom = rect.bottom;

  for (const clip of props.clips || []) {
    const id = String(clip?.id || '');
    if (!id) continue;

    const trackId = String(clip?.trackId || '');
    const idx = trackIndexById.value.get(trackId);
    if (typeof idx !== 'number') continue;

    const clipLeft = (Number(clip?.start) || 0) * props.pxPerSecond;
    const clipRight = clipLeft + (Number(clip?.length) || 0) * props.pxPerSecond;
    const clipTop = idx * LANE_HEIGHT + CLIP_TOP;
    const clipBottom = clipTop + CLIP_HEIGHT;

    const intersects = clipRight > left && clipLeft < right && clipBottom > top && clipTop < bottom;
    if (intersects) hits.push(id);
  }
  return hits;
};

const setSelectionIds = (ids, additive, base) => {
  const next = additive ? new Set([...(base || []), ...ids]) : new Set(ids);
  emit('setSelection', Array.from(next));
};

const onGridPointerDown = (event) => {
  if (event.pointerType === 'touch') return;
  if (startPan(event)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  // Clicking a clip is handled by ClipBlock.
  if (event?.target?.closest?.('.clip')) return;

  const grid = gridRef.value;
  if (!grid) return;

  event.preventDefault();
  event.stopPropagation();

  const rect = grid.getBoundingClientRect();
  const scroll = scrollEl.value;
  const scrollLeft = Number(scroll?.scrollLeft) || 0;
  const scrollTop = Number(scroll?.scrollTop) || 0;
  const x0 = event.clientX - rect.left + scrollLeft;
  const y0 = event.clientY - rect.top + scrollTop;

  if (props.isRegionDrawing) {
    event.preventDefault();
    event.stopPropagation();

    const rect = grid.getBoundingClientRect();
    const scroll = scrollEl.value;
    const scrollLeft = Number(scroll?.scrollLeft) || 0;
    const x0 = event.clientX - rect.left + scrollLeft;

    regionDraft.value = { active: true, x0, x1: x0 };

    const onMove = (e) => {
      const scrollNow = scrollEl.value;
      const scrollLeftNow = Number(scrollNow?.scrollLeft) || 0;
      const x = e.clientX - rect.left + scrollLeftNow;
      regionDraft.value.x1 = x;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      const left = Math.min(regionDraft.value.x0, regionDraft.value.x1);
      const right = Math.max(regionDraft.value.x0, regionDraft.value.x1);
      regionDraft.value.active = false;

      const start = snapTime(left / Math.max(1, props.pxPerSecond));
      const end = snapTime(right / Math.max(1, props.pxPerSecond));
      if (end > start + REGION_MIN) {
        emit('createRegion', { start, end });
      }
      emit('finishRegionDraw');
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { once: true });
    return;
  }

  selection.value = {
    active: true,
    dragging: false,
    additive: Boolean(event.shiftKey),
    x0,
    y0,
    x1: x0,
    y1: y0,
    base: props.selectedClipIds.map(String),
  };
  isSelecting.value = true;

  const onMove = (e) => {
    if (!selection.value.active) return;
    const scrollNow = scrollEl.value;
    const scrollLeftNow = Number(scrollNow?.scrollLeft) || 0;
    const scrollTopNow = Number(scrollNow?.scrollTop) || 0;
    const x = e.clientX - rect.left + scrollLeftNow;
    const y = e.clientY - rect.top + scrollTopNow;

    const dx = x - selection.value.x0;
    const dy = y - selection.value.y0;
    const moved = Math.hypot(dx, dy) > 3;
    if (moved) selection.value.dragging = true;

    selection.value.x1 = x;
    selection.value.y1 = y;

    if (!selection.value.dragging) return;

    const selRect = {
      left: Math.min(selection.value.x0, selection.value.x1),
      right: Math.max(selection.value.x0, selection.value.x1),
      top: Math.min(selection.value.y0, selection.value.y1),
      bottom: Math.max(selection.value.y0, selection.value.y1),
    };

    const hits = computeHitClips(selRect);
    setSelectionIds(hits, selection.value.additive, selection.value.base);
  };

  const onUp = (e) => {
    window.removeEventListener('pointermove', onMove);
    isSelecting.value = false;

    const wasDragging = selection.value.dragging;
    selection.value.active = false;

    if (!wasDragging) {
      // Background click: place playhead + clear selection.
      emit('previewPlayhead', timeFromClientX(e.clientX));
      emit('updatePlayhead', timeFromClientX(e.clientX));
      if (!event.shiftKey) emit('setSelection', []);
    } else {
      // Final selection already emitted in move handler.
    }
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { once: true });
};

// =========================
// Lines / markers / regions
// =========================
const gridLines = computed(() => {
  const lines = [];
  const step = gridSec.value;
  if (!(step > 0)) return lines;
  const count = Math.ceil(maxEnd.value / step);
  for (let i = 0; i <= count; i += 1) {
    lines.push(Math.round(i * step * props.pxPerSecond));
  }
  return lines;
});

const beatLines = computed(() => {
  const lines = [];
  const step = beatSec.value;
  if (!(step > 0)) return lines;
  const count = Math.ceil(maxEnd.value / step);
  for (let i = 0; i <= count; i += 1) {
    lines.push(Math.round(i * step * props.pxPerSecond));
  }
  return lines;
});

const barLines = computed(() => {
  const lines = [];
  const step = barSec.value;
  if (!(step > 0)) return lines;
  const count = Math.ceil(maxEnd.value / step);
  for (let i = 0; i <= count; i += 1) {
    lines.push({ x: Math.round(i * step * props.pxPerSecond), bar: i + 1 });
  }
  return lines;
});

const loopBlock = computed(() => {
  const lr = props.transport?.loopRange;
  if (!lr?.enabled) return null;
  const start = Math.max(0, Number(lr?.start) || 0);
  const end = Math.max(0, Number(lr?.end) || 0);
  if (!(end > start)) return null;
  return {
    left: Math.round(start * props.pxPerSecond),
    width: Math.round((end - start) * props.pxPerSecond),
  };
});

const markerLines = computed(() => {
  const out = [];
  const list = Array.isArray(props.markers) ? props.markers : [];
  for (const m of list) {
    const t = Math.max(0, Number(m?.time) || 0);
    out.push({ id: String(m?.id || `m_${t}`), x: Math.round(t * props.pxPerSecond), label: String(m?.label || '') });
  }
  return out;
});

const regionBlocks = computed(() => {
  const out = [];
  const list = Array.isArray(props.regions) ? props.regions : [];
  for (const r of list) {
    const start = Math.max(0, Number(r?.start) || 0);
    const end = Math.max(0, Number(r?.end) || 0);
    if (!(end > start)) continue;
    out.push({
      id: String(r?.id || `r_${start}_${end}`),
      start,
      end,
      left: Math.round(start * props.pxPerSecond),
      width: Math.round((end - start) * props.pxPerSecond),
      label: String(r?.label || ''),
    });
  }
  return out;
});

const REGION_MIN = 0.1;
const isRegionDragging = ref(false);
const regionDragId = ref('');
const regionDragMode = ref('move');
const regionDragStartX = ref(0);
const regionDragStart = ref(0);
const regionDragEnd = ref(0);
const regionDraft = ref({ active: false, x0: 0, x1: 0 });
const regionDraftStyle = computed(() => {
  if (!regionDraft.value.active) return {};
  const left = Math.min(regionDraft.value.x0, regionDraft.value.x1);
  const right = Math.max(regionDraft.value.x0, regionDraft.value.x1);
  return {
    left: `${left}px`,
    width: `${Math.max(1, right - left)}px`,
  };
});

const startRegionDrag = (event, region, mode = 'move') => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  isRegionDragging.value = true;
  regionDragId.value = String(region?.id || '');
  regionDragMode.value = mode;
  regionDragStartX.value = Number(event.clientX) || 0;
  const startScrollLeft = Number(scrollEl.value?.scrollLeft) || 0;
  regionDragStart.value = Number(region?.start) || 0;
  regionDragEnd.value = Number(region?.end) || 0;

  const onMove = (e) => {
    const dx = (Number(e.clientX) || 0) - regionDragStartX.value;
    if (Math.abs(dx) < 0.5) return;
    const scrollLeftNow = Number(scrollEl.value?.scrollLeft) || 0;
    const worldDx = (Number(e.clientX) || 0) + scrollLeftNow - (regionDragStartX.value + startScrollLeft);
    const baseDelta = pxToTime(worldDx);
    const speed = e.shiftKey ? 0.1 : 0.2;
    const deltaSec = baseDelta * speed;
    const length = Math.max(REGION_MIN, regionDragEnd.value - regionDragStart.value);

    let nextStart = regionDragStart.value;
    let nextEnd = regionDragEnd.value;

    if (regionDragMode.value === 'move') {
      nextStart = snapTime(regionDragStart.value + deltaSec);
      nextStart = Math.max(0, nextStart);
      nextEnd = nextStart + length;
    } else if (regionDragMode.value === 'start') {
      nextStart = snapTime(regionDragStart.value + deltaSec);
      nextStart = Math.max(0, Math.min(nextStart, regionDragEnd.value - REGION_MIN));
    } else if (regionDragMode.value === 'end') {
      nextEnd = snapTime(regionDragEnd.value + deltaSec);
      nextEnd = Math.max(regionDragStart.value + REGION_MIN, nextEnd);
    }

    regionDragStart.value = nextStart;
    regionDragEnd.value = nextEnd;
    emit('updateRegion', regionDragId.value, { start: nextStart, end: nextEnd }, { commit: false });
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    isRegionDragging.value = false;
    emit('updateRegion', regionDragId.value, {
      start: regionDragStart.value,
      end: regionDragEnd.value,
    }, { commit: true });
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { once: true });
};

const renameRegion = (region) => {
  const id = String(region?.id || '').trim();
  if (!id) return;
  const current = String(region?.label || '').trim();
  const next = window.prompt('区域名称', current);
  if (next == null) return;
  emit('updateRegion', id, { label: String(next).trim() }, { commit: true });
};

const requestDeleteRegion = (region) => {
  const id = String(region?.id || '').trim();
  if (!id) return;
  if (!window.confirm('确定删除该区域吗？')) return;
  emit('deleteRegion', id);
};

watch(
  () => playheadX.value,
  (x) => scheduleFollow(x),
  { flush: 'post' }
);

watch(
  () => props.isPlaying,
  (playing) => {
    if (!playing) return;
    followLockUntilMs.value = 0;
    scheduleFollow(playheadX.value);
  }
);

const handleClipUpdate = (clipId, patch) => emit('updateClip', clipId, patch);
const handleClipSelect = (payload) => emit('selectClip', payload);

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
});

onBeforeUnmount(() => {
  if (followRaf) window.cancelAnimationFrame(followRaf);
  followRaf = 0;
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
});
</script>

<template>
  <section class="flex-1 relative overflow-hidden">
    <div
      ref="scrollEl"
      class="h-full overflow-x-auto overflow-y-auto"
      @scroll.passive="onScroll"
      @wheel="onWheel"
    >
      <div class="relative min-h-full" :style="{ width: `${contentWidth}px` }">
        <!-- Ruler (scrub here) -->
        <div
          ref="rulerRef"
          class="sticky top-0 h-8 glass border-b border-white/70 z-20 cursor-ew-resize select-none"
          @pointerdown="startScrub"
        >
          <div class="relative h-full">
            <div
              v-for="r in regionBlocks"
              :key="`rr-${r.id}`"
              class="absolute top-0 bottom-0 bg-amber-400/10 border border-amber-300/25 pointer-events-none"
              :style="{ left: `${r.left}px`, width: `${r.width}px` }"
            >
              <div
                v-if="r.label"
                class="absolute top-0 left-1 mt-0.5 text-[10px] font-mono font-semibold text-amber-900 bg-amber-200/60 border border-amber-300/60 rounded px-1.5 py-0.5"
              >
                {{ r.label }}
              </div>
            </div>

            <div
              v-for="bar in barLines"
              :key="bar.bar"
              class="absolute top-0 bottom-0 flex items-end"
              :style="{ left: `${bar.x}px` }"
            >
              <div class="h-full w-px bg-slate-300/60"></div>
              <div class="pb-1 pl-1 text-[10px] text-slate-500 font-mono">{{ bar.bar }}</div>
            </div>

            <div
              v-for="m in markerLines"
              :key="m.id"
              class="absolute top-0 bottom-0"
              :style="{ left: `${m.x}px` }"
            >
              <div class="h-full w-px bg-amber-400/70"></div>
              <div
                v-if="m.label"
                class="absolute top-0 left-1 mt-0.5 text-[10px] font-mono font-semibold text-amber-800 bg-amber-200/60 border border-amber-300/60 rounded px-1.5 py-0.5"
              >
                {{ m.label }}
              </div>
            </div>
          </div>
        </div>

        <!-- Grid backdrop -->
        <div
          ref="gridRef"
          class="relative"
          :style="{ minHeight: `${minGridHeight}px` }"
          @pointerdown="onGridPointerDown"
        >
          <!-- loop region -->
          <div
            v-if="loopBlock"
            class="absolute top-0 bottom-0 bg-emerald-400/10 border border-emerald-300/20 pointer-events-none z-10"
            :style="{ left: `${loopBlock.left}px`, width: `${loopBlock.width}px` }"
          ></div>

          <!-- regions -->
          <div
            v-for="r in regionBlocks"
            :key="`rg-${r.id}`"
            class="absolute top-0 bottom-0 bg-amber-400/10 border border-amber-300/40 z-0 cursor-move"
            :style="{ left: `${r.left}px`, width: `${r.width}px` }"
            @pointerdown="startRegionDrag($event, r, 'move')"
            @dblclick.stop="renameRegion(r)"
            @contextmenu.prevent.stop="requestDeleteRegion(r)"
          >
            <div
              class="absolute left-0 top-0 bottom-0 w-2 bg-amber-400/35 hover:bg-amber-400/60 cursor-ew-resize"
              @pointerdown.stop="startRegionDrag($event, r, 'start')"
            ></div>
            <div
              class="absolute right-0 top-0 bottom-0 w-2 bg-amber-400/35 hover:bg-amber-400/60 cursor-ew-resize"
              @pointerdown.stop="startRegionDrag($event, r, 'end')"
            ></div>
            <div
              v-if="r.label"
              class="absolute top-1 left-2 text-[10px] font-mono font-semibold text-amber-900 bg-amber-200/70 border border-amber-300/70 rounded px-1.5 py-0.5 select-none"
            >
              {{ r.label }}
            </div>
          </div>

          <!-- grid lines -->
          <div class="absolute inset-0 pointer-events-none">
            <div
              v-for="(x, idx) in gridLines"
              :key="`g-${idx}`"
              class="absolute top-0 bottom-0 w-px"
              :class="idx % 4 === 0 ? 'bg-slate-300/35' : 'bg-slate-200/30'"
              :style="{ left: `${x}px` }"
            ></div>
            <div
              v-for="(x, idx) in beatLines"
              :key="`b-${idx}`"
              class="absolute top-0 bottom-0 w-px bg-slate-300/45"
              :style="{ left: `${x}px` }"
            ></div>
            <div
              v-for="m in markerLines"
              :key="`ml-${m.id}`"
              class="absolute top-0 bottom-0 w-px bg-amber-400/40"
              :style="{ left: `${m.x}px` }"
            ></div>
          </div>

          <!-- selection rect -->
          <div
            v-if="selection.active && selection.dragging"
            class="absolute rounded-lg border border-teal-400/60 bg-teal-300/15 pointer-events-none z-50"
            :style="selectionStyle"
          ></div>

          <!-- region draw preview -->
          <div
            v-if="regionDraft.active"
            class="absolute top-0 bottom-0 bg-amber-400/15 border border-amber-300/60 pointer-events-none z-40"
            :style="regionDraftStyle"
          ></div>

          <!-- Track lanes -->
          <div
            v-for="track in tracks"
            :key="track.id"
            class="track-lane h-24 border-b border-slate-200/70 bg-white/20 relative"
            :data-track-id="track.id"
            :data-track-type="track.type"
          >
            <ClipBlock
              v-for="clip in clipsByTrack.get(String(track.id)) || []"
              :key="clip.id"
              :clip="clip"
              :asset="assetById.get(String(clip.assetId)) || null"
              :selected="isSelected(clip.id)"
              :px-per-second="pxPerSecond"
              :bpm="bpm"
              :grid-division="gridDenom"
              :snap-enabled="snapEnabled"
              :color-class="colorForTrack(track.id)"
              @update="handleClipUpdate"
              @select="handleClipSelect"
            />
          </div>

          <!-- Playhead (draggable) -->
          <div class="absolute top-0 bottom-0 z-40" :style="{ left: `${playheadX}px` }">
            <div class="absolute top-0 bottom-0 w-px bg-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.15)]"></div>
            <button
              class="absolute -top-2 -left-2 w-4 h-4 rounded-full bg-rose-500 shadow-md cursor-ew-resize"
              @pointerdown="startScrub"
              aria-label="Drag playhead"
            ></button>
          </div>
        </div>
      </div>
    </div>

    <div
      class="absolute bottom-4 right-4 glass-card px-3 py-2 rounded-xl border border-white/70 text-xs font-semibold text-slate-700 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <i class="ph-bold ph-info text-teal-600"></i>
        Ctrl/Cmd 滚轮缩放；空格拖拽平移；框选多选（Shift 叠加）；Ctrl/Cmd+Z/Y 撤销/重做；Ctrl/Cmd+C/V/D；S 分割；Alt 临时关闭吸附；Shift+拖拽=Slip
      </div>
    </div>
  </section>
</template>
