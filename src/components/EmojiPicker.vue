<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { authFetch, useUser } from '../composables/useUser.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  target: { type: Object, default: null }, // ref<HTMLInputElement|HTMLTextAreaElement>
  disabled: { type: Boolean, default: false },
  size: { type: String, default: 'md' }, // sm | md
});

const emit = defineEmits(['update:modelValue']);

const { user, isAuthReady } = useUser();

const rootEl = ref(null);
const isOpen = ref(false);
const activeTab = ref('default'); // default | custom

const isUploading = ref(false);
const uploadError = ref('');
const fileEl = ref(null);
const customEmojis = ref([]); // [{id,url,name,createdAt}]
const isCustomLoading = ref(false);

const DEFAULT_EMOJIS = Object.freeze([
  '😀', '😁', '😂', '🤣', '😅', '😊', '😍', '😘', '😗', '😙', '😚', '😋',
  '😎', '🤩', '🥳', '😏', '😶', '🙄', '😴', '😮', '😳', '😭', '😡', '🤯',
  '👍', '👎', '👏', '🙏', '🔥', '💯', '🎉', '💡', '✨', '🌙', '☕', '🍀',
]);

const canUse = computed(() => !props.disabled && isAuthReady.value && Boolean(user.value));
const btnClass = computed(() =>
  props.size === 'sm'
    ? 'w-9 h-9 rounded-xl'
    : 'w-10 h-10 rounded-xl'
);
const iconClass = computed(() => (props.size === 'sm' ? 'text-base' : 'text-lg'));

const close = () => { isOpen.value = false; };
const toggle = async () => {
  uploadError.value = '';
  if (!canUse.value) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value && activeTab.value === 'custom') await loadCustom();
};

const onDocDown = (e) => {
  const root = rootEl.value;
  if (!root) return;
  if (root.contains(e.target)) return;
  close();
};

watch(isOpen, (v) => {
  if (v) document.addEventListener('pointerdown', onDocDown, { passive: true });
  else document.removeEventListener('pointerdown', onDocDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown);
});

const loadCustom = async () => {
  if (!canUse.value) return;
  isCustomLoading.value = true;
  try {
    const res = await authFetch('/api/emojis');
    const data = res.ok ? await res.json() : null;
    customEmojis.value = Array.isArray(data) ? data : [];
  } catch {
    customEmojis.value = [];
  } finally {
    isCustomLoading.value = false;
  }
};

const insertAtCursor = async (insertText) => {
  const cur = String(props.modelValue || '');
  const el = props.target?.value;

  if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = cur.slice(0, start) + insertText + cur.slice(end);
    emit('update:modelValue', next);
    await nextTick();
    try {
      el.focus?.();
      const caret = start + insertText.length;
      el.setSelectionRange?.(caret, caret);
    } catch {
      // ignore
    }
    return;
  }

  emit('update:modelValue', cur + insertText);
};

const pickDefault = async (emoji) => {
  await insertAtCursor(String(emoji || ''));
  close();
};

const pickCustom = async (url) => {
  const u = String(url || '').trim();
  if (!u) return;
  await insertAtCursor(`[:e:${u}:]`);
  close();
};

const triggerUpload = async () => {
  if (!canUse.value) return;
  uploadError.value = '';
  activeTab.value = 'custom';
  isOpen.value = true;
  // Keep the file picker inside a direct user gesture; don't await before click.
  fileEl.value?.click?.();
  loadCustom();
};

const onPickFile = async (e) => {
  const file = e?.target?.files?.[0];
  if (!file) return;
  uploadError.value = '';

  if (!file.type?.startsWith?.('image/')) {
    uploadError.value = '仅支持图片文件';
    return;
  }
  if ((file.size || 0) > 5 * 1024 * 1024) {
    uploadError.value = '图片过大（最大 5MB）';
    return;
  }

  isUploading.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', String(file.name || '').replace(/\.[^/.]+$/, '').slice(0, 48));

    const res = await authFetch('/api/emojis/upload', { method: 'POST', body: fd });
    const data = res.ok ? await res.json() : null;
    if (!res.ok) throw new Error(data?.message || '上传失败');

    customEmojis.value = [{ ...data }, ...(customEmojis.value || [])].slice(0, 120);
  } catch (err) {
    uploadError.value = err?.message || '上传失败';
  } finally {
    isUploading.value = false;
    try {
      if (fileEl.value) fileEl.value.value = '';
    } catch {
      // ignore
    }
  }
};

