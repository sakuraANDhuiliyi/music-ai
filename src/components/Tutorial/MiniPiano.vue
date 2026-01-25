<script setup>
/**
 * MiniPiano - 教程用迷你钢琴键盘组件
 * 支持音名显示、高亮、点击播放等功能
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ensureSharedAudioRunning, getSharedAudioContext } from '../../audio/sharedAudioContext.js';

const props = defineProps({
  // 起始MIDI音符 (默认C3=48)
  startNote: { type: Number, default: 48 },
  // 结束MIDI音符 (默认C5=72)
  endNote: { type: Number, default: 72 },
  // 高亮的音符数组 (MIDI值)
  highlightNotes: { type: Array, default: () => [] },
  // 是否显示音名
  showLabels: { type: Boolean, default: true },
  // 是否显示唱名
  showSolfege: { type: Boolean, default: false },
  // 是否可点击播放
  playable: { type: Boolean, default: true },
  // 目标音符（用于练习题）
  targetNote: { type: Number, default: null },
  // 是否禁用
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['noteOn', 'noteOff', 'noteClick']);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

const audioCtx = ref(null);
const masterGain = ref(null);
const activeNotes = reactive(new Map());
const activeSet = ref(new Set());

const ensureAudio = async () => {
  if (!audioCtx.value) {
    const ctx = getSharedAudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    gain.connect(ctx.destination);
    audioCtx.value = ctx;
    masterGain.value = gain;
  }
  await ensureSharedAudioRunning();
};

const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

const noteLabel = (midi) => {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
};

const noteSolfege = (midi) => SOLFEGE[midi % 12];

const isBlackKey = (midi) => NOTE_NAMES[midi % 12].includes('#');

// 构建键盘
const keys = computed(() => {
  const result = [];
  let whiteIndex = 0;
  
  for (let midi = props.startNote; midi <= props.endNote; midi++) {
    const isBlack = isBlackKey(midi);
    result.push({
      midi,
      noteName: noteLabel(midi),
      solfege: noteSolfege(midi),
      isBlack,
      whiteIndex: isBlack ? whiteIndex - 1 : whiteIndex,
    });
    if (!isBlack) whiteIndex++;
  }
  return result;
});

const whiteKeys = computed(() => keys.value.filter(k => !k.isBlack));
const blackKeys = computed(() => keys.value.filter(k => k.isBlack));
const whiteKeyCount = computed(() => whiteKeys.value.length);

const getWhiteKeyStyle = (index) => {
  const width = 100 / whiteKeyCount.value;
  return {
    width: `${width}%`,
    left: `${index * width}%`,
  };
};

const getBlackKeyStyle = (whiteIndex) => {
  const whiteWidth = 100 / whiteKeyCount.value;
  const blackWidth = whiteWidth * 0.6;
  const left = (whiteIndex + 1) * whiteWidth - blackWidth / 2;
  return {
    width: `${blackWidth}%`,
    left: `${left}%`,
  };
};

const isHighlighted = (midi) => props.highlightNotes.includes(midi);
const isTarget = (midi) => props.targetNote === midi;
const isActive = (midi) => activeSet.value.has(midi);

const startNote = async (midi) => {
  if (props.disabled || !props.playable) return;
  
  emit('noteClick', midi, noteLabel(midi));
  emit('noteOn', midi);
  
  await ensureAudio();
  if (activeNotes.has(midi)) return;

  const ctx = audioCtx.value;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.value = midiToFreq(midi);

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.25, now + 0.15);

  osc.connect(gain);
  gain.connect(masterGain.value);
  osc.start();

  activeNotes.set(midi, { osc, gain });
  activeSet.value = new Set(activeSet.value).add(midi);
};

const stopNote = (midi) => {
  const node = activeNotes.get(midi);
  if (!node || !audioCtx.value) return;
  
  emit('noteOff', midi);
  
  const now = audioCtx.value.currentTime;
  node.gain.gain.cancelScheduledValues(now);
  node.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  node.osc.stop(now + 0.1);
  activeNotes.delete(midi);
  
  const next = new Set(activeSet.value);
  next.delete(midi);
  activeSet.value = next;
};

const stopAllNotes = () => {
  for (const midi of Array.from(activeNotes.keys())) {
    try { stopNote(midi); } catch { /* ignore */ }
  }
  activeNotes.clear();
  activeSet.value = new Set();
};

// 播放指定音符（供外部调用）
const playNote = async (midi, duration = 0.5) => {
  await startNote(midi);
  setTimeout(() => stopNote(midi), duration * 1000);
};

