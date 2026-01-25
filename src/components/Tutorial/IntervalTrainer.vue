<script setup>
/**
 * IntervalTrainer - 音程训练组件
 * 支持音程听辨、音程构建等练习
 */
import { computed, ref } from 'vue';
import MiniPiano from './MiniPiano.vue';

const props = defineProps({
  // 练习模式: 'listen' (听辨) | 'build' (构建)
  mode: { type: String, default: 'listen' },
  // 可选音程类型
  intervals: {
    type: Array,
    default: () => [
      { semitones: 0, name: '纯一度', abbr: 'P1' },
      { semitones: 1, name: '小二度', abbr: 'm2' },
      { semitones: 2, name: '大二度', abbr: 'M2' },
      { semitones: 3, name: '小三度', abbr: 'm3' },
      { semitones: 4, name: '大三度', abbr: 'M3' },
      { semitones: 5, name: '纯四度', abbr: 'P4' },
      { semitones: 6, name: '增四度/减五度', abbr: 'TT' },
      { semitones: 7, name: '纯五度', abbr: 'P5' },
      { semitones: 8, name: '小六度', abbr: 'm6' },
      { semitones: 9, name: '大六度', abbr: 'M6' },
      { semitones: 10, name: '小七度', abbr: 'm7' },
      { semitones: 11, name: '大七度', abbr: 'M7' },
      { semitones: 12, name: '纯八度', abbr: 'P8' },
    ],
  },
  // 难度限制（只显示前N个音程）
  difficulty: { type: Number, default: 8 },
});

const emit = defineEmits(['answer', 'correct', 'wrong']);

const pianoRef = ref(null);
const currentQuestion = ref(null);
const userAnswer = ref(null);
const feedback = ref(null); // 'correct' | 'wrong' | null
const score = ref({ correct: 0, total: 0 });
const showAnswer = ref(false);
const selectedNote = ref(null);

// 根据难度筛选可用音程
const availableIntervals = computed(() => {
  return props.intervals.slice(0, props.difficulty);
});

// 生成随机题目
const generateQuestion = () => {
  feedback.value = null;
  userAnswer.value = null;
  showAnswer.value = false;
  selectedNote.value = null;
  
  // 随机选择音程
  const intervalIndex = Math.floor(Math.random() * availableIntervals.value.length);
  const interval = availableIntervals.value[intervalIndex];
  
  // 随机选择起始音（C3-C5范围）
  const baseNote = 48 + Math.floor(Math.random() * 24);
  const targetNote = baseNote + interval.semitones;
  
  // 随机方向（上行/下行）
  const ascending = Math.random() > 0.3; // 70%上行
  
  currentQuestion.value = {
    interval,
    baseNote: ascending ? baseNote : targetNote,
    targetNote: ascending ? targetNote : baseNote,
    ascending,
  };
};

// 播放当前音程
const playInterval = async () => {
  if (!currentQuestion.value || !pianoRef.value) return;
  
  const { baseNote, targetNote } = currentQuestion.value;
  
  // 先播放第一个音
  await pianoRef.value.playNote(baseNote, 0.6);
  
  // 延迟播放第二个音
  setTimeout(() => {
    pianoRef.value.playNote(targetNote, 0.8);
  }, 700);
};

// 同时播放两个音（和声音程）
const playHarmonic = async () => {
  if (!currentQuestion.value || !pianoRef.value) return;
  
  const { baseNote, targetNote } = currentQuestion.value;
  await pianoRef.value.playChord([baseNote, targetNote], 1.2);
};

// 处理用户答案（听辨模式）
const submitAnswer = (interval) => {
  if (feedback.value) return;
  
  userAnswer.value = interval;
  score.value.total++;
  
  const isCorrect = interval.semitones === currentQuestion.value.interval.semitones;
  
  if (isCorrect) {
    feedback.value = 'correct';
    score.value.correct++;
    emit('correct', { question: currentQuestion.value, answer: interval });
  } else {
    feedback.value = 'wrong';
    showAnswer.value = true;
    emit('wrong', { question: currentQuestion.value, answer: interval });
  }
  
  emit('answer', { question: currentQuestion.value, answer: interval, isCorrect });
};

// 处理用户点击琴键（构建模式）
const handleNoteClick = (midi) => {
  if (props.mode !== 'build' || feedback.value) return;
  
  selectedNote.value = midi;
  
  const isCorrect = midi === currentQuestion.value.targetNote;
  score.value.total++;
  
  if (isCorrect) {
    feedback.value = 'correct';
    score.value.correct++;
    emit('correct', { question: currentQuestion.value, answer: midi });
  } else {
    feedback.value = 'wrong';
    showAnswer.value = true;
    emit('wrong', { question: currentQuestion.value, answer: midi });
  }
};

