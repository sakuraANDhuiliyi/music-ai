<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';
import EmojiPicker from '../components/EmojiPicker.vue';
import MentionText from '../components/MentionText.vue';
import { clearCache, fetchCached } from '../utils/resourceCache.js';

const router = useRouter();
const { user, isAuthReady } = useUser();

const items = ref([]);
const isLoading = ref(true);
const errorMsg = ref('');

const draftContent = ref('');
const postError = ref('');
const isPosting = ref(false);
const imageInput = ref(null);
const composerEl = ref(null);
const pickedImages = ref([]); // [{ file, previewUrl }]

const FEED_TYPES = Object.freeze(['followed_project', 'followed_post']);

const ensureLoggedIn = () => {
  if (!isAuthReady.value) return false;
  if (user.value) return true;
  router.push('/login');
  return false;
};

const coverStyle = (cover) => {
  const c = String(cover || '').trim();
  if (!c) return { background: 'linear-gradient(135deg,rgba(56,189,248,0.28),rgba(99,102,241,0.22))' };
  if (/^(https?:)?\/\//.test(c) || c.startsWith('/') || c.startsWith('data:')) {
    return { backgroundImage: `url(${c})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: c };
};

const timeAgo = (dateStr) => {
  const t = new Date(dateStr || 0).getTime();
  if (!t) return '';
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(t).toLocaleDateString();
};

const markAllRead = async () => {
  if (!user.value) return;
  try {
    if (force) clearCache(cacheKey);
    const cached = await fetchCached(
      cacheKey,
      async () => {
        const res = await authFetch('/api/notifications?types=followed_project,followed_post&limit=50');
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.message || '加载失败');
        return Array.isArray(json) ? json : [];
      },
      { ttlMs: 20_000, staleWhileRevalidate: true }
    );
    items.value = Array.isArray(cached) ? cached : [];
    await markAllRead();
    return;
    await authFetch('/api/notifications/read', {
      method: 'PUT',
      body: JSON.stringify({ types: FEED_TYPES }),
    });
    items.value = (items.value || []).map((it) => ({ ...it, isRead: true }));
  } catch {
    // ignore
  }
};

const fetchFeed = async (opts = {}) => {
  if (!ensureLoggedIn()) return;
  const force = Boolean(opts?.force);
  const uid = String(user.value?.uid || '').trim();
  const cacheKey = `api:/notifications:feed:${uid}`;
  if (!force) isLoading.value = true;
  errorMsg.value = '';
  try {
    const res = await authFetch('/api/notifications?types=followed_project,followed_post&limit=50');
    const data = res.ok ? await res.json() : null;
    if (!res.ok) throw new Error(data?.message || '加载失败');
    items.value = Array.isArray(data) ? data : [];
    await markAllRead();
  } catch (e) {
    errorMsg.value = e?.message || '加载失败';
  } finally {
    isLoading.value = false;
  }
};

const clearPickedImages = () => {
  for (const it of pickedImages.value || []) {
    try {
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
    } catch {
      // ignore
    }
  }
  pickedImages.value = [];
  if (imageInput.value) imageInput.value.value = '';
};

const triggerPickImages = () => {
  if (!ensureLoggedIn()) return;
  imageInput.value?.click?.();
};

const handlePickImages = (e) => {
  const files = Array.from(e?.target?.files || []);
  if (!files.length) return;

  postError.value = '';

  const next = [...(pickedImages.value || [])];
  for (const file of files) {
    if (next.length >= 6) break;
    if (!file?.type?.startsWith?.('image/')) continue;
    if ((file.size || 0) > 8 * 1024 * 1024) continue;
    const previewUrl = URL.createObjectURL(file);
    next.push({ file, previewUrl });
  }

  pickedImages.value = next;
  if (imageInput.value) imageInput.value.value = '';
};

const removePickedImage = (idx) => {
  const arr = [...(pickedImages.value || [])];
  const it = arr[idx];
  if (it?.previewUrl) {
    try {
      URL.revokeObjectURL(it.previewUrl);
    } catch {
      // ignore
    }
  }
  arr.splice(idx, 1);
  pickedImages.value = arr;
};

const publishPost = async () => {
  postError.value = '';
  if (!ensureLoggedIn()) return;

  const content = draftContent.value.trim();
  const hasImages = Boolean(pickedImages.value?.length);
  if (!content && !hasImages) {
    postError.value = '请输入内容或选择图片';
    return;
  }
  if (content.length > 2000) {
    postError.value = '内容过长（最多 2000 字）';
    return;
  }

  isPosting.value = true;
  try {
    let imageUrls = [];
    if (pickedImages.value?.length) {
      const fd = new FormData();
      for (const it of pickedImages.value) {
        if (it?.file) fd.append('files', it.file);
      }
      const up = await authFetch('/api/upload/images', { method: 'POST', body: fd });
      const upData = up.ok ? await up.json() : null;
      if (!up.ok) throw new Error(upData?.message || '图片上传失败');
      imageUrls = Array.isArray(upData?.urls)
        ? upData.urls
        : Array.isArray(upData?.files)
          ? upData.files.map((f) => f?.url).filter(Boolean)
          : [];
    }

    const res = await authFetch('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ content, imageUrls }),
    });
    const data = res.ok ? await res.json() : null;
    if (!res.ok) throw new Error(data?.message || '发布失败');
    draftContent.value = '';
    clearPickedImages();
    await fetchFeed({ force: true });
  } catch (e) {
    postError.value = e?.message || '发布失败';
  } finally {
    isPosting.value = false;
  }
};

watch(
  () => user.value?.uid,
  () => {
    if (user.value) fetchFeed();
    else items.value = [];
  },
  { immediate: true }
);

onMounted(() => {
  if (user.value) fetchFeed();
});

onBeforeUnmount(() => {
  clearPickedImages();
});

const hasItems = computed(() => (items.value || []).length > 0);

const openItem = (note) => {
  if (note?.type === 'followed_post') {
    const pid = note?.post?.id || note?.post?._id || note?.post;
    if (pid) return router.push({ name: 'PostDetail', params: { id: pid } });
  }

  const projectId = note?.project?.id || note?.project?._id || note?.project;
  if (projectId) router.push({ name: 'ProjectDetail', params: { id: projectId } });
};
</script>

<template>
  <div class="page pb-12">
    <div class="page-container max-w-6xl">
      <div class="flex items-center justify-between gap-4 mb-6">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-white/65 border border-white/70 backdrop-blur-xl flex items-center justify-center shadow-sm">
            <i class="ph-bold ph-broadcast text-sky-700 text-xl"></i>
          </div>
          <div>
            <div class="text-xl font-extrabold text-slate-900">动态</div>
            <div class="text-xs text-slate-500 font-semibold">关注的创作者发布新作品和动态会出现在这里</div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <UiButton variant="secondary" class="px-4 py-2 rounded-xl text-sm font-semibold" :disabled="isLoading || !hasItems" @click="markAllRead">
            全部已读
          </UiButton>
          <UiButton variant="ghost" class="px-3 py-2 rounded-xl text-sm font-semibold" @click="fetchFeed({ force: true })">
            <i class="ph-bold ph-arrow-clockwise"></i>
          </UiButton>
        </div>
      </div>

      <div v-if="!user && isAuthReady" class="glass-card rounded-2xl border border-white/70 p-8">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600">
            <i class="ph-bold ph-lock-key text-2xl"></i>
          </div>
          <div>
            <div class="text-lg font-extrabold text-slate-900 mb-1">登录后查看动态</div>
            <div class="text-slate-600 text-sm mb-4">关注喜欢的创作者，第一时间获取新作品和动态。</div>
            <UiButton variant="primary" class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" @click="router.push('/login')">
              立即登录
            </UiButton>
          </div>
        </div>
      </div>

      <div v-else class="glass-card rounded-2xl border border-white/70 overflow-hidden">
        <div v-if="user" class="p-6 border-b border-slate-200/70 bg-white/35">
          <div class="flex items-start gap-4">
            <div class="shrink-0">
              <img v-if="user?.avatar" :src="user.avatar" class="w-10 h-10 rounded-full object-cover border border-white/70" />
              <div
                v-else
                class="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white text-sm font-extrabold border border-white/70"
              >
                {{ user?.username?.charAt(0)?.toUpperCase() || 'U' }}
              </div>
            </div>

            <div class="flex-1">
              <textarea
                ref="composerEl"
                v-model="draftContent"
                rows="3"
                class="w-full rounded-2xl border border-white/70 bg-white/60 backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-sky-200/80"
                placeholder="发布一条动态…"
              ></textarea>
              <input ref="imageInput" type="file" accept="image/*" multiple class="hidden" @change="handlePickImages" />

              <div v-if="pickedImages.length" class="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
                <div v-for="(it, idx) in pickedImages" :key="it.previewUrl" class="relative rounded-xl overflow-hidden border border-white/70 bg-white/50">
                  <img :src="it.previewUrl" class="w-full h-20 object-cover" />
                  <button
                    type="button"
                    class="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center"
                    @click.stop="removePickedImage(idx)"
                    aria-label="删除图片"
                  >
                    <i class="ph-bold ph-x"></i>
                  </button>
                </div>
              </div>

              <div class="mt-3 flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <EmojiPicker v-model="draftContent" :target="composerEl" />
                  <UiButton
                    variant="secondary"
                    class="px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-2"
                    :disabled="isPosting || pickedImages.length >= 6"
                    @click="triggerPickImages"
                  >
                    <i class="ph-bold ph-image"></i>
                    图片
                  </UiButton>
                  <div class="text-xs font-semibold text-slate-500 truncate">
                    {{ draftContent.length }}/2000 · {{ pickedImages.length }}/6
                    <span v-if="postError" class="text-rose-600 ml-2">{{ postError }}</span>
                  </div>
                </div>
                <UiButton
                  variant="primary"
                  class="px-5 py-2.5 rounded-xl text-sm font-extrabold text-white flex items-center gap-2"
                  :disabled="isPosting || (!draftContent.trim() && !pickedImages.length)"
                  @click="publishPost"
                >
                  <i class="ph-bold ph-paper-plane-tilt"></i>
                  发布
                </UiButton>
              </div>
            </div>
          </div>
        </div>

        <div v-if="isLoading" class="p-6 space-y-3">
          <div v-for="n in 8" :key="n" class="h-16 rounded-2xl skeleton"></div>
        </div>

        <div v-else-if="errorMsg" class="p-6 text-rose-700 text-sm font-semibold">
          {{ errorMsg }}
        </div>

        <div v-else-if="!hasItems" class="p-10 text-center text-slate-500">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/60 border border-white/70 shadow-sm">
            <i class="ph-duotone ph-users-three text-3xl text-slate-500"></i>
          </div>
          <div class="mt-3 font-extrabold text-slate-900">还没有动态</div>
          <div class="text-sm font-semibold mt-1">去社区看看，关注一些你喜欢的创作者。</div>
          <UiButton variant="primary" class="mt-5 px-6 py-2.5 rounded-xl text-white text-sm font-semibold" @click="router.push('/explore')">
            去探索社区
          </UiButton>
        </div>

        <div v-else class="divide-y divide-slate-200/70">
          <button
            v-for="note in items"
            :key="note.id"
            type="button"
            class="w-full text-left px-4 sm:px-6 py-4 flex items-center gap-4 hover:bg-white/35 transition"
            @click="openItem(note)"
          >
            <div class="shrink-0">
              <img v-if="note.sender?.avatar" :src="note.sender.avatar" class="w-10 h-10 rounded-full object-cover border border-white/70" />
              <div
                v-else
                class="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white text-sm font-extrabold border border-white/70"
              >
                {{ note.sender?.username?.charAt(0)?.toUpperCase() || 'U' }}
              </div>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <div class="text-sm font-extrabold text-slate-900 truncate">{{ note.sender?.username || '未知用户' }}</div>
                <span v-if="!note.isRead" class="w-2 h-2 rounded-full bg-rose-500"></span>
                <div class="text-[11px] text-slate-500 font-semibold ml-auto shrink-0">{{ timeAgo(note.createdAt) }}</div>
              </div>

              <div v-if="note.type === 'followed_post'" class="mt-1">
                <div class="text-sm text-slate-700">
                  发布了动态
                  <span v-if="note.post?.project?.title" class="font-semibold text-slate-900 ml-1">· 分享作品 {{ note.post.project.title }}</span>
                </div>
                <div v-if="note.post?.content" class="mt-1 text-sm text-slate-800 clamp-3 whitespace-pre-wrap">
                  <MentionText :text="note.post.content" :highlight="user?.username || ''" />
                </div>
                <div v-if="note.post?.images?.length" class="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                  <img
                    v-for="img in note.post.images.slice(0, 6)"
                    :key="img.url"
                    :src="img.url"
                    class="w-full h-20 rounded-xl object-cover border border-white/70 bg-white/50"
                    loading="lazy"
                  />
                </div>
              </div>

              <div v-else class="mt-1 text-sm text-slate-700 truncate">
                发布了新作品：<span class="font-semibold text-slate-900">{{ note.project?.title || '未命名作品' }}</span>
              </div>
            </div>

            <div
              v-if="note.type === 'followed_project' && note.project"
              class="w-16 h-12 rounded-xl bg-white/50 border border-white/70 shrink-0 shadow-sm"
              :style="coverStyle(note.project.cover)"
            ></div>
            <div
              v-else-if="note.type === 'followed_post' && note.post?.project"
              class="w-16 h-12 rounded-xl bg-white/50 border border-white/70 shrink-0 shadow-sm"
              :style="coverStyle(note.post.project.cover)"
            ></div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
