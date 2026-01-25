<script setup>
/**
 * ChordTrainer - 和弦练习组件
 * 支持和弦构建、和弦听辨
 */
import { computed, ref } from 'vue';
import MiniPiano from './MiniPiano.vue';

const props = defineProps({
  // 练习模式: 'build' (构建) | 'listen' (听辨)
  mode: { type: String, default: 'build' },
  // 可选和弦类型
  chordTypes: {
    type: Array,
    default: () => [
      { name: '大三和弦', suffix: '', intervals: [0, 4, 7] },
      { name: '小三和弦', suffix: 'm', intervals: [0, 3, 7] },
      { name: '减三和弦', suffix: 'dim', intervals: [0, 3, 6] },
      { name: '增三和弦', suffix: 'aug', intervals: [0, 4, 8] },
      { name: '属七和弦', suffix: '7', intervals: [0, 4, 7, 10] },
      { name: '大七和弦', suffix: 'maj7', intervals: [0, 4, 7, 11] },
      { name: '小七和弦', suffix: 'm7', intervals: [0, 3, 7, 10] },
    ],
  },
  // 根音范围（MIDI）
  rootRange: {
    type: Array,
    default: () => [48, 60], // C3-C4
  },
});

const emit = defineEmits(['answer', 'correct', 'wrong']);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const pianoRef = ref(null);
const currentQuestion = ref(null);
const userAnswer = ref(null);
const feedback = ref(null);
const score = ref({ correct: 0, total: 0 });
const showAnswer = ref(false);
const selectedNotes = ref(new Set());

const noteLabel = (midi) => {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
};

const getChordNotes = (root, intervals) => intervals.map(i => root + i);

const generateQuestion = () => {
  feedback.value = null;
  userAnswer.value = null;
  showAnswer.value = false;
  selectedNotes.value = new Set();
  
  // 随机选择和弦类型
  const chordType = props.chordTypes[Math.floor(Math.random() * props.chordTypes.length)];
  
  // 随机选择根音
  const root = props.rootRange[0] + Math.floor(Math.random() * (props.rootRange[1] - props.rootRange[0] + 1));
  const rootNote = root - (root % 12); // 对齐到C
  const rootMidi = rootNote + Math.floor(Math.random() * 12); // 随机音名
  
  currentQuestion.value = {
    root: rootMidi,
    chordType,
    chordNotes: getChordNotes(rootMidi, chordType.intervals),
  };
};

const playChord = async () => {
  if (!currentQuestion.value || !pianoRef.value) return;
  await pianoRef.value.playChord(currentQuestion.value.chordNotes, 1.2);
};