// 下一题
const nextQuestion = () => {
  generateQuestion();
  
  // 自动播放新题目
  setTimeout(playInterval, 300);
};

// 重置分数
const resetScore = () => {
  score.value = { correct: 0, total: 0 };
};

// 高亮音符
const highlightNotes = computed(() => {
  if (!currentQuestion.value) return [];
  if (props.mode === 'build') {
    return [currentQuestion.value.baseNote];
  }
  if (showAnswer.value) {
    return [currentQuestion.value.baseNote, currentQuestion.value.targetNote];
  }
  return [];
});

// 初始化
generateQuestion();

defineExpose({ generateQuestion, playInterval, resetScore });
</script>

<template>
  <div class="interval-trainer">
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
          听辨这个音程
        </div>
        <div class="play-controls">
          <button class="play-btn" @click="playInterval">
            <i class="ph-bold ph-play"></i>
            旋律播放
          </button>
          <button class="play-btn secondary" @click="playHarmonic">
            <i class="ph-bold ph-speaker-high"></i>
            和声播放
          </button>
        </div>
      </template>
      
      <template v-else-if="mode === 'build'">
        <div class="question-text">
          从高亮音开始，构建一个
          <span class="interval-name">{{ currentQuestion?.interval.name }}</span>
        </div>
        <div class="hint">
          点击正确的目标音
        </div>
      </template>
    </div>
    
    <!-- 钢琴键盘 -->
    <MiniPiano
      ref="pianoRef"
      :start-note="48"
      :end-note="72"
      :highlight-notes="highlightNotes"
      :target-note="showAnswer ? currentQuestion?.targetNote : null"
      :show-labels="true"
      @note-click="handleNoteClick"
    />
    
    <!-- 选项区域（听辨模式） -->
    <div v-if="mode === 'listen'" class="options-grid">
      <button
        v-for="interval in availableIntervals"
        :key="interval.semitones"
        class="option-btn"
        :class="{
          'selected': userAnswer?.semitones === interval.semitones,
          'correct': feedback && currentQuestion?.interval.semitones === interval.semitones,
          'wrong': feedback === 'wrong' && userAnswer?.semitones === interval.semitones,
        }"
        :disabled="!!feedback"
        @click="submitAnswer(interval)"
      >
        <span class="interval-abbr">{{ interval.abbr }}</span>
        <span class="interval-name">{{ interval.name }}</span>
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
          正确！这是 {{ currentQuestion?.interval.name }}
        </template>
        <template v-else>
          不对哦，正确答案是 {{ currentQuestion?.interval.name }}
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
.interval-trainer {
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
  background: rgba(34, 199, 184, 0.1);
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
  color: rgb(34, 199, 184);
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
  color: rgb(34, 199, 184);
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

.interval-name {
  color: rgb(34, 199, 184);
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
  background: linear-gradient(135deg, rgb(34, 199, 184), rgb(245, 178, 74));
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.play-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 15px rgba(34, 199, 184, 0.3);
}

.play-btn.secondary {
  background: rgba(255, 255, 255, 0.8);
  color: rgb(91, 101, 110);
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.play-btn.secondary:hover {
  background: rgba(34, 199, 184, 0.1);
  color: rgb(34, 199, 184);
  border-color: rgba(34, 199, 184, 0.3);
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
  border-color: rgba(34, 199, 184, 0.5);
  background: rgba(34, 199, 184, 0.05);
}

.option-btn:disabled {
  cursor: not-allowed;
}

.option-btn.selected {
  border-color: rgb(34, 199, 184);
  background: rgba(34, 199, 184, 0.1);
}

.option-btn.correct {
  border-color: rgb(34, 199, 184);
  background: rgba(34, 199, 184, 0.2);
}

.option-btn.wrong {
  border-color: rgb(240, 106, 90);
  background: rgba(240, 106, 90, 0.1);
}

.interval-abbr {
  font-size: 16px;
  font-weight: 700;
  color: rgb(17, 20, 24);
}

.option-btn.wrong .interval-abbr {
  color: rgb(240, 106, 90);
}

.option-btn.correct .interval-abbr {
  color: rgb(34, 199, 184);
}

.option-btn .interval-name {
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
  background: rgba(34, 199, 184, 0.15);
}

.feedback.wrong {
  background: rgba(240, 106, 90, 0.15);
}

.feedback-icon {
  font-size: 28px;
}

.feedback.correct .feedback-icon {
  color: rgb(34, 199, 184);
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
  background: rgb(34, 199, 184);
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.next-btn:hover {
  background: rgb(28, 170, 158);
}
</style>
