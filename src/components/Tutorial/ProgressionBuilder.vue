<script setup>
/**
 * ProgressionBuilder - 和弦进行生成器
 * 支持选择调性、拖拽/点击构建和弦进行、试听
 */
import { computed, ref } from 'vue';
import MiniPiano from './MiniPiano.vue';

const props = defineProps({
  // 默认调性
  defaultKey: { type: String, default: 'C' },
  // 进行长度（小节数）
  length: { type: Number, default: 4 },
});

const emit = defineEmits(['change', 'play']);

const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
const ROMAN_NUMERALS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];

// 大调和弦构成
const MAJOR_SCALE = {
  C: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  G: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
  D: ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
  A: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'],
  E: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#'],
  B: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#'],
  'F#': ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#'],
  'C#': ['C#', 'D#', 'E#', 'F#', 'G#', 'A#', 'B#'],
  F: ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'],
  Bb: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
  Eb: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D'],
  Ab: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'G'],
  Db: ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C'],
  Gb: ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F'],
  Cb: ['Cb', 'Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bb'],
};

const CHORD_QUALITIES = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];

const key = ref(props.defaultKey);
const progression = ref(Array(props.length).fill(null));
const pianoRef = ref(null);

const currentScale = computed(() => MAJOR_SCALE[key.value] || MAJOR_SCALE.C);

const availableChords = computed(() => {
  return currentScale.value.map((note, index) => ({
    roman: ROMAN_NUMERALS[index],
    note,
    quality: CHORD_QUALITIES[index],
    label: `${note}${CHORD_QUALITIES[index] === 'maj' ? '' : CHORD_QUALITIES[index] === 'min' ? 'm' : 'dim'}`,
    index,
  }));
});

const setChord = (slotIndex, chord) => {
  const next = [...progression.value];
  next[slotIndex] = chord;
  progression.value = next;
  emit('change', { progression: next });
};

const clearSlot = (slotIndex) => {
  const next = [...progression.value];
  next[slotIndex] = null;
  progression.value = next;
  emit('change', { progression: next });
};

const getChordNotes = (chord) => {
  if (!chord) return [];
  const noteIndex = currentScale.value.indexOf(chord.note);
  const baseMidi = 48 + noteIndex; // C3起
  const root = baseMidi;
  const third = baseMidi + (chord.quality === 'maj' ? 4 : chord.quality === 'min' ? 3 : 3);
  const fifth = baseMidi + (chord.quality === 'dim' ? 6 : 7);
  return [root, third, fifth];
};

const playProgression = async () => {
  if (!pianoRef.value) return;
  
  emit('play');
  for (let i = 0; i < progression.value.length; i++) {
    const chord = progression.value[i];
    if (!chord) continue;
    const notes = getChordNotes(chord);
    await pianoRef.value.playChord(notes, 0.8);
    await new Promise(resolve => setTimeout(resolve, 900));
  }
};

const presetProgressions = [
  { name: '流行四和弦', pattern: [0, 4, 5, 3], label: 'I-V-vi-IV' },
  { name: '经典进行', pattern: [0, 3, 4, 0], label: 'I-IV-V-I' },
  { name: '感伤进行', pattern: [5, 3, 0, 4], label: 'vi-IV-I-V' },
  { name: '爵士感', pattern: [1, 4, 0, 5], label: 'ii-V-I-vi' },
];

const applyPreset = (preset) => {
  const next = preset.pattern.map(index => availableChords.value[index]);
  progression.value = next;
  emit('change', { progression: next });
};

const randomize = () => {
  const next = Array(props.length).fill(null).map(() => {
    const index = Math.floor(Math.random() * availableChords.value.length);
    return availableChords.value[index];
  });
  progression.value = next;
  emit('change', { progression: next });
};

defineExpose({ playProgression, randomize });
</script>

