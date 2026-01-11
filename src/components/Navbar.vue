<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import AuroraButton from './AuroraButton.vue';
import UiButton from './UiButton.vue';

const router = useRouter();
const { user, logout } = useUser();
const currentRoute = router.currentRoute;

const unreadCount = ref(0);
const searchQuery = ref('');

let pollTimer = null;
let backoffMs = 5000;
let consecutiveFailures = 0;

const isPublishOpen = ref(false);
const publishTitle = ref('');
const publishCover = ref('');
const tagDraft = ref('');
const publishTags = ref([]);
const isPublishing = ref(false);
const publishError = ref('');

const isActive = (name) => currentRoute.value.name === name;

const goToProfile = () => router.push('/profile');
const goToNotifications = () => {
  router.push({ name: 'Notifications', query: { tab: 'replies' } });
};

const resetPublishForm = () => {
  publishTitle.value = '';
  publishCover.value = '';
  tagDraft.value = '';
  publishTags.value = [];
  publishError.value = '';
};

const openPublish = () => {
  if (!user.value) return router.push('/login');
  publishError.value = '';
  isPublishOpen.value = true;
};

const closePublish = () => {
  isPublishOpen.value = false;
  publishError.value = '';
};

const normalizeTag = (val) => String(val || '').trim().replace(/^#/, '');

const addTag = () => {
  const tag = normalizeTag(tagDraft.value);
  if (!tag) return;
  if (publishTags.value.length >= 10) return;
  const exists = publishTags.value.some((t) => String(t).toLowerCase() === tag.toLowerCase());
  if (!exists) publishTags.value = [...publishTags.value, tag];
  tagDraft.value = '';
};

const removeTag = (tag) => {
  publishTags.value = publishTags.value.filter((t) => t !== tag);
};

const coverPreview = () =>
  publishCover.value?.trim() || 'linear-gradient(135deg,rgba(56,189,248,0.32),rgba(99,102,241,0.22))';

const publishProject = async () => {
  if (!user.value) return router.push('/login');
  const title = publishTitle.value.trim();
  if (!title) {
    publishError.value = '标题不能为空';
    return;
  }
  if (isPublishing.value) return;

  isPublishing.value = true;
  publishError.value = '';
  try {
    const res = await authFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        title,
        cover: publishCover.value.trim(),
        tags: publishTags.value,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || '发布失败');
    closePublish();
    resetPublishForm();
    if (data?.id) router.push({ name: 'ProjectDetail', params: { id: data.id } });
  } catch (e) {
    publishError.value = e?.message || '发布失败，请稍后重试';
  } finally {
    isPublishing.value = false;
  }
};

const submitSearch = () => {
  const q = searchQuery.value.trim();
  router.push({ name: 'Search', query: q ? { q } : {} });
};

const clearSearch = () => {
  searchQuery.value = '';
  if (currentRoute.value.name === 'Search') router.replace({ name: 'Search', query: {} });
};

watch(
  () => ({ name: currentRoute.value.name, q: currentRoute.value.query?.q }),
  ({ name, q }) => {
    if (name !== 'Search') return;
    searchQuery.value = String(q || '').trim();
  },
  { immediate: true }
);

const checkUnread = async () => {
  if (!user.value) {
    unreadCount.value = 0;
    return;
  }
  try {
    const res = await authFetch('/api/notifications/unread-count');
    if (res.ok) {
      const data = await res.json();
      unreadCount.value = data.totalCount ?? data.count;
    }
    backoffMs = 5000;
    consecutiveFailures = 0;
  } catch (e) {
    consecutiveFailures += 1;
    backoffMs = Math.min(backoffMs * 2, 60000);
    if (consecutiveFailures <= 2) {
      console.warn('获取通知失败，将退避重试', e);
    }
  }
};

const scheduleNextPoll = async () => {
  if (pollTimer) clearTimeout(pollTimer);
  await checkUnread();
  if (!user.value) return;
  pollTimer = setTimeout(scheduleNextPoll, backoffMs);
};

