<script setup>
/**
 * PracticeQuiz - 通用选择题练习组件
 * 支持单题或多题模式
 */
import { computed, ref, watch } from 'vue';

const props = defineProps({
  question: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  answerIndex: { type: Number, default: 0 },
  explanation: { type: String, default: '' },
  questions: { type: Array, default: null },
});

const currentIndex = ref(0);
const selectedIndex = ref(null);
const showResult = ref(false);
const score = ref({ correct: 0, total: 0 });

const activeQuestion = computed(() => {
  if (props.questions && props.questions.length) {
    return props.questions[currentIndex.value];
  }
  return {
    question: props.question,
    options: props.options,
    answerIndex: props.answerIndex,
    explanation: props.explanation,
  };
});

const hasMultiple = computed(() => props.questions && props.questions.length);
const progressText = computed(() => {
  if (!hasMultiple.value) return null;
  return `${currentIndex.value + 1} / ${props.questions.length}`;
});

const isCorrect = computed(() => {
  if (selectedIndex.value === null) return null;
  return selectedIndex.value === activeQuestion.value.answerIndex;
});

const selectOption = (index) => {
  if (showResult.value) return;
  selectedIndex.value = index;
  showResult.value = true;
  score.value.total += 1;
  if (index === activeQuestion.value.answerIndex) score.value.correct += 1;
};

const nextQuestion = () => {
  if (!hasMultiple.value) {
    selectedIndex.value = null;
    showResult.value = false;
    return;
  }
  if (currentIndex.value < props.questions.length - 1) {
    currentIndex.value += 1;
  } else {
    currentIndex.value = 0;
  }
  selectedIndex.value = null;
  showResult.value = false;
};

const reset = () => {
  currentIndex.value = 0;
  selectedIndex.value = null;
  showResult.value = false;
  score.value = { correct: 0, total: 0 };
};

watch(() => props.questions, () => {
  reset();
});
</script>

<template>
  <div class="practice-quiz">
    <div class="quiz-header">
      <div class="quiz-title">小测验</div>
      <div class="quiz-meta" v-if="hasMultiple">
        <span class="progress">{{ progressText }}</span>
        <span class="score">{{ score.correct }}/{{ score.total }}</span>
      </div>
    </div>

    <div class="question">{{ activeQuestion.question }}</div>

    <div class="options">
      <button
        v-for="(option, index) in activeQuestion.options"
        :key="option + index"
        class="option"
        :class="{
          selected: selectedIndex === index,
          correct: showResult && index === activeQuestion.answerIndex,
          wrong: showResult && selectedIndex === index && index !== activeQuestion.answerIndex,
        }"
        :disabled="showResult"
        @click="selectOption(index)"
      >
        <span class="option-index">{{ String.fromCharCode(65 + index) }}</span>
        <span class="option-text">{{ option }}</span>
      </button>
    </div>

    <div v-if="showResult" class="result" :class="{ correct: isCorrect, wrong: isCorrect === false }">
      <div class="result-title">
        <template v-if="isCorrect">答对了！</template>
        <template v-else>答错了</template>
      </div>
      <div class="result-explain" v-if="activeQuestion.explanation">{{ activeQuestion.explanation }}</div>
      <button class="next-btn" @click="nextQuestion">下一题</button>
    </div>
  </div>
</template>

<style scoped>
.practice-quiz {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.8);
}

.quiz-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.quiz-title {
  font-size: 14px;
  font-weight: 700;
  color: rgb(17, 20, 24);
}

.quiz-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: rgb(91, 101, 110);
  font-weight: 600;
}

.question {
  font-size: 16px;
  font-weight: 600;
  color: rgb(17, 20, 24);
}

.options {
  display: grid;
  gap: 10px;
}

.option {
  display: grid;
  grid-template-columns: 24px 1fr;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: all 0.2s ease;
}

.option:hover:not(:disabled) {
  border-color: rgba(34, 199, 184, 0.35);
  background: rgba(34, 199, 184, 0.06);
}

.option.selected {
  border-color: rgba(34, 199, 184, 0.6);
}

.option.correct {
  border-color: rgb(34, 199, 184);
  background: rgba(34, 199, 184, 0.15);
}

.option.wrong {
  border-color: rgb(240, 106, 90);
  background: rgba(240, 106, 90, 0.12);
}

.option-index {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: rgba(17, 20, 24, 0.08);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: rgb(91, 101, 110);
}

.option.correct .option-index {
  background: rgba(34, 199, 184, 0.25);
  color: rgb(34, 199, 184);
}

.option.wrong .option-index {
  background: rgba(240, 106, 90, 0.2);
  color: rgb(240, 106, 90);
}

.result {
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(17, 20, 24, 0.04);
}

.result.correct {
  background: rgba(34, 199, 184, 0.12);
}

.result.wrong {
  background: rgba(240, 106, 90, 0.12);
}

.result-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 6px;
}

.result-explain {
  font-size: 12px;
  color: rgb(91, 101, 110);
}

.next-btn {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  border: none;
  background: rgb(34, 199, 184);
  color: white;
  font-weight: 600;
  cursor: pointer;
}
</style>
