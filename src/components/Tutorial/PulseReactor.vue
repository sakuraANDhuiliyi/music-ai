<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  initialBpm: { type: Number, default: 120 },
});

const bpm = ref(props.initialBpm);

const genreLabel = computed(() => {
  const value = bpm.value;
  if (value < 90) return 'Hip-Hop / Lo-Fi';
  if (value < 110) return 'Slow House / R&B';
  if (value < 130) return 'House / Techno';
  if (value < 150) return 'Trap / Dubstep';
  return 'Drum & Bass';
});

const pulseSpeed = computed(() => Math.max(0.6, 180 / bpm.value));
</script>

<template>
  <div class="pulse-reactor">
    <div class="reactor">
      <div class="core" :style="{ animationDuration: `${pulseSpeed}s` }"></div>
      <div class="ring"></div>
      <div class="label">{{ bpm }} BPM</div>
    </div>
    <div class="controls">
      <input type="range" min="60" max="180" v-model.number="bpm" />
      <div class="meta">
        <span class="tag">{{ genreLabel }}</span>
        <span class="hint">拖动滑块感受节拍速度</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pulse-reactor {
  display: grid;
  gap: 12px;
}

.reactor {
  position: relative;
  height: 140px;
  border-radius: 16px;
  background: radial-gradient(circle at center, rgba(59, 130, 246, 0.2), rgba(15, 118, 110, 0.15));
  display: grid;
  place-items: center;
  overflow: hidden;
}

.core {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(13, 148, 136, 0.9);
  animation: pulse 1.2s ease-in-out infinite;
  box-shadow: 0 0 20px rgba(13, 148, 136, 0.6);
}

.ring {
  position: absolute;
  width: 110px;
  height: 110px;
  border-radius: 50%;
  border: 2px dashed rgba(13, 148, 136, 0.4);
}

.label {
  position: absolute;
  bottom: 12px;
  font-size: 0.85rem;
  font-weight: 700;
  color: #0f172a;
}

.controls {
  display: grid;
  gap: 8px;
}

.controls input[type='range'] {
  width: 100%;
}

.meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #475569;
}

.tag {
  background: rgba(15, 118, 110, 0.1);
  color: #0f766e;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}

.hint {
  color: #64748b;
}

@keyframes pulse {
  0% {
    transform: scale(0.85);
    opacity: 0.7;
  }
  50% {
    transform: scale(1.05);
    opacity: 1;
  }
  100% {
    transform: scale(0.85);
    opacity: 0.7;
  }
}
</style>
