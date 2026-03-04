<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  initialPitch: { type: String, default: 'C4' },
  initialDuration: { type: String, default: '4n' },
  showAccidental: { type: Boolean, default: true },
});

const pitch = ref(props.initialPitch);
const duration = ref(props.initialDuration);
const accidental = ref('natural');
const gridSnap = ref(true);

const pitchLabel = computed(() => {
  if (!props.showAccidental) {
    return pitch.value;
  }
  if (accidental.value === 'sharp') return `${pitch.value.replace(/[A-G]/, (m) => `${m}#`)}`;
  if (accidental.value === 'flat') return `${pitch.value.replace(/[A-G]/, (m) => `${m}b`)}`;
  return pitch.value;
});

const durationLabel = computed(() => {
  switch (duration.value) {
    case '1n':
      return '全音符';
    case '2n':
      return '二分音符';
    case '4n.':
      return '附点四分音符';
    case '4n':
      return '四分音符';
    case '8n':
      return '八分音符';
    default:
      return '四分音符';
  }
});

const gridWidth = computed(() => {
  switch (duration.value) {
    case '1n':
      return 100;
    case '2n':
      return 70;
    case '4n.':
      return 60;
    case '4n':
      return 50;
    case '8n':
      return 30;
    default:
      return 50;
  }
});

const noteRows = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const rowIndex = computed(() => Math.max(0, noteRows.indexOf(pitch.value)));
const topOffset = computed(() => 8 + rowIndex.value * 16);

watch(pitch, (value) => {
  if (!noteRows.includes(value)) {
    pitch.value = 'C4';
  }
});
</script>

<template>
  <div class="dual-view">
    <div class="panel">
      <div class="panel-title">五线谱视图</div>
      <div class="score-card">
        <div class="staff-lines">
          <span v-for="i in 5" :key="i" class="staff-line"></span>
        </div>
        <div class="note-head" :style="{ top: `${topOffset}px` }"></div>
        <div class="note-info">
          <div class="note-label">{{ pitchLabel }}</div>
          <div class="note-duration">{{ durationLabel }}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">钢琴卷帘窗视图</div>
      <div class="grid-card">
        <div class="grid-rows">
          <div v-for="row in noteRows" :key="row" class="grid-row" :class="row === pitch ? 'active' : ''">
            <span class="grid-label">{{ row }}</span>
          </div>
        </div>
        <div class="grid-note" :style="{ top: `${topOffset}px`, width: `${gridWidth}px` }"></div>
      </div>
    </div>

    <div class="controls">
      <div class="control-group">
        <label>音高</label>
        <select v-model="pitch">
          <option v-for="row in noteRows" :key="row" :value="row">{{ row }}</option>
        </select>
        <select v-if="showAccidental" v-model="accidental">
          <option value="natural">自然</option>
          <option value="sharp">升号</option>
          <option value="flat">降号</option>
        </select>
      </div>

      <div class="control-group">
        <label>时值</label>
        <select v-model="duration">
          <option value="1n">全音符</option>
          <option value="2n">二分音符</option>
          <option value="4n">四分音符</option>
          <option value="4n.">附点四分</option>
          <option value="8n">八分音符</option>
        </select>
        <label class="snap-toggle">
          <input type="checkbox" v-model="gridSnap" />
          吸附网格
        </label>
      </div>

      <div class="control-hint">拖动与时值变化会同步到两种视图。</div>
    </div>
  </div>
</template>

<style scoped>
.dual-view {
  display: grid;
  gap: 16px;
}

.panel {
  display: grid;
  gap: 8px;
}

.panel-title {
  font-weight: 700;
  font-size: 0.85rem;
  color: #0f172a;
}

.score-card,
.grid-card {
  position: relative;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 16px;
  padding: 16px;
  min-height: 140px;
  overflow: hidden;
}

.staff-lines {
  position: absolute;
  inset: 18px 16px auto 16px;
  height: 70px;
  display: grid;
  gap: 10px;
  z-index: 1;
}

.staff-line {
  height: 1px;
  background: rgba(148, 163, 184, 0.6);
}

.note-head {
  position: absolute;
  left: 60px;
  width: 14px;
  height: 10px;
  background: #0f766e;
  border-radius: 6px;
  z-index: 2;
}

.note-info {
  position: absolute;
  right: 16px;
  top: 16px;
  text-align: right;
  color: #0f172a;
}

.note-label {
  font-weight: 700;
}

.note-duration {
  font-size: 0.75rem;
  color: #64748b;
}

.grid-rows {
  display: grid;
  gap: 6px;
}

.grid-row {
  height: 16px;
  border-radius: 6px;
  background: rgba(226, 232, 240, 0.6);
  position: relative;
}

.grid-row.active {
  background: rgba(45, 212, 191, 0.35);
}

.grid-label {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.65rem;
  color: #64748b;
}

.grid-note {
  position: absolute;
  left: 120px;
  height: 14px;
  background: rgba(14, 116, 144, 0.75);
  border-radius: 6px;
}

.controls {
  display: grid;
  gap: 10px;
  background: rgba(255, 255, 255, 0.65);
  border: 1px dashed rgba(148, 163, 184, 0.5);
  border-radius: 16px;
  padding: 12px 16px;
}

.control-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #0f172a;
}

.control-group select {
  border: 1px solid rgba(148, 163, 184, 0.5);
  border-radius: 10px;
  padding: 4px 8px;
  background: white;
}

.snap-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #475569;
}

.control-hint {
  font-size: 0.75rem;
  color: #64748b;
}
</style>
