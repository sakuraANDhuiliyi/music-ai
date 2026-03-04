<script setup>
import { computed, ref } from 'vue';
import MiniPiano from './MiniPiano.vue';

const pianoRef = ref(null);
const rootMidi = 60; // C4

const chordOptions = [
  { key: 'maj7', label: 'Cmaj7', description: '甜美、浪漫、城市夜景感。', notes: [0, 4, 7, 11] },
  { key: '7', label: 'C7', description: '紧张、有蓝调味，想“回家”。', notes: [0, 4, 7, 10] },
  { key: 'm7', label: 'Cm7', description: '柔和、内敛、Lo-fi 氛围。', notes: [0, 3, 7, 10] },
  { key: 'm7b5', label: 'Cm7b5', description: '悬疑、神秘、张力强。', notes: [0, 3, 6, 10] },
  { key: 'maj9', label: 'Cmaj9', description: '更宽、更“空气感”。', notes: [0, 4, 7, 11, 14] },
  { key: 'm11', label: 'Cm11', description: '柔和但更深、更厚。', notes: [0, 3, 7, 10, 14, 17] },
];

const selectedKey = ref(chordOptions[0].key);
const selectedChord = computed(() => chordOptions.find((c) => c.key === selectedKey.value) || chordOptions[0]);

const playChord = async () => {
  if (!pianoRef.value) return;
  const notes = selectedChord.value.notes.map((n) => rootMidi + n);
  await pianoRef.value.playChord(notes, 1.2);
};
</script>

<template>
  <div class="chord-color-lab">
    <div class="top-row">
      <div>
        <div class="title">色彩和弦听感</div>
        <div class="subtitle">选择一个和弦颜色，听它的情绪</div>
      </div>
      <button class="play-btn" @click="playChord">播放</button>
    </div>

    <div class="options">
      <label v-for="option in chordOptions" :key="option.key" class="option">
        <input type="radio" v-model="selectedKey" :value="option.key" />
        <span>{{ option.label }}</span>
      </label>
    </div>

    <div class="description">{{ selectedChord.description }}</div>

    <MiniPiano ref="pianoRef" :start-note="48" :end-note="72" :show-labels="true" />
  </div>
</template>

<style scoped>
.chord-color-lab {
  display: grid;
  gap: 12px;
}

.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.title {
  font-weight: 700;
  color: #0f172a;
}

.subtitle {
  font-size: 0.75rem;
  color: #64748b;
}

.play-btn {
  background: #0f766e;
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #0f172a;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 10px;
  padding: 6px 10px;
}

.description {
  font-size: 0.8rem;
  color: #475569;
}
</style>