const playArpeggio = async () => {
  if (!currentQuestion.value || !pianoRef.value) return;
  const notes = currentQuestion.value.chordNotes;
  for (let i = 0; i < notes.length; i++) {
    await pianoRef.value.playNote(notes[i], 0.4);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
};

const submitAnswer = (chordType) => {
  if (feedback.value) return;
  
  userAnswer.value = chordType;
  score.value.total++;
  
  const isCorrect = chordType.name === currentQuestion.value.chordType.name;
  
  if (isCorrect) {
    feedback.value = 'correct';
    score.value.correct++;
    emit('correct', { question: currentQuestion.value, answer: chordType });
  } else {
    feedback.value = 'wrong';
    showAnswer.value = true;
    emit('wrong', { question: currentQuestion.value, answer: chordType });
  }
  
  emit('answer', { question: currentQuestion.value, answer: chordType, isCorrect });
};

const handleNoteClick = (midi) => {
  if (props.mode !== 'build' || feedback.value) return;
  
  const next = new Set(selectedNotes.value);
  if (next.has(midi)) {
    next.delete(midi);
  } else {
    next.add(midi);
  }
  selectedNotes.value = next;
  
  // 检查是否完成和弦构建
  if (selectedNotes.value.size === currentQuestion.value.chordNotes.length) {
    const selected = Array.from(selectedNotes.value).sort((a, b) => a - b);
    const target = [...currentQuestion.value.chordNotes].sort((a, b) => a - b);
    
    const isCorrect = selected.length === target.length && selected.every((n, i) => n === target[i]);
    score.value.total++;
    
    if (isCorrect) {
      feedback.value = 'correct';
      score.value.correct++;
      emit('correct', { question: currentQuestion.value, answer: selected });
    } else {
      feedback.value = 'wrong';
      showAnswer.value = true;
      emit('wrong', { question: currentQuestion.value, answer: selected });
    }
  }
};

const nextQuestion = () => {
  generateQuestion();
  if (props.mode === 'listen') {
    setTimeout(playChord, 300);
  }
};

const resetScore = () => {
  score.value = { correct: 0, total: 0 };
};

const highlightNotes = computed(() => {
  if (!currentQuestion.value) return [];
  if (props.mode === 'build') {
    const notes = [currentQuestion.value.root, ...Array.from(selectedNotes.value)];
    return notes;
  }
  if (showAnswer.value) {
    return currentQuestion.value.chordNotes;
  }
  return [];
});

const chordName = computed(() => {
  if (!currentQuestion.value) return '';
  const rootName = NOTE_NAMES[currentQuestion.value.root % 12];
  return rootName + currentQuestion.value.chordType.suffix;
});

// 初始化
generateQuestion();

defineExpose({ generateQuestion, playChord, resetScore });
</script>

<template>
  <div class="chord-trainer">
    <!-- 分数显示 -->
    <div class="score-bar">
      <div class="score">
        <span class="score-correct">{{ score.correct }}</span>
        <span class="score-divider">/</span>
        <span class="score-total">{{ score.total }}</span>
      </div>
      <div class="accuracy" v-if="score.total > 0">
        {{ Math.round(score.correct / score.total * 100) }}%
      </div>
    </div>
    
    <!-- 题目区域 -->
    <div class="question-area">
      <template v-if="mode === 'listen'">
        <div class="question-text">
          听辨这个和弦类型
        </div>
        <div class="chord-display">{{ chordName }}</div>
        <div class="play-controls">
          <button class="play-btn" @click="playChord">
            <i class="ph-bold ph-play"></i>
            同时播放
          </button>
          <button class="play-btn secondary" @click="playArpeggio">
            <i class="ph-bold ph-wave-sine"></i>
            分解播放
          </button>
        </div>
      </template>
      
      <template v-else-if="mode === 'build'">
        <div class="question-text">
          构建和弦：
          <span class="chord-name">{{ chordName }}</span>
        </div>
        <div class="hint">
          点击琴键选择和弦音（再次点击取消）
        </div>
      </template>
    </div>
    
    <!-- 钢琴键盘 -->
    <MiniPiano
      ref="pianoRef"
      :start-note="48"
      :end-note="72"
      :highlight-notes="highlightNotes"
      :target-note="showAnswer ? currentQuestion?.root : null"
      :show-labels="true"
      @note-click="handleNoteClick"
    />
    
    <!-- 选项区域（听辨模式） -->
    <div v-if="mode === 'listen'" class="options-grid">
      <button
        v-for="chordType in chordTypes"
        :key="chordType.name"
        class="option-btn"
        :class="{
          'selected': userAnswer?.name === chordType.name,
          'correct': feedback && currentQuestion?.chordType.name === chordType.name,
          'wrong': feedback === 'wrong' && userAnswer?.name === chordType.name,
        }"
        :disabled="!!feedback"
        @click="submitAnswer(chordType)"
      >
        <span class="chord-suffix">{{ chordType.suffix || '大' }}</span>
        <span class="chord-name">{{ chordType.name }}</span>
      </button>
    </div>
    
    <!-- 反馈区域 -->
    <div v-if="feedback" class="feedback" :class="feedback">
      <div class="feedback-icon">
        <i v-if="feedback === 'correct'" class="ph-bold ph-check-circle"></i>
        <i v-else class="ph-bold ph-x-circle"></i>
      </div>
      <div class="feedback-text">
        <template v-if="feedback === 'correct'">
          正确！这是 {{ currentQuestion?.chordType.name }}
        </template>
        <template v-else>
          不对哦，正确答案是 {{ currentQuestion?.chordType.name }}
        </template>
      </div>
      <button class="next-btn" @click="nextQuestion">
        下一题
        <i class="ph-bold ph-arrow-right"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chord-trainer {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
}

