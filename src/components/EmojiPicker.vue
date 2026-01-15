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
const scrollContainerRef = ref(null);
const isOpen = ref(false);
const activeCat = ref('emoji'); // emoji | pack_img | pack_gif | custom
const openUp = ref(false);
const alignRight = ref(false);
const popoverEl = ref(null);
const popoverStyle = ref({});

const fileEl = ref(null);
const isUploading = ref(false);
const uploadError = ref('');
const customEmojis = ref([]); // [{id,url,name,createdAt}]
const isCustomLoading = ref(false);
const isPublicPacksLoading = ref(false);
const publicPackGif = ref([]);
const publicPackImg = ref([]);
const didLoadPublicPacks = ref(false);

const DEFAULT_EMOJIS = Object.freeze([
  '😀', '😁', '😂', '🤣', '😅', '😊', '😍', '😘', '😗', '😙', '😚', '😋',
  '😎', '🤩', '🥳', '😏', '😶', '🙄', '😴', '😮', '😳', '😭', '😡', '🤯',
  '👍', '👎', '👏', '🙏', '🔥', '💯', '🎉', '💡', '✨', '🌙', '☕', '🍀',
]);

const makeSeqFilenames = (prefix, count, pad, ext) => Object.freeze(
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(pad, '0')}${ext}`)
);

// 对应 public/emoji/GIF 下的文件：gif01.gif ~ gif42.gif
const PUBLIC_PACK_GIF = makeSeqFilenames('gif', 42, 2, '.gif');

// 对应 public/emoji/PIC 下的文件：img001.jpg ~ img037.jpg
const PUBLIC_PACK_IMG = makeSeqFilenames('img', 37, 3, '.jpg');

const canUse = computed(() => !props.disabled && isAuthReady.value && Boolean(user.value));
const btnClass = computed(() => (props.size === 'sm' ? 'w-9 h-9 rounded-xl' : 'w-10 h-10 rounded-xl'));
const iconClass = computed(() => (props.size === 'sm' ? 'text-base' : 'text-lg'));

const catMeta = Object.freeze({
  emoji: { label: '小黄脸', icon: 'ph-bold ph-smiley', kind: 'unicode' },
  pack_img: { label: '表情包', icon: 'ph-bold ph-image', kind: 'sticker' },
  pack_gif: { label: 'GIF', icon: 'ph-bold ph-film-strip', kind: 'sticker' },
  custom: { label: '我的表情', icon: 'ph-bold ph-star', kind: 'sticker' },
});

const currentMeta = computed(() => catMeta[activeCat.value] || catMeta.emoji);

const close = () => { isOpen.value = false; };
const toggle = async () => {
  uploadError.value = '';
  if (!canUse.value) return;
  isOpen.value = !isOpen.value;
};

const computePlacement = () => {
  try {
    const root = rootEl.value;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const viewportH = window.innerHeight || 0;
    const viewportW = window.innerWidth || 0;

    const estimatedPopoverH = 420;
    const spaceBelow = viewportH - rect.bottom;
    const spaceAbove = rect.top;
    openUp.value = spaceBelow < estimatedPopoverH && spaceAbove > estimatedPopoverH * 0.6;

    const estimatedPopoverW = 420;
    alignRight.value = rect.left + estimatedPopoverW > viewportW - 16;

    const width = Math.min(420, Math.max(280, viewportW - 32));
    const gap = 8;

    let left = alignRight.value ? rect.right - width : rect.left;
    left = Math.max(16, Math.min(left, viewportW - width - 16));

    if (openUp.value) {
      const bottom = Math.max(16, viewportH - rect.top + gap);
      popoverStyle.value = {
        left: `${Math.round(left)}px`,
        bottom: `${Math.round(bottom)}px`,
        width: `${Math.round(width)}px`,
      };
    } else {
      const top = Math.max(16, rect.bottom + gap);
      popoverStyle.value = {
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        width: `${Math.round(width)}px`,
      };
    }
  } catch {
    // ignore
  }
};

const onViewportChange = () => computePlacement();

const onDocDown = (e) => {
  const root = rootEl.value;
  if (!root) return;
  if (root.contains(e.target)) return;
  const popover = popoverEl.value;
  if (popover && popover.contains(e.target)) return;
  close();
};

watch(isOpen, async (v) => {
  if (v) {
    await nextTick();
    if (scrollContainerRef.value) scrollContainerRef.value.scrollTop = 0;
    computePlacement();
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('scroll', onViewportChange, true);
    document.addEventListener('pointerdown', onDocDown, { passive: true });
  } else {
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
    document.removeEventListener('pointerdown', onDocDown);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
  document.removeEventListener('pointerdown', onDocDown);
});

const setCat = async (id) => {
  if (!catMeta[id]) return;
  activeCat.value = id;
  uploadError.value = '';
  // 切换分类时滚动到顶部
  await nextTick();
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollTop = 0;
  }
  if (isOpen.value && id === 'custom') await loadCustom();
  if (isOpen.value && (id === 'pack_img' || id === 'pack_gif')) await loadPublicPacks();
};

watch(
  () => [isOpen.value, activeCat.value, user.value?.uid],
  async ([open, cat]) => {
    if (!open) return;
    if (cat === 'custom') await loadCustom();
    if (cat === 'pack_img' || cat === 'pack_gif') await loadPublicPacks();
  }
);

const loadPublicPacks = async () => {
  if (didLoadPublicPacks.value || isPublicPacksLoading.value) return;
  isPublicPacksLoading.value = true;
  try {
    const res = await fetch('/api/emoji-packs');
    const data = res.ok ? await res.json() : null;
    const pic = Array.isArray(data?.pic) ? data.pic : [];
    const gif = Array.isArray(data?.gif) ? data.gif : [];
    publicPackImg.value = pic.length ? pic : PUBLIC_PACK_IMG;
    publicPackGif.value = gif.length ? gif : PUBLIC_PACK_GIF;
    didLoadPublicPacks.value = true;
  } catch {
    publicPackImg.value = PUBLIC_PACK_IMG;
    publicPackGif.value = PUBLIC_PACK_GIF;
    didLoadPublicPacks.value = true;
  } finally {
    isPublicPacksLoading.value = false;
  }
};

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

const publicUrl = (basePath, filename) => {
  const base = encodeURI(String(basePath || '').replace(/\/+$/, ''));
  const name = encodeURIComponent(String(filename || '').trim());
  return `${base}/${name}`;
};

const allItems = computed(() => {
  const cat = activeCat.value;
  if (cat === 'emoji') return DEFAULT_EMOJIS.map((v) => ({ kind: 'unicode', value: v, key: v, title: v }));
  if (cat === 'pack_gif') return (publicPackGif.value?.length ? publicPackGif.value : PUBLIC_PACK_GIF).map((f) => ({ kind: 'sticker', url: publicUrl('/emoji/GIF', f), key: f, title: f }));
  if (cat === 'pack_img') return (publicPackImg.value?.length ? publicPackImg.value : PUBLIC_PACK_IMG).map((f) => ({ kind: 'sticker', url: publicUrl('/emoji/PIC', f), key: f, title: f }));
  return (customEmojis.value || []).map((e) => ({ kind: 'custom', id: e.id, url: e.url, key: e.id || e.url, title: e.name || '表情' }));
});
const displayItems = computed(() => allItems.value);

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

const pickUnicode = async (emoji) => {
  await insertAtCursor(String(emoji || ''));
  close();
};

const pickSticker = async (url) => {
  const u = String(url || '').trim();
  if (!u) return;
  await insertAtCursor(`[:e:${u}:]`);
  close();
};

const triggerUpload = () => {
  if (!canUse.value) return;
  uploadError.value = '';
  activeCat.value = 'custom';
  isOpen.value = true;
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

const gridClass = computed(() => 'emoji-grid');
const onStickerError = (e) => {
  try {
    const img = e?.target;
    if (!img) return;
    img.style.opacity = '0.35';
    img.style.filter = 'grayscale(1)';
  } catch {
    // ignore
  }
};

const popoverClass = computed(() => {
  return 'fixed glass-card rounded-2xl border border-white/70 overflow-hidden shadow-2xl z-50';
});
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

    <teleport to="body">
      <div
        v-if="isOpen"
        ref="popoverEl"
        :class="popoverClass"
        :style="popoverStyle"
      >
      <div class="px-4 py-3 border-b border-slate-200/70 bg-white/35 flex items-center justify-between gap-2">
        <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2 min-w-0">
          <i :class="currentMeta.icon" class="text-sky-700"></i>
          <span class="truncate">{{ currentMeta.label }}</span>
          <span v-if="activeCat === 'custom'" class="text-[11px] font-semibold text-slate-500 truncate">
            {{ customEmojis.length }}/80
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="activeCat === 'custom'"
            type="button"
            class="text-xs font-semibold text-sky-700 hover:text-sky-600 transition inline-flex items-center gap-1 disabled:opacity-60"
            :disabled="isUploading"
            @click="triggerUpload"
          >
            <i class="ph-bold ph-plus"></i>
            添加
          </button>
          <button type="button" class="w-8 h-8 rounded-xl hover:bg-white/55 transition flex items-center justify-center" @click="close" aria-label="关闭">
            <i class="ph-bold ph-x text-slate-500"></i>
          </button>
        </div>
      </div>

      <div ref="scrollContainerRef" class="emoji-scroll-container">
        <div v-if="uploadError" class="mb-2 text-xs font-semibold text-rose-700 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
          {{ uploadError }}
        </div>

        <div v-if="(activeCat === 'pack_img' || activeCat === 'pack_gif') && isPublicPacksLoading" class="grid grid-cols-6 sm:grid-cols-8 gap-2">
          <div v-for="n in 16" :key="n" class="h-10 rounded-xl skeleton"></div>
        </div>

        <div v-else-if="activeCat === 'custom' && isCustomLoading" class="grid grid-cols-6 sm:grid-cols-8 gap-2">
          <div v-for="n in 16" :key="n" class="h-10 rounded-xl skeleton"></div>
        </div>

        <div v-else-if="activeCat === 'custom' && !customEmojis.length" class="text-sm text-slate-500 p-3 rounded-xl bg-white/45 border border-white/70">
          还没有自定义表情，点右上角「添加」上传一张图片/GIF 吧。
        </div>

        <div v-else :class="gridClass">
          <button
            v-for="it in displayItems"
            :key="it.key"
            type="button"
            class="emoji-item"
            :title="it.title"
            @click="it.kind === 'unicode' ? pickUnicode(it.value) : pickSticker(it.url)"
          >
            <span v-if="it.kind === 'unicode'" class="text-xl leading-none">{{ it.value }}</span>
            <span v-else class="sticker-box">
              <img :src="it.url" class="sticker-img" loading="lazy" alt="" @error="onStickerError" />
            </span>

            <button
              v-if="activeCat === 'custom' && it.id"
              type="button"
              class="remove-btn"
              @click.stop="removeCustom(it)"
              aria-label="删除表情"
            >
              <i class="ph-bold ph-x text-xs"></i>
            </button>
          </button>
        </div>
      </div>

      <div class="px-3 py-2 border-t border-slate-200/70 bg-white/30 flex items-center justify-between gap-2">
        <div class="flex items-center gap-1">
          <button
            v-for="cid in ['emoji','pack_img','pack_gif','custom']"
            :key="cid"
            type="button"
            class="cat-btn"
            :class="activeCat === cid ? 'cat-btn--active' : ''"
            @click="setCat(cid)"
            :aria-label="catMeta[cid].label"
          >
            <i :class="catMeta[cid].icon"></i>
          </button>
        </div>
        <div class="text-[11px] font-semibold text-slate-500">
          向下滑动查看更多
        </div>
      </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.emoji-scroll-container {
  padding: 12px;
  max-height: 320px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scroll-behavior: smooth;
}

/* 自定义滚动条样式 */
.emoji-scroll-container::-webkit-scrollbar {
  width: 6px;
}
.emoji-scroll-container::-webkit-scrollbar-track {
  background: transparent;
}
.emoji-scroll-container::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.4);
  border-radius: 3px;
}
.emoji-scroll-container::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.6);
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 44px);
  gap: 8px;
  justify-content: start;
}

.emoji-item {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.5);
  transition: transform 140ms ease, background-color 140ms ease, border-color 140ms ease;
  flex-shrink: 0;
}
.emoji-item:hover {
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(56, 189, 248, 0.35);
  transform: translateY(-1px);
}
.sticker-box {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sticker-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.remove-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  display: none;
  align-items: center;
  justify-content: center;
}
.emoji-item:hover .remove-btn {
  display: inline-flex;
}
.cat-btn {
  width: 36px;
  height: 30px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.35);
  color: rgb(100, 116, 139);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}
.cat-btn:hover {
  background: rgba(255, 255, 255, 0.55);
  color: rgb(15, 23, 42);
}
.cat-btn--active {
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.22);
  color: rgb(2, 132, 199);
}
</style>
