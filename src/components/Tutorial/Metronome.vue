<script setup>
/**
 * Metronome - 节拍器组件
 * 支持BPM调节、拍号选择、节拍训练等功能
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ensureSharedAudioRunning, getSharedAudioContext } from '../../audio/sharedAudioContext.js';

const props = defineProps({
  // 初始BPM
  initialBpm: { type: Number, default: 120 },
  // 拍号分子（每小节几拍）
  beatsPerMeasure: { type: Number, default: 4 },
  // 是否显示控制面板
  showControls: { type: Boolean, default: true },
  // 是否启用用户跟拍模式
  tapMode: { type: Boolean, default: false },
});

const emit = defineEmits(['beat', 'measure', 'tap', 'tapResult']);

const bpm = ref(props.initialBpm);
const isPlaying = ref(false);
const currentBeat = ref(0);
const audioCtx = ref(null);
const nextBeatTime = ref(0);
const timerWorker = ref(null);
const lookahead = 25; // ms
const scheduleAheadTime = 0.1; // seconds

// 用户跟拍相关
const userTaps = ref([]);
const lastTapTime = ref(0);
const tapFeedback = ref(null); // 'early' | 'late' | 'perfect' | null

const ensureAudio = async () => {
  if (!audioCtx.value) {
    audioCtx.value = getSharedAudioContext();
  }
  await ensureSharedAudioRunning();
};

const playClick = (time, isDownbeat) => {
  const ctx = audioCtx.value;
  if (!ctx) return;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.frequency.value = isDownbeat ? 1000 : 800;
  osc.type = 'sine';
  
  gain.gain.setValueAtTime(isDownbeat ? 0.5 : 0.3, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.start(time);
  osc.stop(time + 0.05);
};

const scheduler = () => {
  if (!audioCtx.value || !isPlaying.value) return;
  
  while (nextBeatTime.value < audioCtx.value.currentTime + scheduleAheadTime) {
    const isDownbeat = currentBeat.value === 0;
    playClick(nextBeatTime.value, isDownbeat);
    
    emit('beat', {
      beat: currentBeat.value + 1,
      time: nextBeatTime.value,
      isDownbeat,
    });
    
    if (isDownbeat) {
      emit('measure');
    }
    
    // 计算下一拍时间
    const secondsPerBeat = 60.0 / bpm.value;
    nextBeatTime.value += secondsPerBeat;
    currentBeat.value = (currentBeat.value + 1) % props.beatsPerMeasure;
  }
};

const start = async () => {
  await ensureAudio();
  if (isPlaying.value) return;
  
  isPlaying.value = true;
  currentBeat.value = 0;
  nextBeatTime.value = audioCtx.value.currentTime;
  userTaps.value = [];
  
  // 使用 setInterval 进行调度
  timerWorker.value = setInterval(scheduler, lookahead);
};

const stop = () => {
  isPlaying.value = false;
  if (timerWorker.value) {
    clearInterval(timerWorker.value);
    timerWorker.value = null;
  }
  currentBeat.value = 0;
};

const toggle = () => {
  if (isPlaying.value) {
    stop();
  } else {
    start();
  }
};

// 用户跟拍
const handleTap = async () => {
  if (!props.tapMode) return;
  
  await ensureAudio();
  const now = audioCtx.value?.currentTime || 0;
  
  emit('tap', { time: now });
  
  if (!isPlaying.value) {
    // 检测用户连续点击来估算BPM
    if (lastTapTime.value > 0) {
      const interval = now - lastTapTime.value;
      if (interval > 0.2 && interval < 2) {
        const estimatedBpm = Math.round(60 / interval);
        userTaps.value.push(estimatedBpm);
        if (userTaps.value.length > 4) userTaps.value.shift();
        
        // 计算平均BPM
        const avgBpm = Math.round(userTaps.value.reduce((a, b) => a + b, 0) / userTaps.value.length);
        bpm.value = Math.max(40, Math.min(240, avgBpm));
      }
    }
    lastTapTime.value = now;
    return;
  }
  
  // 检测与节拍的偏差
  const secondsPerBeat = 60.0 / bpm.value;
  const expectedBeatTime = nextBeatTime.value - secondsPerBeat; // 上一拍时间
  const diff = now - expectedBeatTime;
  const tolerance = secondsPerBeat * 0.15; // 15%容差
  
  let result;
  if (Math.abs(diff) < tolerance) {
    result = 'perfect';
    tapFeedback.value = 'perfect';
  } else if (diff < -tolerance) {
    result = 'early';
    tapFeedback.value = 'early';
  } else {
    result = 'late';
    tapFeedback.value = 'late';
  }
  
  emit('tapResult', { result, diff });
  
  // 清除反馈
  setTimeout(() => {
    tapFeedback.value = null;
  }, 300);
};

const adjustBpm = (delta) => {
  bpm.value = Math.max(40, Math.min(240, bpm.value + delta));
};

const beatIndicators = computed(() => {
  return Array.from({ length: props.beatsPerMeasure }, (_, i) => ({
    index: i,
    isActive: isPlaying.value && currentBeat.value === i,
    isDownbeat: i === 0,
  }));
});

watch(() => props.initialBpm, (val) => {
  bpm.value = val;
});

onBeforeUnmount(() => {
  stop();
});

defineExpose({ start, stop, toggle, bpm });
</script>

<template>
  <div class="metronome">
    <!-- 节拍指示器 -->
    <div class="beat-indicators">
      <div
        v-for="indicator in beatIndicators"
        :key="indicator.index"
        class="beat-dot"
        :class="{
          'active': indicator.isActive,
          'downbeat': indicator.isDownbeat,
        }"
      />
    </div>
    
    <!-- BPM显示 -->
    <div class="bpm-display">
      <span class="bpm-value">{{ bpm }}</span>
      <span class="bpm-label">BPM</span>
    </div>
    
    <!-- 控制面板 -->
    <div v-if="showControls" class="controls">
      <button class="ctrl-btn" @click="adjustBpm(-5)">
        <i class="ph-bold ph-minus"></i>
      </button>
      
      <button class="play-btn" :class="{ playing: isPlaying }" @click="toggle">
        <i :class="isPlaying ? 'ph-bold ph-pause' : 'ph-bold ph-play'"></i>
      </button>
      
      <button class="ctrl-btn" @click="adjustBpm(5)">
        <i class="ph-bold ph-plus"></i>
      </button>
    </div>
    
    <!-- 跟拍区域 -->
    <div v-if="tapMode" class="tap-area" @click="handleTap">
      <div class="tap-feedback" :class="tapFeedback">
        <template v-if="tapFeedback === 'perfect'">
          <i class="ph-bold ph-check-circle"></i>
          <span>完美!</span>
        </template>
        <template v-else-if="tapFeedback === 'early'">
          <i class="ph-bold ph-arrow-fat-left"></i>
          <span>太快</span>
        </template>
        <template v-else-if="tapFeedback === 'late'">
          <i class="ph-bold ph-arrow-fat-right"></i>
          <span>太慢</span>
        </template>
        <template v-else>
          <span>点击跟拍</span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.metronome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
}

.beat-indicators {
  display: flex;
  gap: 12px;
}

.beat-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.1);
  border: 2px solid rgba(0, 0, 0, 0.15);
  transition: all 0.1s ease;
}

.beat-dot.downbeat {
  width: 20px;
  height: 20px;
  border-color: rgb(245, 178, 74);
}

.beat-dot.active {
  background: rgb(34, 199, 184);
  border-color: rgb(34, 199, 184);
  box-shadow: 0 0 12px rgba(34, 199, 184, 0.5);
  transform: scale(1.2);
}

.beat-dot.active.downbeat {
  background: rgb(245, 178, 74);
  border-color: rgb(245, 178, 74);
  box-shadow: 0 0 12px rgba(245, 178, 74, 0.5);
}

.bpm-display {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.bpm-value {
  font-size: 48px;
  font-weight: 700;
  color: rgb(17, 20, 24);
  font-family: var(--font-display);
}

.bpm-label {
  font-size: 12px;
  font-weight: 600;
  color: rgb(91, 101, 110);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.ctrl-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.8);
  color: rgb(91, 101, 110);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.ctrl-btn:hover {
  background: rgba(34, 199, 184, 0.1);
  border-color: rgba(34, 199, 184, 0.3);
  color: rgb(34, 199, 184);
}

.play-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, rgb(34, 199, 184), rgb(245, 178, 74));
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  transition: all 0.2s ease;
  box-shadow: 0 4px 15px rgba(34, 199, 184, 0.3);
}

.play-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 20px rgba(34, 199, 184, 0.4);
}

.play-btn.playing {
  background: linear-gradient(135deg, rgb(240, 106, 90), rgb(245, 178, 74));
}

.tap-area {
  width: 100%;
  padding: 24px;
  background: rgba(34, 199, 184, 0.1);
  border-radius: 12px;
  border: 2px dashed rgba(34, 199, 184, 0.3);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tap-area:hover {
  background: rgba(34, 199, 184, 0.15);
  border-color: rgba(34, 199, 184, 0.5);
}

.tap-area:active {
  transform: scale(0.98);
}

.tap-feedback {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: rgb(91, 101, 110);
}

.tap-feedback.perfect {
  color: rgb(34, 199, 184);
}

.tap-feedback.early {
  color: rgb(245, 178, 74);
}

.tap-feedback.late {
  color: rgb(240, 106, 90);
}

.tap-feedback i {
  font-size: 24px;
}
</style>