.score-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgba(245, 178, 74, 0.1);
  border-radius: 12px;
}

.score {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-family: var(--font-display);
}

.score-correct {
  font-size: 24px;
  font-weight: 700;
  color: rgb(245, 178, 74);
}

.score-divider {
  font-size: 18px;
  color: rgb(91, 101, 110);
}

.score-total {
  font-size: 18px;
  font-weight: 600;
  color: rgb(91, 101, 110);
}

.accuracy {
  font-size: 14px;
  font-weight: 600;
  color: rgb(245, 178, 74);
}

.question-area {
  text-align: center;
  padding: 16px;
}

.question-text {
  font-size: 18px;
  font-weight: 600;
  color: rgb(17, 20, 24);
  margin-bottom: 12px;
}

.chord-display {
  font-size: 32px;
  font-weight: 700;
  color: rgb(245, 178, 74);
  margin-bottom: 12px;
  font-family: var(--font-display);
}

.chord-name {
  color: rgb(245, 178, 74);
  font-weight: 700;
}

.hint {
  font-size: 14px;
  color: rgb(91, 101, 110);
}

.play-controls {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}

.play-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, rgb(245, 178, 74), rgb(240, 106, 90));
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.play-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 15px rgba(245, 178, 74, 0.3);
}

.play-btn.secondary {
  background: rgba(255, 255, 255, 0.8);
  color: rgb(91, 101, 110);
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.play-btn.secondary:hover {
  background: rgba(245, 178, 74, 0.1);
  color: rgb(245, 178, 74);
  border-color: rgba(245, 178, 74, 0.3);
}

.options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.option-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
  border-radius: 12px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s ease;
}

.option-btn:hover:not(:disabled) {
  border-color: rgba(245, 178, 74, 0.5);
  background: rgba(245, 178, 74, 0.05);
}

.option-btn:disabled {
  cursor: not-allowed;
}

.option-btn.selected {
  border-color: rgb(245, 178, 74);
  background: rgba(245, 178, 74, 0.1);
}

.option-btn.correct {
  border-color: rgb(245, 178, 74);
  background: rgba(245, 178, 74, 0.2);
}

.option-btn.wrong {
  border-color: rgb(240, 106, 90);
  background: rgba(240, 106, 90, 0.1);
}

.chord-suffix {
  font-size: 16px;
  font-weight: 700;
  color: rgb(17, 20, 24);
}

.option-btn.wrong .chord-suffix {
  color: rgb(240, 106, 90);
}

.option-btn.correct .chord-suffix {
  color: rgb(245, 178, 74);
}

.option-btn .chord-name {
  font-size: 11px;
  font-weight: 500;
  color: rgb(91, 101, 110);
}

.feedback {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
}

.feedback.correct {
  background: rgba(245, 178, 74, 0.15);
}

.feedback.wrong {
  background: rgba(240, 106, 90, 0.15);
}

.feedback-icon {
  font-size: 28px;
}

.feedback.correct .feedback-icon {
  color: rgb(245, 178, 74);
}

.feedback.wrong .feedback-icon {
  color: rgb(240, 106, 90);
}

.feedback-text {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: rgb(17, 20, 24);
}

.next-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  background: rgb(245, 178, 74);
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.next-btn:hover {
  background: rgb(230, 160, 60);
}
</style>
