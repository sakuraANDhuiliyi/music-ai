<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import AuroraButton from './AuroraButton.vue';
import UiButton from './UiButton.vue';

const router = useRouter();
const currentRoute = router.currentRoute;
const { user, logout, isAuthReady } = useUser();

const navRootRef = ref(null);
const searchQuery = ref('');

const isMobileMenuOpen = ref(false);
const isMoreOpen = ref(false);
const isFeedOpen = ref(false);
const isNotesOpen = ref(false);
const isUserMenuOpen = ref(false);
const isLoginCardOpen = ref(false);

const unreadTotal = ref(0);
const unreadFollowedProject = ref(0);
const unreadFollowedPost = ref(0);
const unreadChat = ref(0);
const unreadReplies = ref(0);
const unreadMentions = ref(0);
const unreadLikes = ref(0);
const unreadSystem = ref(0);
const unreadFollowedFeed = computed(
  () => Math.max(0, Number(unreadFollowedProject.value || 0) + Number(unreadFollowedPost.value || 0))
);
const unreadNonFeed = computed(() => Math.max(0, (unreadTotal.value || 0) - unreadFollowedFeed.value));

const feedItems = ref([]);
const isFeedLoading = ref(false);
const meStats = ref({ followerCount: 0, followingCount: 0 });

let feedCloseTimer = null;
let notesCloseTimer = null;
let userMenuCloseTimer = null;
let pollTimer = null;
let backoffMs = 5000;
let consecutiveFailures = 0;

const closeAllMenus = () => {
  isMobileMenuOpen.value = false;
  isMoreOpen.value = false;
  isFeedOpen.value = false;
  isNotesOpen.value = false;
  isUserMenuOpen.value = false;
  isLoginCardOpen.value = false;
};

watch(() => currentRoute.value.fullPath, closeAllMenus);

watch(
  () => ({ name: currentRoute.value.name, q: currentRoute.value.query?.q }),
  ({ name, q }) => {
    if (name !== 'Search') return;
    searchQuery.value = String(q || '').trim();
  },
  { immediate: true }
);

const submitSearch = () => {
  const q = searchQuery.value.trim();
  router.push({ name: 'Search', query: q ? { q } : {} });
};

const clearSearch = () => {
  searchQuery.value = '';
  if (currentRoute.value.name === 'Search') router.replace({ name: 'Search', query: {} });
};

const ensureLogin = () => {
  if (!isAuthReady.value) return false;
  if (user.value) return true;
  router.push('/login');
  return false;
};