<template>
  <div class="progression-builder">
    <!-- 控制区 -->
    <div class="controls">
      <div class="key-selector">
        <label>调性</label>
        <select v-model="key">
          <option v-for="k in KEYS" :key="k" :value="k">{{ k }}大调</option>
        </select>
      </div>
      <button class="play-btn" @click="playProgression">
        <i class="ph-bold ph-play"></i>
        播放进行
      </button>
    </div>
    
    <!-- 进行槽位 -->
    <div class="progression-slots">
      <div
        v-for="(slot, index) in progression"
        :key="index"
        class="slot"
        :class="{ filled: !!slot }"
      >
        <div v-if="slot" class="chord-card">
          <div class="roman">{{ slot.roman }}</div>
          <div class="label">{{ slot.label }}</div>
          <button class="clear-btn" @click="clearSlot(index)">
            <i class="ph-bold ph-x"></i>
          </button>
        </div>
        <div v-else class="empty-slot">选择和弦</div>
      </div>
    </div>
    
    <!-- 预设进行 -->
    <div class="presets">
      <div class="preset-title">常用进行</div>
      <div class="preset-list">
        <button
          v-for="preset in presetProgressions"
          :key="preset.label"
          class="preset-btn"
          @click="applyPreset(preset)"
        >
          <div class="preset-name">{{ preset.name }}</div>
          <div class="preset-label">{{ preset.label }}</div>
        </button>
      </div>
    </div>
    
    <!-- 和弦选择器 -->
    <div class="chord-selector">
      <div class="selector-title">调内和弦</div>
      <div class="chord-grid">
        <button
          v-for="chord in availableChords"
          :key="chord.roman"
          class="chord-btn"
          @click="setChord(progression.findIndex(s => !s), chord)"
        >
          <span class="roman">{{ chord.roman }}</span>
          <span class="label">{{ chord.label }}</span>
        </button>
      </div>
    </div>
    
    <!-- 钢琴预览 -->
    <div class="piano-preview">
      <MiniPiano ref="pianoRef" :start-note="48" :end-note="60" :show-labels="false" />
    </div>
  </div>
</template>

<style scoped>
.progression-builder {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
}

.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.key-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.key-selector label {
  font-size: 12px;
  font-weight: 600;
  color: rgb(91, 101, 110);
}

.key-selector select {
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  font-weight: 600;
}

.play-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, rgb(34, 199, 184), rgb(245, 178, 74));
  color: white;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.play-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 15px rgba(34, 199, 184, 0.3);
}

.progression-slots {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
}

.slot {
  min-height: 80px;
  border-radius: 12px;
  border: 2px dashed rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.slot.filled {
  border-style: solid;
  border-color: rgba(34, 199, 184, 0.4);
  background: rgba(34, 199, 184, 0.08);
}

.empty-slot {
  font-size: 12px;
  color: rgb(119, 129, 138);
}

.chord-card {
  position: relative;
  text-align: center;
}

.chord-card .roman {
  font-size: 16px;
  font-weight: 700;
  color: rgb(34, 199, 184);
}

.chord-card .label {
  font-size: 12px;
  font-weight: 600;
  color: rgb(91, 101, 110);
}

.clear-btn {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgb(240, 106, 90);
  color: white;
  font-size: 10px;
  cursor: pointer;
}

.presets {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  padding-top: 16px;
}

.preset-title {
  font-size: 14px;
  font-weight: 600;
  color: rgb(17, 20, 24);
  margin-bottom: 10px;
}

.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.preset-btn {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-btn:hover {
  border-color: rgba(34, 199, 184, 0.4);
  background: rgba(34, 199, 184, 0.08);
}

.preset-name {
  font-size: 12px;
  font-weight: 600;
  color: rgb(17, 20, 24);
}

.preset-label {
  font-size: 10px;
  color: rgb(91, 101, 110);
}

.chord-selector {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  padding-top: 16px;
}

.selector-title {
  font-size: 14px;
  font-weight: 600;
  color: rgb(17, 20, 24);
  margin-bottom: 10px;
}

.chord-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 8px;
}

.chord-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s ease;
}

.chord-btn:hover {
  border-color: rgba(34, 199, 184, 0.4);
  background: rgba(34, 199, 184, 0.08);
}

.chord-btn .roman {
  font-size: 14px;
  font-weight: 700;
  color: rgb(34, 199, 184);
}

.chord-btn .label {
  font-size: 11px;
  color: rgb(91, 101, 110);
}

.piano-preview {
  margin-top: 10px;
}
</style>
