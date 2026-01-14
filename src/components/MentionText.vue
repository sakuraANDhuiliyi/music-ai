<script setup>
import { computed } from 'vue';

const props = defineProps({
  text: { type: String, default: '' },
  highlight: { type: String, default: '' },
});

function isAllowedEmojiUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return false;
  if (url.includes('..')) return false;
  if (url.startsWith('/uploads/')) return true;
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (!String(u.pathname || '').startsWith('/uploads/')) return false;
      const hostname = String(u.hostname || '');
      const localHostname = typeof window !== 'undefined' ? String(window.location.hostname || '') : '';

      const normalizeDevHost = (h) => {
        const v = String(h || '').trim().toLowerCase();
        if (v === 'localhost' || v === '127.0.0.1' || v === '0.0.0.0' || v === '::1') return 'localhost';
        return v;
      };

      if (localHostname && hostname && normalizeDevHost(hostname) !== normalizeDevHost(localHostname)) return false;
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function splitRichText(raw) {
  const text = String(raw || '');
  const parts = [];
  const tokenRe = /\[:e:([^\]\s]+):\]|@([\w\u4e00-\u9fa5]{1,32})/g;

  let lastIndex = 0;
  let match = null;
  while ((match = tokenRe.exec(text)) !== null) {
    const start = match.index;
    if (start > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, start) });

    const emojiUrl = match[1];
    const mentionName = match[2];

    if (emojiUrl) {
      const url = String(emojiUrl || '').trim();
      if (isAllowedEmojiUrl(url)) parts.push({ type: 'emoji', url, value: match[0] });
      else parts.push({ type: 'text', value: match[0] });
    } else if (mentionName) {
      const name = mentionName || '';
      parts.push({ type: 'mention', value: `@${name}`, name, isTarget: props.highlight && name === props.highlight });
    } else {
      parts.push({ type: 'text', value: match[0] });
    }

    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
  return parts;
}

const parts = computed(() => splitRichText(props.text));
</script>

<template>
  <span>
    <template v-for="(p, idx) in parts" :key="idx">
      <span v-if="p.type === 'mention'" class="mention" :class="p.isTarget ? 'mention--target' : ''">
        {{ p.value }}
      </span>
      <img
        v-else-if="p.type === 'emoji'"
        :src="p.url"
        class="emoji"
        loading="lazy"
        alt=""
      />
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

.emoji {
  display: inline-block;
  width: 1.35em;
  height: 1.35em;
  object-fit: contain;
  vertical-align: -0.2em;
  margin: 0 0.08em;
}
</style>