onMounted(() => {
  scheduleNextPoll();
});

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<template>
  <div>
  <nav class="fixed top-0 w-full z-50 h-16 flex items-center justify-between px-4 sm:px-6 glass">
    <div class="flex items-center gap-2 cursor-pointer" @click="router.push('/')">
      <div class="w-8 h-8 bg-gradient-to-tr from-sky-400 to-indigo-500 rounded-xl flex items-center justify-center shadow-[0_18px_45px_-28px_rgba(2,132,199,0.8)]">
        <i class="ph-fill ph-music-notes text-white text-xl"></i>
      </div>
      <span class="text-xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-800 to-sky-700 tracking-tight">
        MuseAI
      </span>
    </div>
    <div class="hidden md:flex items-center gap-6 flex-1 justify-center">
      <div class="flex items-center gap-8 text-sm font-semibold text-slate-600">
        <router-link to="/" :class="isActive('Home') ? 'text-slate-900' : 'hover:text-slate-900'" class="transition">首页</router-link>
        <router-link to="/studio" :class="isActive('Studio') ? 'text-slate-900' : 'hover:text-slate-900'" class="transition">创作工作台</router-link>
        <router-link to="/explore" :class="isActive('Explore') ? 'text-slate-900' : 'hover:text-slate-900'" class="transition">探索社区</router-link>
        <router-link to="/daily" :class="isActive('DailyRecommendations') ? 'text-slate-900' : 'hover:text-slate-900'" class="transition">每日推荐</router-link>
        <router-link to="/piano" :class="isActive('PianoPlay') ? 'text-slate-900' : 'hover:text-slate-900'" class="transition">弹奏乐器</router-link>
        <router-link to="/audio-to-sheet" :class="isActive('AudioToSheet') ? 'text-slate-900' : 'hover:text-slate-900'" class="transition">音频转谱</router-link>
        <router-link to="/library" :class="isActive('Library') ? 'text-slate-900' : 'hover:text-slate-900'" class="transition">素材库</router-link>
      </div>

      <form @submit.prevent="submitSearch" class="hidden lg:block">
        <div class="relative w-64 xl:w-[360px]">
          <i class="ph-bold ph-magnifying-glass absolute left-3 top-3 text-slate-500"></i>
          <input
            v-model="searchQuery"
            type="text"
            class="w-full h-10 input-glass rounded-full pl-10 pr-10 text-sm"
            placeholder="搜索作品 / 用户..."
            aria-label="搜索"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="absolute right-2 top-2 w-6 h-6 rounded-full text-slate-500 hover:text-slate-900 hover:bg-white/60 transition"
            @click="clearSearch"
            aria-label="清空搜索"
          >
            <i class="ph-bold ph-x"></i>
          </button>
        </div>
      </form>
    </div>
    <div class="flex items-center gap-4">
      <UiButton
        variant="ghost"
        class="md:hidden px-2 py-2 rounded-lg"
        @click="router.push({ name: 'Search', query: searchQuery ? { q: searchQuery } : {} })"
        aria-label="搜索"
      >
        <i class="ph-bold ph-magnifying-glass text-xl"></i>
      </UiButton>
      <div v-if="user" class="flex items-center gap-4">

        <UiButton @click="goToNotifications" variant="ghost" class="relative px-2 py-2 rounded-lg">
          <i class="ph-bold ph-bell text-xl"></i>
          <span v-if="unreadCount > 0" class="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border border-white/80 shadow-sm">
                {{ unreadCount > 9 ? '9+' : unreadCount }}
            </span>
        </UiButton>

        <UiButton
          variant="ghost"
          class="sm:hidden px-2 py-2 rounded-lg"
          @click="openPublish"
          aria-label="发布作品"
        >
          <i class="ph-bold ph-upload-simple text-xl"></i>
        </UiButton>

        <AuroraButton
          class="hidden sm:inline-flex items-center gap-2 text-white text-sm font-semibold px-4 py-2 rounded-full"
          @click="openPublish"
        >
          <i class="ph-bold ph-upload-simple text-lg"></i>
          发布
        </AuroraButton>

        <button @click="goToProfile" class="text-sm text-slate-900 font-semibold hidden sm:block hover:text-sky-700 transition">
          {{ user.username }}
        </button>
        <button @click="goToProfile" class="w-9 h-9 rounded-full bg-white/65 border border-white/70 backdrop-blur-xl flex items-center justify-center text-sky-700 hover:border-sky-200 transition overflow-hidden shadow-[0_18px_45px_-40px_rgba(2,132,199,0.8)]">
          <img v-if="user.avatar" :src="user.avatar" class="w-full h-full object-cover" />
          <i v-else class="ph ph-user text-lg"></i>
        </button>

        <UiButton @click="logout" variant="ghost" class="px-2 py-2 rounded-lg text-xs ml-1 flex items-center gap-1">
          <i class="ph-bold ph-sign-out text-lg"></i><span class="hidden sm:inline">退出</span>
        </UiButton>
      </div>
      <div v-else class="flex gap-3">
        <UiButton @click="router.push('/login')" variant="ghost" class="text-sm font-semibold px-3 py-2 rounded-lg">登录</UiButton>
        <AuroraButton @click="router.push('/register')" class="text-white text-sm font-semibold px-4 py-2 rounded-full">免费注册</AuroraButton>
      </div>
    </div>
  </nav>

  <Teleport to="body">
    <transition name="publish">
      <div v-if="isPublishOpen" class="fixed inset-0 z-[9999] flex items-center justify-center px-4">
        <div class="absolute inset-0 bg-slate-900/35 backdrop-blur-sm" @click="closePublish"></div>

        <div class="glass-card w-full max-w-xl rounded-2xl border border-white/70 shadow-2xl relative z-10 overflow-hidden">
          <div class="p-4 border-b border-slate-200/70 flex justify-between items-center">
            <div class="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <i class="ph-bold ph-upload-simple text-sky-600"></i>
              发布作品
            </div>
            <UiButton @click="closePublish" variant="ghost" class="px-2 py-2 rounded-lg">
              <i class="ph-bold ph-x text-xl"></i>
            </UiButton>
          </div>

          <form class="p-4 space-y-4" @submit.prevent="publishProject">
            <div>
              <div class="text-xs font-bold text-slate-600 mb-1">标题</div>
              <input
                v-model="publishTitle"
                type="text"
                class="w-full input-glass rounded-xl px-4 py-2.5 text-sm"
                placeholder="给你的作品起个名字..."
                maxlength="50"
              />
            </div>

            <div>
              <div class="text-xs font-bold text-slate-600 mb-1">封面（可选）</div>
              <input
                v-model="publishCover"
                type="text"
                class="w-full input-glass rounded-xl px-4 py-2.5 text-sm"
                placeholder="图片 URL 或渐变（CSS background）"
              />
              <div class="mt-2 h-20 rounded-xl border border-white/70 overflow-hidden" :style="{ background: coverPreview() }"></div>
            </div>

            <div>
              <div class="text-xs font-bold text-slate-600 mb-1">标签</div>
              <div class="flex gap-2">
                <input
                  v-model="tagDraft"
                  type="text"
                  class="flex-1 input-glass rounded-xl px-4 py-2.5 text-sm"
                  placeholder="输入标签后回车添加（最多 10 个）"
                  @keydown.enter.prevent="addTag"
                />
                <UiButton variant="secondary" class="px-4 py-2.5 rounded-xl text-xs font-semibold" type="button" @click="addTag">
                  添加
                </UiButton>
              </div>

              <div v-if="publishTags.length" class="mt-2 flex flex-wrap gap-2">
                <span
                  v-for="tag in publishTags"
                  :key="tag"
                  class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-white/55 border border-white/70 text-slate-700"
                >
                  #{{ tag }}
                  <button
                    type="button"
                    class="w-5 h-5 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-white/60 transition"
                    @click="removeTag(tag)"
                    aria-label="移除标签"
                  >
                    <i class="ph-bold ph-x text-[12px]"></i>
                  </button>
                </span>
              </div>
            </div>

            <div
              v-if="publishError"
              class="glass-card rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-700 text-sm font-semibold px-4 py-3 flex items-center gap-2"
            >
              <i class="ph-bold ph-warning-circle"></i>
              {{ publishError }}
            </div>

            <div class="pt-2 flex items-center justify-end gap-2">
              <UiButton variant="ghost" class="px-4 py-2 rounded-xl text-sm font-semibold" type="button" @click="closePublish">
                取消
              </UiButton>
              <UiButton
                variant="primary"
                class="px-5 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                :disabled="isPublishing || !publishTitle.trim()"
                type="submit"
              >
                <i v-if="isPublishing" class="ph-bold ph-spinner animate-spin"></i>
                发布
              </UiButton>
            </div>
          </form>
        </div>
      </div>
    </transition>
  </Teleport>
  </div>
</template>

<style scoped>
.publish-enter-active,
.publish-leave-active {
  transition: opacity 180ms ease, transform 180ms ease, filter 180ms ease;
}
.publish-enter-from,
.publish-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
  filter: blur(10px);
}

@media (prefers-reduced-motion: reduce) {
  .publish-enter-active,
  .publish-leave-active {
    transition: none;
  }
  .publish-enter-from,
  .publish-leave-to {
    transform: none;
    filter: none;
  }
}
</style>