const removeCustom = async (emoji) => {
  const id = String(emoji?.id || '').trim();
  if (!id) return;
  const prev = [...(customEmojis.value || [])];
  customEmojis.value = prev.filter((e) => String(e.id) !== id);
  try {
    const res = await authFetch(`/api/emojis/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) customEmojis.value = prev;
  } catch {
    customEmojis.value = prev;
  }
};

const switchTab = async (tab) => {
  activeTab.value = tab;
  if (tab === 'custom' && isOpen.value) await loadCustom();
};
</script>

<template>
  <div ref="rootEl" class="relative inline-flex items-center">
    <button
      type="button"
      class="border border-white/70 bg-white/60 backdrop-blur-xl text-slate-700 hover:bg-white/75 hover:text-slate-900 transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
      :class="btnClass"
      :disabled="!canUse"
      @click="toggle"
      aria-label="表情"
    >
      <i class="ph-bold ph-smiley" :class="iconClass"></i>
    </button>

    <input ref="fileEl" type="file" accept="image/*" class="hidden" @change="onPickFile" />

    <div
      v-if="isOpen"
      class="absolute left-0 mt-2 w-[min(420px,calc(100vw-2rem))] glass-card rounded-2xl border border-white/70 overflow-hidden shadow-2xl z-50"
    >
      <div class="px-4 py-3 border-b border-slate-200/70 bg-white/35 flex items-center justify-between gap-2">
        <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <i class="ph-bold ph-smiley text-sky-700"></i>
          表情
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="text-xs font-semibold px-2.5 py-1 rounded-lg border transition"
            :class="activeTab === 'default' ? 'bg-sky-500/10 text-sky-700 border-sky-500/20' : 'bg-white/45 text-slate-600 border-white/70 hover:bg-white/60'"
            @click="switchTab('default')"
          >
            小黄脸
          </button>
          <button
            type="button"
            class="text-xs font-semibold px-2.5 py-1 rounded-lg border transition"
            :class="activeTab === 'custom' ? 'bg-sky-500/10 text-sky-700 border-sky-500/20' : 'bg-white/45 text-slate-600 border-white/70 hover:bg-white/60'"
            @click="switchTab('custom')"
          >
            我的表情
          </button>
        </div>
      </div>

      <div class="p-3 max-h-[280px] overflow-y-auto overscroll-contain touch-pan-y emoji-scroll">
        <div v-if="activeTab === 'default'" class="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
          <button
            v-for="e in DEFAULT_EMOJIS"
            :key="e"
            type="button"
            class="w-9 h-9 rounded-xl hover:bg-white/55 border border-transparent hover:border-white/70 transition flex items-center justify-center text-xl"
            @click="pickDefault(e)"
            :title="e"
          >
            {{ e }}
          </button>
        </div>

        <div v-else class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-semibold text-slate-600">
              自定义表情（{{ customEmojis.length }}/80）
              <span v-if="uploadError" class="text-rose-600 ml-2">{{ uploadError }}</span>
            </div>
            <button
              type="button"
              class="text-xs font-semibold text-sky-700 hover:text-sky-600 transition inline-flex items-center gap-1"
              :disabled="isUploading"
              @click="triggerUpload"
            >
              <i class="ph-bold ph-plus"></i>
              添加
            </button>
          </div>

          <div v-if="isCustomLoading" class="grid grid-cols-6 sm:grid-cols-8 gap-2">
            <div v-for="n in 16" :key="n" class="h-10 rounded-xl skeleton"></div>
          </div>

          <div v-else-if="!customEmojis.length" class="text-sm text-slate-500 p-3 rounded-xl bg-white/45 border border-white/70">
            还没有自定义表情，点右上角「添加」上传一张图片吧。
          </div>

          <div v-else class="grid grid-cols-6 sm:grid-cols-8 gap-2">
            <div v-for="it in customEmojis" :key="it.id" class="relative group">
              <button
                type="button"
                class="w-10 h-10 rounded-xl bg-white/55 border border-white/70 hover:bg-white/70 transition overflow-hidden flex items-center justify-center"
                @click="pickCustom(it.url)"
                :title="it.name || '表情'"
              >
                <img :src="it.url" class="w-full h-full object-contain" loading="lazy" />
              </button>
              <button
                type="button"
                class="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-black/55 text-white items-center justify-center hidden group-hover:flex"
                @click.stop="removeCustom(it)"
                aria-label="删除表情"
              >
                <i class="ph-bold ph-x text-xs"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="px-3 py-2 border-t border-slate-200/70 bg-white/30 flex items-center justify-between">
        <div class="text-[11px] text-slate-500 font-semibold">
          点击插入表情
        </div>
        <button type="button" class="text-xs font-semibold text-slate-600 hover:text-slate-900 transition" @click="close">
          关闭
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.emoji-scroll {
  -webkit-overflow-scrolling: touch;
}
</style>
