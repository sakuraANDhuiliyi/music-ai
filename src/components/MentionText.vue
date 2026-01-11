<script setup>
import { computed } from 'vue';

const props = defineProps({
  text: { type: String, default: '' },
  highlight: { type: String, default: '' },
});

function splitMentions(raw) {
  const text = String(raw || '');
  const parts = [];
  const mentionRe = /@([\w\u4e00-\u9fa5]{1,32})/g;

  let lastIndex = 0;
  let match = null;
  while ((match = mentionRe.exec(text)) !== null) {
    const start = match.index;
    if (start > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, start) });
    const name = match[1] || '';
    parts.push({ type: 'mention', value: `@${name}`, name, isTarget: props.highlight && name === props.highlight });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
  return parts;
}

const parts = computed(() => splitMentions(props.text));
</script>

<template>
  <span>
    <template v-for="(p, idx) in parts" :key="idx">
      <span v-if="p.type === 'mention'" class="mention" :class="p.isTarget ? 'mention--target' : ''">
        {{ p.value }}
      </span>
      <span v-else>{{ p.value }}</span>
    </template>
  </span>
</template>

<style scoped>
.mention {
  display: inline-block;
  padding: 0.05rem 0.38rem;
  border-radius: 9999px;
  color: rgb(2, 132, 199);
  font-weight: 700;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.22);
}

.mention--target {
  color: rgb(30, 64, 175);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.18), rgba(99, 102, 241, 0.12));
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow: 0 12px 35px -28px rgba(2, 132, 199, 0.7);
}
</style>
