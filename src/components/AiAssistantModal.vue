<script setup>
import { nextTick, ref, watch } from 'vue';
import UiButton from './UiButton.vue';
import { authFetch } from '../composables/useUser.js';

const props = defineProps({
  open: { type: Boolean, default: false },
});

const emit = defineEmits(['update:open']);

const messages = ref([
  { role: 'assistant', content: '你好，我是 MuseAI 助手。可以问我乐理、和弦、编曲和项目使用相关的问题。' },
]);
const modelProvider = ref('glm');
const thinkingMode = ref('disabled');
const input = ref('');
const isLoading = ref(false);
const error = ref('');
const listRef = ref(null);

const close = () => emit('update:open', false);

const escapeHtml = (text) =>
  String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderInline = (text) => {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/`([^`]+?)`/g, '<code>$1</code>');
  return out;
};

const renderMarkdown = (text) => {
  const raw = String(text || '');
  if (!raw) return '';

  const parts = raw.split(/```/g);
  const blocks = parts.map((chunk, idx) => {
    if (idx % 2 === 1) {
      return `<pre><code>${escapeHtml(chunk.trim())}</code></pre>`;
    }

    const lines = chunk.split(/\r?\n/);
    let html = '';
    let inUl = false;
    let inOl = false;

    const closeLists = () => {
      if (inUl) {
        html += '</ul>';
        inUl = false;
      }
      if (inOl) {
        html += '</ol>';
        inOl = false;
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        closeLists();
        html += '<br />';
        continue;
      }

      const hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        closeLists();
        const level = hMatch[1].length;
        html += `<h${level}>${renderInline(hMatch[2])}</h${level}>`;
        continue;
      }

      const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (ulMatch) {
        if (!inUl) {
          closeLists();
          html += '<ul>';
          inUl = true;
        }
        html += `<li>${renderInline(ulMatch[1])}</li>`;
        continue;
      }

      const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (olMatch) {
        if (!inOl) {
          closeLists();
          html += '<ol>';
          inOl = true;
        }
        html += `<li>${renderInline(olMatch[2])}</li>`;
        continue;
      }

      closeLists();
      html += `<p>${renderInline(trimmed)}</p>`;
    }

    closeLists();
    return html;
  });

  return blocks.join('');
};

const scrollToBottom = async () => {
  await nextTick();
  const el = listRef.value;
  if (el) el.scrollTop = el.scrollHeight;
};

const send = async () => {
  const text = String(input.value || '').trim();
  if (!text || isLoading.value) return;
  input.value = '';
  error.value = '';

  messages.value.push({ role: 'user', content: text });
  await scrollToBottom();

  const payload = {
    messages: messages.value.slice(-12),
    systemPrompt: '你是一名音乐学习助手，回答要简洁、清晰，优先结合乐理与本项目功能。',
    temperature: 0.6,
    provider: modelProvider.value,
    thinkingType: modelProvider.value === 'spark' ? thinkingMode.value : undefined,
  };

  isLoading.value = true;
  try {
    const res = await authFetch('/api/ai-assistant', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || 'AI 请求失败');

    const reply = String(data?.reply || '').trim() || '（暂无回复）';
    const reasoning = String(data?.reasoning || '').trim();
    messages.value.push({ role: 'assistant', content: reply, reasoning });
  } catch (e) {
    error.value = String(e?.message || 'AI 请求失败');
  } finally {
    isLoading.value = false;
    await scrollToBottom();
  }
};

watch(
  () => props.open,
  async (val) => {
    if (val) await scrollToBottom();
  }
);
</script>