const ensureLoginForHover = () => {
  if (!isAuthReady.value) return false;
  if (user.value) return true;
  isFeedOpen.value = false;
  isNotesOpen.value = false;
  isUserMenuOpen.value = false;
  isMoreOpen.value = false;
  isMobileMenuOpen.value = false;
  isLoginCardOpen.value = true;
  return false;
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

const coverStyle = (cover) => {
  const c = String(cover || '').trim();
  if (!c) return { background: 'linear-gradient(135deg,rgba(56,189,248,0.28),rgba(99,102,241,0.22))' };
  if (/^(https?:)?\/\//.test(c) || c.startsWith('/') || c.startsWith('data:')) {
    return { backgroundImage: `url(${c})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: c };
};

const checkUnread = async () => {
  if (!user.value) {
    unreadTotal.value = 0;
    unreadFollowedProject.value = 0;
    unreadFollowedPost.value = 0;
    unreadChat.value = 0;
    unreadReplies.value = 0;
    unreadMentions.value = 0;
    unreadLikes.value = 0;
    unreadSystem.value = 0;
    return;
  }
  try {
    const res = await authFetch('/api/notifications/unread-count');
    if (res.ok) {
      const data = await res.json();
      unreadTotal.value = Number(data?.totalCount ?? data?.count ?? 0) || 0;
      unreadFollowedProject.value = Number(data?.breakdown?.followedProject ?? 0) || 0;
      unreadFollowedPost.value = Number(data?.breakdown?.followedPost ?? 0) || 0;
      unreadChat.value = Number(data?.breakdown?.chat ?? data?.chatCount ?? 0) || 0;
      unreadReplies.value = Number(data?.breakdown?.replies ?? 0) || 0;
      unreadMentions.value = Number(data?.breakdown?.mentions ?? 0) || 0;
      unreadLikes.value = Number(data?.breakdown?.likes ?? 0) || 0;
      unreadSystem.value = Number(data?.breakdown?.system ?? 0) || 0;
    }
    backoffMs = 5000;
    consecutiveFailures = 0;
  } catch {
    consecutiveFailures += 1;
    backoffMs = Math.min(backoffMs * 2, 60000);
  }
};

const scheduleNextPoll = async () => {
  if (pollTimer) clearTimeout(pollTimer);
  await checkUnread();
  if (!user.value) return;
  pollTimer = setTimeout(scheduleNextPoll, backoffMs);
};

const fetchMeStats = async () => {
  if (!user.value) {
    meStats.value = { followerCount: 0, followingCount: 0 };
    return;
  }
  try {
    const res = await authFetch(`/api/users/${encodeURIComponent(user.value.uid)}/public`);
    if (!res.ok) return;
    const data = await res.json();
    meStats.value = {
      followerCount: Number(data?.followerCount ?? 0) || 0,
      followingCount: Number(data?.followingCount ?? 0) || 0,
    };
  } catch {
    // ignore
  }
};

const fetchFeed = async () => {
  if (!user.value) {
    feedItems.value = [];
    return;
  }
  isFeedLoading.value = true;
  try {
    const res = await authFetch('/api/notifications?types=followed_project,followed_post&limit=20');
    const data = res.ok ? await res.json() : null;
    feedItems.value = Array.isArray(data) ? data : [];
  } catch {
    feedItems.value = [];
  } finally {
    isFeedLoading.value = false;
  }
};

const markFeedRead = async () => {
  if (!user.value) return;
  try {
    await authFetch('/api/notifications/read', {
      method: 'PUT',
      body: JSON.stringify({ types: ['followed_project', 'followed_post'] }),
    });
  } catch {
    // ignore
  }
};

const openFeedItem = (note) => {
  if (!note) return;
  closeAllMenus();

  if (note.type === 'followed_post') {
    const pid = note?.post?.id || note?.post?._id || note?.post;
    if (pid) return router.push({ name: 'PostDetail', params: { id: pid } });
  }

  const projectId = note?.project?.id || note?.project?._id || note?.project;
  if (projectId) router.push({ name: 'ProjectDetail', params: { id: projectId } });
};

const clearFeedCloseTimer = () => {
  if (!feedCloseTimer) return;
  window.clearTimeout(feedCloseTimer);
  feedCloseTimer = null;
};
const clearNotesCloseTimer = () => {
  if (!notesCloseTimer) return;
  window.clearTimeout(notesCloseTimer);
  notesCloseTimer = null;
};
const clearUserMenuCloseTimer = () => {
  if (!userMenuCloseTimer) return;
  window.clearTimeout(userMenuCloseTimer);
  userMenuCloseTimer = null;
};

const openNotesPanel = async () => {
  if (!ensureLoginForHover()) return;
  clearNotesCloseTimer();
  isFeedOpen.value = false;
  isUserMenuOpen.value = false;
  isLoginCardOpen.value = false;
  isMoreOpen.value = false;
  isMobileMenuOpen.value = false;
  if (isNotesOpen.value) return;
  isNotesOpen.value = true;
  await checkUnread();
};
const scheduleCloseNotesPanel = () => {
  clearNotesCloseTimer();
  notesCloseTimer = window.setTimeout(() => {
    isNotesOpen.value = false;
    notesCloseTimer = null;
  }, 180);
};

const openFeedPanel = async () => {
  if (!ensureLoginForHover()) return;
  clearFeedCloseTimer();
  isNotesOpen.value = false;
  isUserMenuOpen.value = false;
  isLoginCardOpen.value = false;
  isMoreOpen.value = false;
  isMobileMenuOpen.value = false;
  if (isFeedOpen.value) return;
  isFeedOpen.value = true;
  await fetchFeed();
  await markFeedRead();
  await checkUnread();
};
const scheduleCloseFeedPanel = () => {
  clearFeedCloseTimer();
  feedCloseTimer = window.setTimeout(() => {
    isFeedOpen.value = false;
    feedCloseTimer = null;
  }, 180);
};

const openUserMenuPanel = async () => {
  if (!ensureLogin()) return;
  clearUserMenuCloseTimer();
  isFeedOpen.value = false;
  isNotesOpen.value = false;
  isLoginCardOpen.value = false;
  isMoreOpen.value = false;
  isMobileMenuOpen.value = false;
  if (isUserMenuOpen.value) return;
  isUserMenuOpen.value = true;
  await fetchMeStats();
};
const scheduleCloseUserMenuPanel = () => {
  clearUserMenuCloseTimer();
  userMenuCloseTimer = window.setTimeout(() => {
    isUserMenuOpen.value = false;
    userMenuCloseTimer = null;
  }, 180);
};

const openLoginCard = () => {
  if (user.value) return;
  isFeedOpen.value = false;
  isNotesOpen.value = false;
  isUserMenuOpen.value = false;
  isMoreOpen.value = false;
  isMobileMenuOpen.value = false;
  isLoginCardOpen.value = !isLoginCardOpen.value;
};

const desktopLinks = computed(() => [
  { label: '首页', name: 'Home', to: '/' },
  { label: '社区', name: 'Explore', to: '/explore' },
  { label: '素材库', name: 'Library', to: '/library' },
  { label: '每日推荐', name: 'DailyRecommendations', to: '/daily' },
]);

const moreLinks = computed(() => [
  { label: '弹奏乐器', name: 'PianoPlay', to: '/piano', icon: 'ph-bold ph-piano-keys' },
  { label: '音频转谱', name: 'AudioToSheet', to: '/audio-to-sheet', icon: 'ph-bold ph-waveform' },
  { label: 'AI 和弦', name: 'AiChordCreator', to: '/ai-chord', icon: 'ph-bold ph-magic-wand' },
]);

const isActive = (name) => currentRoute.value.name === name;

const goToStudio = () => router.push('/studio');
const goToNotifications = () => {
  if (!ensureLogin()) return;
  router.push({ name: 'Notifications', query: { tab: 'chat' } });
};
const goToNotificationsTab = (tab) => {
  if (!ensureLogin()) return;
  closeAllMenus();
  router.push({ name: 'Notifications', query: { tab } });
};
const goToFeed = () => {
  if (!ensureLogin()) return;
  router.push({ name: 'Feed' });
};
const goToMeSpace = () => {
  if (!ensureLogin()) return;
  const id = String(user.value?.uid || '').trim();
  if (!id) return;
  router.push({ name: 'UserSpace', params: { id } });
};

onMounted(() => {
  scheduleNextPoll();
  fetchMeStats();

  const onDocDown = (e) => {
    const root = navRootRef.value;
    if (!root) return;
    if (root.contains(e.target)) return;
    closeAllMenus();
  };
  const onKeyDown = (e) => {
    if (e?.key === 'Escape') closeAllMenus();
  };
  document.addEventListener('pointerdown', onDocDown, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  navRootRef.value.__onDocDown = onDocDown;
  navRootRef.value.__onKeyDown = onKeyDown;
});

onUnmounted(() => {
  clearFeedCloseTimer();
  clearNotesCloseTimer();
  clearUserMenuCloseTimer();
  if (pollTimer) clearTimeout(pollTimer);
  const root = navRootRef.value;
  const onDocDown = root?.__onDocDown;
  const onKeyDown = root?.__onKeyDown;
  if (onDocDown) document.removeEventListener('pointerdown', onDocDown);
  if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
});

watch(
  () => user.value?.uid,
  () => {
    closeAllMenus();
    scheduleNextPoll();
    fetchMeStats();
  }
);
</script>

<template>
  <nav ref="navRootRef" class="fixed top-0 inset-x-0 z-50 glass border-b border-white/70">
    <div class="mx-auto max-w-7xl h-16 px-4 sm:px-6 flex items-center gap-3">
      <button class="flex items-center gap-2 shrink-0" @click="router.push('/')" aria-label="MuseAI 首页">
        <div class="w-9 h-9 bg-gradient-to-tr from-sky-400 to-indigo-500 rounded-xl flex items-center justify-center shadow-[0_18px_45px_-28px_rgba(2,132,199,0.8)]">
          <i class="ph-fill ph-music-notes text-white text-xl"></i>
        </div>
        <span class="hidden sm:inline text-xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-800 to-sky-700 tracking-tight">
          MuseAI
        </span>
      </button>

      <!-- Left links -->
      <div class="hidden lg:flex items-center gap-1 ml-4">
        <router-link
          v-for="item in desktopLinks"
          :key="item.name"
          :to="item.to"
          class="px-3 py-2 rounded-full text-sm font-semibold transition border border-transparent"
          :class="isActive(item.name) ? 'bg-white/70 text-slate-900 border-white/70 shadow-[0_14px_35px_-30px_rgba(2,132,199,0.25)]' : 'text-slate-600 hover:text-slate-900 hover:bg-white/55'"
        >
          {{ item.label }}
        </router-link>

        <div class="relative">
          <button
            type="button"
            class="px-3 py-2 rounded-full text-sm font-semibold transition border border-transparent inline-flex items-center gap-1"
            :class="isMoreOpen ? 'bg-white/70 text-slate-900 border-white/70' : 'text-slate-600 hover:text-slate-900 hover:bg-white/55'"
            aria-haspopup="menu"
            :aria-expanded="isMoreOpen ? 'true' : 'false'"
            @click="isMoreOpen = !isMoreOpen"
          >
            更多 <i class="ph-bold ph-caret-down text-sm"></i>
          </button>

          <div v-if="isMoreOpen" class="absolute left-0 mt-2 w-56 glass-card rounded-2xl border border-white/70 overflow-hidden shadow-xl" role="menu">
            <button
              v-for="item in moreLinks"
              :key="item.name"
              type="button"
              role="menuitem"
              class="w-full px-4 py-3 text-sm font-semibold text-left flex items-center gap-3 hover:bg-white/35 transition"
              :class="isActive(item.name) ? 'text-slate-900' : 'text-slate-700'"
              @click="router.push(item.to)"
            >
              <i :class="item.icon" class="text-slate-500"></i>
              <span>{{ item.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Search -->
      <div class="hidden md:flex items-center flex-1 justify-center">
        <form @submit.prevent="submitSearch" class="w-full max-w-[540px]">
          <div class="relative">
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

      <!-- Right actions -->
      <div class="ml-auto flex items-center gap-1.5">
        <UiButton
          variant="ghost"
          class="md:hidden px-2 py-2 rounded-lg"
          @click="router.push({ name: 'Search', query: searchQuery ? { q: searchQuery } : {} })"
          aria-label="搜索"
        >
          <i class="ph-bold ph-magnifying-glass text-xl"></i>
        </UiButton>

        <UiButton
          variant="ghost"
          class="lg:hidden px-2 py-2 rounded-lg"
          @click="isMobileMenuOpen = !isMobileMenuOpen"
          aria-label="打开菜单"
          :aria-expanded="isMobileMenuOpen ? 'true' : 'false'"
        >
          <i class="ph-bold ph-list text-xl"></i>
        </UiButton>

        <!-- Desktop icon group (bilibili-like) -->
        <div class="hidden lg:flex items-center gap-1">
          <div class="relative" @pointerenter="openNotesPanel" @pointerleave="scheduleCloseNotesPanel">
            <button class="nav-icon relative" type="button" @click="goToNotifications" aria-label="消息">
              <i class="ph-bold ph-envelope-simple text-xl"></i>
              <span class="text-[11px] font-bold text-slate-600 leading-none">消息</span>
              <span v-if="unreadNonFeed" class="badge">{{ unreadNonFeed > 99 ? '99+' : unreadNonFeed }}</span>
            </button>

            <div
              v-if="isNotesOpen"
              @pointerenter="clearNotesCloseTimer"
              @pointerleave="scheduleCloseNotesPanel"
              class="absolute right-0 mt-2 w-[min(320px,calc(100vw-2rem))] glass-card rounded-2xl border border-white/70 overflow-hidden shadow-2xl"
            >
              <div class="px-4 py-3 border-b border-slate-200/70 bg-white/35 flex items-center justify-between">
                <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <i class="ph-bold ph-envelope-simple text-sky-700"></i>
                  消息
                </div>
                <button class="text-xs font-semibold text-slate-600 hover:text-sky-700 transition" type="button" @click="goToNotifications">
                  查看全部
                </button>
              </div>

              <div class="p-2 space-y-1">
                <button type="button" class="menu-row" @click="goToNotificationsTab('chat')">
                  <span class="inline-flex items-center gap-2">
                    <i class="ph-bold ph-chats-circle text-slate-500"></i>
                    我的消息
                  </span>
                  <span v-if="unreadChat" class="pill ml-auto">{{ unreadChat > 99 ? '99+' : unreadChat }}</span>
                </button>

                <button type="button" class="menu-row" @click="goToNotificationsTab('replies')">
                  <span class="inline-flex items-center gap-2">
                    <i class="ph-bold ph-chat-teardrop-text text-slate-500"></i>
                    回复我的
                  </span>
                  <span v-if="unreadReplies" class="pill ml-auto">{{ unreadReplies > 99 ? '99+' : unreadReplies }}</span>
                </button>

                <button type="button" class="menu-row" @click="goToNotificationsTab('mentions')">
                  <span class="inline-flex items-center gap-2">
                    <i class="ph-bold ph-at text-slate-500"></i>
                    @我的
                  </span>
                  <span v-if="unreadMentions" class="pill ml-auto">{{ unreadMentions > 99 ? '99+' : unreadMentions }}</span>
                </button>

                <button type="button" class="menu-row" @click="goToNotificationsTab('likes')">
                  <span class="inline-flex items-center gap-2">
                    <i class="ph-bold ph-heart text-slate-500"></i>
                    收到的赞
                  </span>
                  <span v-if="unreadLikes" class="pill ml-auto">{{ unreadLikes > 99 ? '99+' : unreadLikes }}</span>
                </button>

                <button type="button" class="menu-row" @click="goToNotificationsTab('system')">
                  <span class="inline-flex items-center gap-2">
                    <i class="ph-bold ph-bell text-slate-500"></i>
                    系统通知
                  </span>
                  <span v-if="unreadSystem" class="pill ml-auto">{{ unreadSystem > 99 ? '99+' : unreadSystem }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="relative" @pointerenter="openFeedPanel" @pointerleave="scheduleCloseFeedPanel">
            <button class="nav-icon relative" type="button" @click="goToFeed" aria-label="动态">
              <i class="ph-bold ph-broadcast text-xl"></i>
              <span class="text-[11px] font-bold text-slate-600 leading-none">动态</span>
              <span v-if="unreadFollowedFeed" class="badge">{{ unreadFollowedFeed > 99 ? '99+' : unreadFollowedFeed }}</span>
            </button>

            <div
              v-if="isFeedOpen"
              @pointerenter="clearFeedCloseTimer"
              @pointerleave="scheduleCloseFeedPanel"
              class="absolute right-0 mt-2 w-[min(420px,calc(100vw-2rem))] glass-card rounded-2xl border border-white/70 overflow-hidden shadow-2xl"
            >
              <div class="px-4 py-3 border-b border-slate-200/70 bg-white/35 flex items-center justify-between">
                <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <i class="ph-bold ph-broadcast text-sky-700"></i>
                  动态
                </div>
                <button class="text-xs font-semibold text-slate-600 hover:text-sky-700 transition" type="button" @click="goToFeed">
                  历史动态
                </button>
              </div>

              <div v-if="isFeedLoading" class="p-4 space-y-2">
                <div v-for="n in 6" :key="n" class="h-14 rounded-2xl skeleton"></div>
              </div>

              <div v-else-if="!feedItems.length" class="p-6 text-center text-slate-500">
                <div class="font-extrabold text-slate-900">还没有动态</div>
                <div class="text-sm font-semibold mt-1">关注一些创作者，Ta 们发布新作品会出现在这里。</div>
                <UiButton variant="primary" class="mt-4 px-5 py-2.5 rounded-xl text-white text-sm font-semibold" @click="router.push('/explore')">
                  去探索社区
                </UiButton>
              </div>

              <div v-else class="max-h-[520px] overflow-y-auto divide-y divide-slate-200/70">
                <button
                  v-for="note in feedItems"
                  :key="note.id"
                  type="button"
                  class="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/35 transition"
                  @click="openFeedItem(note)"
                >
                  <img v-if="note.sender?.avatar" :src="note.sender.avatar" class="w-9 h-9 rounded-full object-cover border border-white/70 shrink-0" />
                  <div
                    v-else
                    class="w-9 h-9 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white text-xs font-extrabold border border-white/70 shrink-0"
                  >
                    {{ note.sender?.username?.charAt(0)?.toUpperCase() || 'U' }}
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <div class="text-xs font-extrabold text-slate-900 truncate">{{ note.sender?.username || '未知用户' }}</div>
                      <span v-if="!note.isRead" class="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
                      <div class="text-[11px] text-slate-500 font-semibold ml-auto shrink-0">{{ timeAgo(note.createdAt) }}</div>
                    </div>
                    <div v-if="note.type === 'followed_post'" class="mt-1 text-sm text-slate-700 truncate">
                      发布了动态：<span class="font-semibold text-slate-900">{{ String(note.post?.content || '').trim() || '发布了一条动态' }}</span>
                    </div>
                    <div v-else class="mt-1 text-sm text-slate-700 truncate">
                      发布了新作品：<span class="font-semibold text-slate-900">{{ note.project?.title || '未命名作品' }}</span>
                    </div>
                    <div v-if="false" class="mt-1 text-sm text-slate-700 truncate">
                      发布了新作品：<span class="font-semibold text-slate-900">{{ note.project?.title || '未命名作品' }}</span>
                    </div>
                  </div>

                  <div
                    v-if="note.type === 'followed_project' && note.project"
                    class="w-14 h-10 rounded-xl bg-white/50 border border-white/70 shrink-0 shadow-sm"
                    :style="coverStyle(note.project.cover)"
                  ></div>
                  <div
                    v-else-if="note.type === 'followed_post' && note.post?.project"
                    class="w-14 h-10 rounded-xl bg-white/50 border border-white/70 shrink-0 shadow-sm"
                    :style="coverStyle(note.post.project.cover)"
                  ></div>
                </button>
              </div>

              <div class="px-4 py-3 border-t border-slate-200/70 bg-white/35 flex items-center justify-between">
                <button class="text-xs font-semibold text-slate-600 hover:text-slate-900 transition" type="button" @click="fetchFeed">刷新</button>
                <button class="text-xs font-semibold text-sky-700 hover:text-sky-600 transition" type="button" @click="goToFeed">查看全部</button>
              </div>
            </div>
          </div>

          <button class="nav-icon" type="button" @click="goToStudio" aria-label="创作中心">
            <i class="ph-bold ph-pen-nib text-xl"></i>
            <span class="text-[11px] font-bold text-slate-600 leading-none">创作中心</span>
          </button>
        </div>

        <AuroraButton class="hidden sm:inline-flex ml-2 text-white text-sm font-semibold px-4 py-2 rounded-full" @click="goToStudio">
          <span class="inline-flex items-center gap-2">
            <i class="ph-bold ph-upload-simple text-lg"></i>
            投稿
          </span>
        </AuroraButton>

        <div class="relative ml-1" @pointerenter="user ? openUserMenuPanel() : null" @pointerleave="user ? scheduleCloseUserMenuPanel() : null">
          <button
            v-if="user"
            type="button"
            class="w-10 h-10 rounded-full bg-white/65 border border-white/70 backdrop-blur-xl flex items-center justify-center text-sky-700 hover:border-sky-200 transition overflow-hidden shadow-[0_18px_45px_-40px_rgba(2,132,199,0.8)]"
            aria-label="个人中心"
            @click="goToMeSpace"
          >
            <img v-if="user.avatar" :src="user.avatar" class="w-full h-full object-cover" />
            <i v-else class="ph ph-user text-lg"></i>
          </button>

          <UiButton v-else variant="secondary" class="px-4 py-2 rounded-full text-sm font-semibold" @click="openLoginCard">
            登录
          </UiButton>

          <!-- User dropdown -->
          <div
            v-if="user && isUserMenuOpen"
            class="absolute right-0 mt-2 w-[min(320px,calc(100vw-2rem))] glass-card rounded-2xl border border-white/70 overflow-hidden shadow-2xl"
            @pointerenter="clearUserMenuCloseTimer"
            @pointerleave="scheduleCloseUserMenuPanel"
          >
            <div class="p-5">
              <div class="flex items-center gap-3">
                <div class="w-14 h-14 rounded-full bg-white/65 border border-white/70 overflow-hidden shrink-0">
                  <img v-if="user.avatar" :src="user.avatar" class="w-full h-full object-cover" />
                  <div v-else class="w-full h-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white text-xl font-extrabold">
                    {{ user.username?.charAt(0)?.toUpperCase() || 'U' }}
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-base font-extrabold text-slate-900 truncate">{{ user.username || '用户' }}</div>
                  <div class="text-xs text-slate-500 font-semibold mt-0.5">欢迎回来</div>
                </div>
              </div>

              <div class="mt-4 grid grid-cols-3 gap-2">
                <div class="stat">
                  <div class="stat-num">{{ meStats.followingCount }}</div>
                  <div class="stat-label">关注</div>
                </div>
                <div class="stat">
                  <div class="stat-num">{{ meStats.followerCount }}</div>
                  <div class="stat-label">粉丝</div>
                </div>
                <button type="button" class="stat stat-btn" @click="goToFeed">
                  <div class="stat-num">{{ unreadFollowedFeed }}</div>
                  <div class="stat-label">动态</div>
                </button>
              </div>
            </div>

            <div class="px-4 py-3 border-t border-slate-200/70 bg-white/30 space-y-1">
              <button type="button" class="menu-row" @click="router.push('/profile')">
                <i class="ph-bold ph-user-circle"></i><span class="flex-1">个人中心</span><i class="ph-bold ph-caret-right"></i>
              </button>
              <button type="button" class="menu-row" @click="goToStudio">
                <i class="ph-bold ph-upload-simple"></i><span class="flex-1">投稿管理</span><i class="ph-bold ph-caret-right"></i>
              </button>
              <button type="button" class="menu-row" @click="goToNotifications">
                <i class="ph-bold ph-envelope-simple"></i><span class="flex-1">消息</span>
                <span v-if="unreadNonFeed" class="pill">{{ unreadNonFeed > 99 ? '99+' : unreadNonFeed }}</span>
              </button>
              <button type="button" class="menu-row" @click="goToFeed">
                <i class="ph-bold ph-broadcast"></i><span class="flex-1">动态</span>
                <span v-if="unreadFollowedFeed" class="pill">{{ unreadFollowedFeed > 99 ? '99+' : unreadFollowedFeed }}</span>
              </button>
              <button type="button" class="menu-row text-rose-700" @click="logout">
                <i class="ph-bold ph-sign-out"></i><span class="flex-1">退出登录</span>
              </button>
            </div>
          </div>

          <!-- Login dropdown -->
          <div
            v-if="!user && isLoginCardOpen"
            class="absolute right-0 mt-2 w-[min(360px,calc(100vw-2rem))] glass-card rounded-2xl border border-white/70 overflow-hidden shadow-2xl"
          >
            <div class="p-5">
              <div class="text-base font-extrabold text-slate-900">登录后你可以：</div>
              <div class="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-700 font-semibold">
                <div class="perk"><i class="ph-bold ph-cloud-arrow-up"></i> 云端保存工程</div>
                <div class="perk"><i class="ph-bold ph-git-fork"></i> Fork 社区作品</div>
                <div class="perk"><i class="ph-bold ph-broadcast"></i> 关注动态提醒</div>
                <div class="perk"><i class="ph-bold ph-chat-circle-text"></i> 私聊与互动</div>
              </div>

              <UiButton variant="primary" class="mt-5 w-full px-5 py-3 rounded-xl text-white text-sm font-semibold" @click="router.push('/login')">
                立即登录
              </UiButton>
              <div class="mt-3 text-center text-xs text-slate-600 font-semibold">
                首次使用？<button class="text-sky-700 hover:text-sky-600 transition" type="button" @click="router.push('/register')">点击注册</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile sheet -->
    <div v-if="isMobileMenuOpen" class="lg:hidden border-t border-white/60">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 py-4 space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="item in desktopLinks"
            :key="item.name"
            type="button"
            class="px-4 py-3 rounded-2xl bg-white/50 border border-white/70 text-sm font-semibold text-slate-700 hover:bg-white/65 transition"
            :class="isActive(item.name) ? 'ring-4 ring-sky-300/25 text-slate-900' : ''"
            @click="router.push(item.to)"
          >
            {{ item.label }}
          </button>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="item in moreLinks"
            :key="item.name"
            type="button"
            class="px-4 py-3 rounded-2xl bg-white/45 border border-white/70 text-sm font-semibold text-slate-700 hover:bg-white/65 transition flex items-center gap-2"
            :class="isActive(item.name) ? 'ring-4 ring-sky-300/25 text-slate-900' : ''"
            @click="router.push(item.to)"
          >
            <i :class="item.icon" class="text-slate-500"></i>
            {{ item.label }}
          </button>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <button type="button" class="mobile-icon" @click="goToNotifications">
            <i class="ph-bold ph-envelope-simple text-xl"></i>
            <span>消息</span>
            <span v-if="unreadNonFeed" class="mobile-badge">{{ unreadNonFeed > 99 ? '99+' : unreadNonFeed }}</span>
          </button>
          <button type="button" class="mobile-icon" @click="goToFeed">
            <i class="ph-bold ph-broadcast text-xl"></i>
            <span>动态</span>
            <span v-if="unreadFollowedFeed" class="mobile-badge">{{ unreadFollowedFeed > 99 ? '99+' : unreadFollowedFeed }}</span>
          </button>
          <button type="button" class="mobile-icon" @click="goToStudio">
            <i class="ph-bold ph-upload-simple text-xl"></i>
            <span>投稿</span>
          </button>
        </div>

        <div class="flex items-center justify-between gap-2 pt-2">
          <UiButton v-if="user" variant="secondary" class="px-4 py-2 rounded-full text-sm font-semibold" @click="goToMeSpace">
            个人空间
          </UiButton>

          <div v-if="user" class="flex items-center gap-2 ml-auto">
            <UiButton @click="logout" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold">退出</UiButton>
          </div>
          <div v-else class="flex items-center gap-2 ml-auto">
            <UiButton @click="router.push('/login')" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold">登录</UiButton>
            <AuroraButton @click="router.push('/register')" class="text-white text-sm font-semibold px-4 py-2 rounded-full">注册</AuroraButton>
          </div>
        </div>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.nav-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: rgb(51, 65, 85);
  border: 1px solid transparent;
  transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease;
}
.nav-icon:hover {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.7);
  color: rgb(15, 23, 42);
}
.badge {
  position: absolute;
  top: 6px;
  right: 8px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9999px;
  background: rgb(244 63 94);
  color: white;
  font-size: 11px;
  font-weight: 900;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.85);
}
.stat {
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.45);
  padding: 10px 12px;
  text-align: center;
}
.stat-btn {
  transition: background-color 160ms ease, border-color 160ms ease, transform 160ms ease;
}
.stat-btn:hover {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(56, 189, 248, 0.35);
  transform: translateY(-1px);
}
.stat-num {
  font-size: 18px;
  font-weight: 900;
  color: rgb(15, 23, 42);
  line-height: 1.1;
}
.stat-label {
  margin-top: 4px;
  font-size: 11px;
  font-weight: 700;
  color: rgb(100, 116, 139);
}
.menu-row {
  width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  color: rgb(51, 65, 85);
  transition: background-color 160ms ease, color 160ms ease;
}
.menu-row:hover {
  background: rgba(255, 255, 255, 0.55);
  color: rgb(15, 23, 42);
}
.pill {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9999px;
  background: rgba(244, 63, 94, 0.12);
  border: 1px solid rgba(244, 63, 94, 0.2);
  color: rgb(225, 29, 72);
  font-size: 11px;
  font-weight: 900;
}
.perk {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.7);
}
.perk i {
  color: rgb(2, 132, 199);
}
.mobile-icon {
  position: relative;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.7);
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: rgb(51, 65, 85);
  font-size: 12px;
  font-weight: 800;
  transition: background-color 160ms ease, border-color 160ms ease;
}
.mobile-icon:hover {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(56, 189, 248, 0.35);
}
.mobile-badge {
  position: absolute;
  top: 8px;
  right: 10px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9999px;
  background: rgb(244 63 94);
  color: white;
  font-size: 11px;
  font-weight: 900;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.85);
}
</style>