// 播放和弦（供外部调用）
const playChord = async (midiArray, duration = 1) => {
  for (const midi of midiArray) {
    await startNote(midi);
  }
  setTimeout(() => {
    for (const midi of midiArray) {
      stopNote(midi);
    }
  }, duration * 1000);
};

onBeforeUnmount(() => {
  stopAllNotes();
});

defineExpose({ playNote, playChord, stopAllNotes });
</script>

<template>
  <div class="mini-piano" :class="{ disabled }">
    <div class="piano-container">
      <!-- 白键 -->
      <div
        v-for="(key, idx) in whiteKeys"
        :key="key.midi"
        class="white-key"
        :class="{
          'highlighted': isHighlighted(key.midi),
          'target': isTarget(key.midi),
          'active': isActive(key.midi),
        }"
        :style="getWhiteKeyStyle(idx)"
        @pointerdown.prevent="startNote(key.midi)"
        @pointerup.prevent="stopNote(key.midi)"
        @pointerleave.prevent="stopNote(key.midi)"
      >
        <span v-if="showLabels" class="key-label">{{ key.noteName }}</span>
        <span v-if="showSolfege" class="key-solfege">{{ key.solfege }}</span>
      </div>
      
      <!-- 黑键 -->
      <div
        v-for="key in blackKeys"
        :key="key.midi"
        class="black-key"
        :class="{
          'highlighted': isHighlighted(key.midi),
          'target': isTarget(key.midi),
          'active': isActive(key.midi),
        }"
        :style="getBlackKeyStyle(key.whiteIndex)"
        @pointerdown.prevent.stop="startNote(key.midi)"
        @pointerup.prevent.stop="stopNote(key.midi)"
        @pointerleave.prevent.stop="stopNote(key.midi)"
      >
        <span v-if="showLabels" class="key-label">{{ key.noteName }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini-piano {
  width: 100%;
  user-select: none;
  touch-action: none;
}

.mini-piano.disabled {
  opacity: 0.6;
  pointer-events: none;
}

.piano-container {
  position: relative;
  height: 120px;
  background: linear-gradient(to bottom, #2a2a2a, #1a1a1a);
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.white-key {
  position: absolute;
  bottom: 8px;
  height: calc(100% - 16px);
  background: linear-gradient(to bottom, #fff, #f0f0f0);
  border: 1px solid #ccc;
  border-radius: 0 0 4px 4px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 6px;
  transition: all 0.1s ease;
  z-index: 1;
}

.white-key:hover {
  background: linear-gradient(to bottom, #fff, #e8e8e8);
}

.white-key.active {
  background: linear-gradient(to bottom, #e0e0e0, #d0d0d0);
  transform: translateY(2px);
}

.white-key.highlighted {
  background: linear-gradient(to bottom, rgba(34, 199, 184, 0.4), rgba(34, 199, 184, 0.6));
  border-color: rgb(34, 199, 184);
}

.white-key.target {
  background: linear-gradient(to bottom, rgba(245, 178, 74, 0.4), rgba(245, 178, 74, 0.6));
  border-color: rgb(245, 178, 74);
  animation: pulse 1s ease-in-out infinite;
}

.black-key {
  position: absolute;
  top: 8px;
  height: 55%;
  background: linear-gradient(to bottom, #3a3a3a, #1a1a1a);
  border: 1px solid #000;
  border-radius: 0 0 3px 3px;
  cursor: pointer;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 4px;
  transition: all 0.1s ease;
  z-index: 2;
}

.black-key:hover {
  background: linear-gradient(to bottom, #4a4a4a, #2a2a2a);
}

.black-key.active {
  background: linear-gradient(to bottom, #2a2a2a, #0a0a0a);
  transform: translateY(2px);
}

.black-key.highlighted {
  background: linear-gradient(to bottom, rgb(34, 199, 184), rgba(34, 199, 184, 0.8));
  border-color: rgb(34, 199, 184);
}

.black-key.target {
  background: linear-gradient(to bottom, rgb(245, 178, 74), rgba(245, 178, 74, 0.8));
  border-color: rgb(245, 178, 74);
  animation: pulse 1s ease-in-out infinite;
}

.key-label {
  font-size: 9px;
  font-weight: 600;
  color: #666;
  text-align: center;
}

.black-key .key-label {
  color: #aaa;
  font-size: 8px;
}

.key-solfege {
  font-size: 8px;
  color: #888;
  margin-top: 2px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
</style>