<template>
  <div v-if="open" class="ai-assistant-overlay" @click.self="close">
    <div class="ai-assistant-panel">
      <header class="ai-header">
        <div class="title">
          <i class="ph-bold ph-sparkle"></i>
          AI 助手
        </div>
        <div class="subtitle">模型：{{ modelProvider === 'spark' ? 'Spark X1.5' : 'glm-4.6v' }}</div>
        <button class="close-btn" @click="close">
          <i class="ph-bold ph-x"></i>
        </button>
      </header>

      <div class="ai-model-select">
        <span class="label">模型</span>
        <select v-model="modelProvider" :disabled="isLoading">
          <option value="glm">glm-4.6v</option>
          <option value="spark">Spark X1.5</option>
        </select>
        <template v-if="modelProvider === 'spark'">
          <span class="label">思考</span>
          <select v-model="thinkingMode" :disabled="isLoading">
            <option value="enabled">开启</option>
            <option value="auto">自动</option>
            <option value="disabled">关闭</option>
          </select>
        </template>
      </div>

      <div ref="listRef" class="ai-messages">
        <div
          v-for="(msg, idx) in messages"
          :key="`${msg.role}-${idx}`"
          class="msg"
          :class="msg.role"
        >
          <div class="bubble" :class="msg.role === 'assistant' ? 'markdown' : ''">
            <template v-if="msg.role === 'assistant'">
              <div v-html="renderMarkdown(msg.content)"></div>
              <details v-if="msg.reasoning" class="reasoning">
                <summary>思考过程</summary>
                <div v-html="renderMarkdown(msg.reasoning)"></div>
              </details>
            </template>
            <template v-else>
              {{ msg.content }}
            </template>
          </div>
        </div>
        <div v-if="isLoading" class="msg assistant">
          <div class="bubble typing">正在思考…</div>
        </div>
      </div>

      <div v-if="error" class="ai-error">
        <i class="ph-bold ph-warning"></i>
        {{ error }}
      </div>

      <footer class="ai-input">
        <textarea
          v-model="input"
          rows="2"
          placeholder="输入你的问题…"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <UiButton variant="primary" class="send-btn" :disabled="isLoading" @click="send">
          发送
        </UiButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ai-assistant-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 18, 20, 0.35);
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 24px;
  z-index: 60;
}

.ai-assistant-panel {
  width: min(420px, 92vw);
  height: min(640px, 84vh);
  background: rgba(255, 255, 255, 0.95);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.75);
  box-shadow: 0 30px 80px -40px rgba(17, 20, 24, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(18px);
}

.ai-header {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.8);
}

.title {
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgb(17, 20, 24);
}

.subtitle {
  font-size: 12px;
  color: rgb(119, 129, 138);
}

.close-btn {
  grid-row: 1 / span 2;
  justify-self: end;
  align-self: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: none;
  background: rgba(0, 0, 0, 0.06);
  color: rgb(91, 101, 110);
  cursor: pointer;
}

.ai-messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ai-model-select {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 0;
  font-size: 12px;
  color: rgb(91, 101, 110);
}

.ai-model-select select {
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  color: rgb(17, 20, 24);
}

.msg {
  display: flex;
}

.msg.user {
  justify-content: flex-end;
}

.msg.assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 78%;
  padding: 10px 12px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.5;
  background: rgba(34, 199, 184, 0.12);
  color: rgb(17, 20, 24);
}

.msg.user .bubble {
  background: linear-gradient(135deg, rgba(34, 199, 184, 0.9), rgba(245, 178, 74, 0.85));
  color: white;
}

.bubble.typing {
  background: rgba(0, 0, 0, 0.06);
  color: rgb(91, 101, 110);
}

.bubble.markdown :deep(h1),
.bubble.markdown :deep(h2),
.bubble.markdown :deep(h3),
.bubble.markdown :deep(h4) {
  font-weight: 700;
  margin: 8px 0 6px;
}

.bubble.markdown :deep(p) {
  margin: 6px 0;
}

.bubble.markdown :deep(ul),
.bubble.markdown :deep(ol) {
  margin: 6px 0 6px 18px;
  padding: 0;
}

.bubble.markdown :deep(li) {
  margin: 4px 0;
}

.bubble.markdown :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(17, 20, 24, 0.08);
  font-size: 12px;
}

.bubble.markdown :deep(pre) {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(17, 20, 24, 0.08);
  overflow-x: auto;
}

.bubble.markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}

.bubble .reasoning {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed rgba(0, 0, 0, 0.15);
  font-size: 12px;
  color: rgb(91, 101, 110);
}

.bubble .reasoning summary {
  cursor: pointer;
  font-weight: 600;
  color: rgb(17, 20, 24);
  margin-bottom: 6px;
}

.ai-error {
  padding: 8px 12px;
  margin: 0 16px 8px;
  border-radius: 10px;
  background: rgba(240, 106, 90, 0.12);
  color: rgb(240, 106, 90);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-input {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding: 12px 14px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.9);
}

.ai-input textarea {
  resize: none;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
}

.ai-input textarea:focus {
  border-color: rgba(34, 199, 184, 0.5);
  box-shadow: 0 0 0 3px rgba(34, 199, 184, 0.15);
}

.send-btn {
  padding: 0 18px;
  height: 44px;
  border-radius: 12px;
}
</style>
