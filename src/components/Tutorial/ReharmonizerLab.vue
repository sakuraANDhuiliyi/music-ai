<script setup>
import { computed, ref } from 'vue';
import MiniPiano from './MiniPiano.vue';

const pianoRef = ref(null);

const progressions = [
  {
    key: 'pop',
    label: 'Pop 基础：I–V–vi–IV',
    description: '最常见的流行进行，稳定、回家感强。',
    chords: [
      { name: 'C', notes: [60, 64, 67] },
      { name: 'G', notes: [67, 71, 74] },
      { name: 'Am', notes: [69, 72, 76] },
      { name: 'F', notes: [65, 69, 72] },
    ],
  },
  {
    key: 'secondary',
    label: '副属和弦：I–V/vi–vi–V',
    description: '短暂提亮，引出 vi 的小调情绪。',
    chords: [
      { name: 'C', notes: [60, 64, 67] },
      { name: 'E7', notes: [64, 68, 71, 74] },
      { name: 'Am', notes: [69, 72, 76] },
      { name: 'G', notes: [67, 71, 74] },
    ],
  },
  {
    key: 'tritone',
    label: '三全音替代：ii–Db7–I',
    description: '低音半音下行，听感更丝滑。',
    chords: [
      { name: 'Dm7', notes: [62, 65, 69, 72] },
      { name: 'Db7', notes: [61, 65, 68, 71] },
      { name: 'Cmaj7', notes: [60, 64, 67, 71] },
    ],
  },
  {
    key: 'dark',
    label: '暗色版本：I–iv–I',
    description: '负面色彩，悲伤与深沉。',
    chords: [
      { name: 'C', notes: [60, 64, 67] },
      { name: 'Fm', notes: [65, 68, 72] },
      { name: 'C', notes: [60, 64, 67] },
    ],
  },
];

const selectedKey = ref(progressions[0].key);
const selectedProgression = computed(() => progressions.find((p) => p.key === selectedKey.value) || progressions[0]);

const playProgression = async () => {
  if (!pianoRef.value) return;
  for (const chord of selectedProgression.value.chords) {
    await pianoRef.value.playChord(chord.notes, 0.9);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
};
</script>

<template>
  <div class="reharmonizer">
    <div class="header">
      <div>
        <div class="title">再和声实验室</div>
        <div class="subtitle">同一旋律，不同和弦颜色</div>
      </div>
      <button class="play-btn" @click="playProgression">播放进行</button>
    </div>

    <div class="options">
      <label v-for="option in progressions" :key="option.key" class="option">
        <input type="radio" v-model="selectedKey" :value="option.key" />
        <span>{{ option.label }}</span>
      </label>
    </div>

    <div class="description">{{ selectedProgression.description }}</div>

    <div class="chord-line">
      <span v-for="(chord, idx) in selectedProgression.chords" :key="chord.name + idx" class="chip">
        {{ chord.name }}
      </span>
    </div>

    <MiniPiano ref="pianoRef" :start-note="48" :end-note="72" :show-labels="true" />
  </div>
</template>

<style scoped>
.reharmonizer {
  display: grid;
  gap: 12px;
}

.header {
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
  background: #2563eb;
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

.chord-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}
</style>
