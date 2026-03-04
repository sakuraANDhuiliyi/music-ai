<script setup>
/**
 * StepSequencer - 教程用「动态与节奏步进器」
 * - 16步网格
 * - 每步支持开关 + Velocity（拖拽调整）
 * - Swing（50%~66%）
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ensureSharedAudioRunning, getSharedAudioContext } from '../../audio/sharedAudioContext.js';

const props = defineProps({
  steps: { type: Number, default: 16 },
  initialBpm: { type: Number, default: 100 },
  // swingRatio: 0.5 ~ 0.66 (50% ~ 66%)
  initialSwing: { type: Number, default: 0.5 },
  // 基础音高（MIDI 或频率都可，这里直接频率）
  baseFreq: { type: Number, default: 220 },
});

const bpm = ref(Math.max(40, Math.min(220, Number(props.initialBpm) || 100)));
const swing = ref(Math.max(0.5, Math.min(0.66, Number(props.initialSwing) || 0.5)));
const isPlaying = ref(false);
const currentStep = ref(0);

const grid = reactive(
  Array.from({ length: Math.max(4, Math.min(64, props.steps)) }, (_, i) => ({
    index: i,
    on: i % 4 === 0, // default: 4-on-the-floor feel
    vel: i % 4 === 0 ? 0.9 : 0.55,
  }))
);

const audioCtx = ref(null);
const nextTime = ref(0);
const timer = ref(null);
const lookaheadMs = 25;
const scheduleAheadSec = 0.12;

const stepsPerBar = computed(() => grid.length);
const stepDuration = computed(() => {
  // 16 steps in 4/4 => 16th note length = quarter/4
  const quarter = 60 / bpm.value;
  return quarter / 4;
});

const ensureAudio = async () => {
  if (!audioCtx.value) audioCtx.value = getSharedAudioContext();
  await ensureSharedAudioRunning();
  return audioCtx.value;
};

const playClick = (time, velocity, isDownbeat) => {
  const ctx = audioCtx.value;
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = 'triangle';
  osc.frequency.value = isDownbeat ? 880 : 660;

  filter.type = 'highpass';
  filter.frequency.value = 700;
  filter.Q.value = 0.8;

  const v = Math.max(0.05, Math.min(1, Number(velocity) || 0.3));
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.35 * v, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + 0.07);
};

const computeSwingOffset = (stepIndex) => {
  // 将奇数步（1,3,5...）往后推，模拟“向后拉”的 swing
  const ratio = Math.max(0.5, Math.min(0.66, Number(swing.value) || 0.5));
  const base = stepDuration.value;
  const offset = (ratio - 0.5) * base * 2; // 0 ~ 0.32*base
  return stepIndex % 2 === 1 ? offset : 0;
};

const schedule = () => {
  const ctx = audioCtx.value;
  if (!ctx || !isPlaying.value) return;

  while (nextTime.value < ctx.currentTime + scheduleAheadSec) {
    const idx = currentStep.value;
    const cell = grid[idx];
    const isDownbeat = idx % 4 === 0;
    const t = nextTime.value + computeSwingOffset(idx);

    if (cell?.on) {
      playClick(t, cell.vel, isDownbeat);
    }

    // 下一步
    nextTime.value += stepDuration.value;
    currentStep.value = (currentStep.value + 1) % stepsPerBar.value;
  }
};

const start = async () => {
  await ensureAudio();
  if (isPlaying.value) return;

  isPlaying.value = true;
  currentStep.value = 0;
  nextTime.value = audioCtx.value.currentTime + 0.05;
  timer.value = setInterval(schedule, lookaheadMs);
};

const stop = () => {
  isPlaying.value = false;
  currentStep.value = 0;
  if (timer.value) {
    clearInterval(timer.value);
    timer.value = null;
  }
};

const toggle = () => {
  if (isPlaying.value) stop();
  else start();
};

const toggleStep = (idx) => {
  const cell = grid[idx];
  if (!cell) return;
  cell.on = !cell.on;
};

const setVelocity = (idx, v) => {
  const cell = grid[idx];
  if (!cell) return;
  cell.vel = Math.max(0, Math.min(1, v));
};

const handlePointer = (idx, ev) => {
  const el = ev.currentTarget;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const y = ev.clientY - rect.top;
  const v = 1 - y / rect.height;
  setVelocity(idx, v);
};

const reset = () => {
  for (const cell of grid) {
    cell.on = cell.index % 4 === 0;
    cell.vel = cell.index % 4 === 0 ? 0.9 : 0.55;
  }
};

onMounted(() => {});

onBeforeUnmount(() => {
  stop();
});
</script>

<template>
  <div class="step-seq">
    <div class="top">
      <div>
        <div class="title">动态与节奏步进器</div>
        <div class="subtitle">点亮步进格子，拖动高度调 Velocity；Swing 越大越“靠后”。</div>
      </div>
      <div class="actions">
        <button class="btn secondary" @click="reset" :disabled="isPlaying">重置</button>
        <button class="btn primary" :class="{ danger: isPlaying }" @click="toggle">
          <i :class="isPlaying ? 'ph-bold ph-pause' : 'ph-bold ph-play'"></i>
          {{ isPlaying ? '停止' : '播放' }}
        </button>
      </div>
    </div>

    <div class="knobs">
      <label class="knob">
        <span>BPM</span>
        <input v-model.number="bpm" type="range" min="40" max="220" step="1" />
        <span class="mono">{{ bpm }}</span>
      </label>
      <label class="knob">
        <span>Swing</span>
        <input v-model.number="swing" type="range" min="0.5" max="0.66" step="0.005" />
        <span class="mono">{{ Math.round(swing * 100) }}%</span>
      </label>
    </div>

    <div class="grid">
      <button
        v-for="cell in grid"
        :key="cell.index"
        class="step"
        :class="{
          on: cell.on,
          active: isPlaying && currentStep === cell.index,
          downbeat: cell.index % 4 === 0,
        }"
        type="button"
        @click="toggleStep(cell.index)"
        @pointerdown.prevent="handlePointer(cell.index, $event)"
        @pointermove.prevent="($event.buttons === 1) && handlePointer(cell.index, $event)"
        :style="{ '--vel': cell.vel }"
        title="点击开关；按住拖动调整力度"
      >
        <div class="bar"></div>
        <div class="idx">{{ cell.index + 1 }}</div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.step-seq {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.8);
}

.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.title {
  font-size: 14px;
  font-weight: 800;
  color: rgb(17, 20, 24);
}

.subtitle {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(91, 101, 110);
  line-height: 1.45;
}

.actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.btn {
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.8);
  color: rgb(91, 101, 110);
  font-weight: 800;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn.primary {
  border: none;
  background: linear-gradient(135deg, rgb(34, 199, 184), rgb(245, 178, 74));
  color: white;
}

.btn.primary.danger {
  background: linear-gradient(135deg, rgb(240, 106, 90), rgb(245, 178, 74));
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.knobs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.knob {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(0, 0, 0, 0.06);
  font-size: 12px;
  font-weight: 800;
  color: rgb(17, 20, 24);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-weight: 800;
  color: rgb(15, 118, 110);
  min-width: 56px;
  text-align: right;
}

.grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 10px;
}

.step {
  position: relative;
  height: 62px;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.88);
  cursor: pointer;
  overflow: hidden;
}

.step.downbeat {
  border-color: rgba(245, 158, 11, 0.45);
}

.step.on {
  border-color: rgba(34, 199, 184, 0.6);
  background: rgba(34, 199, 184, 0.08);
}

.step.active {
  box-shadow: 0 0 0 6px rgba(34, 199, 184, 0.18);
}

.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: calc(var(--vel, 0.5) * 100%);
  background: linear-gradient(180deg, rgba(34, 199, 184, 0.2), rgba(34, 199, 184, 0.55));
  transform-origin: bottom;
}

.step:not(.on) .bar {
  background: linear-gradient(180deg, rgba(148, 163, 184, 0.15), rgba(148, 163, 184, 0.35));
}

.idx {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 10px;
  font-weight: 900;
  color: rgba(15, 23, 42, 0.6);
}
</style>

