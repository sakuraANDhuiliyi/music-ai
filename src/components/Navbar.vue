<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import AuroraButton from './AuroraButton.vue';
import UiButton from './UiButton.vue';

const router = useRouter();
const currentRoute = router.currentRoute;
const { user, logout } = useUser();

const unreadCount = ref(0);
const searchQuery = ref('');

const isMobileMenuOpen = ref(false);
const isMoreOpen = ref(false);
const navRootRef = ref(null);

let pollTimer = null;
let backoffMs = 5000;
let consecutiveFailures = 0;

const closeMenus = () => {
  isMobileMenuOpen.value = false;
  isMoreOpen.value = false;
};

watch(
  () => currentRoute.value.fullPath,
  () => closeMenus()
);

const isActive = (name) => currentRoute.value.name === name;

const navLinkClass = (name) => {
  const active = isActive(name);
  return [
    'nav-link',
    active ? 'nav-link--active' : 'nav-link--inactive',
  ].join(' ');
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

const goToNotifications = () => router.push({ name: 'Notifications', query: { tab: 'replies' } });
const goToProfile = () => router.push('/profile');
const goToStudio = () => router.push('/studio');

const checkUnread = async () => {
  if (!user.value) {
    unreadCount.value = 0;
    return;
  }
  try {
    const res = await authFetch('/api/notifications/unread-count');
    if (res.ok) {
      const data = await res.json();
      unreadCount.value = data.totalCount ?? data.count ?? 0;
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

onMounted(() => {
  scheduleNextPoll();
  const onDocDown = (e) => {
    const root = navRootRef.value;
    if (!root) return;
    if (root.contains(e.target)) return;
    closeMenus();
  };
  const onKeyDown = (e) => {
    if (e?.key === 'Escape') closeMenus();
  };
  document.addEventListener('pointerdown', onDocDown, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  navRootRef.value.__onDocDown = onDocDown;
  navRootRef.value.__onKeyDown = onKeyDown;
});

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer);
  const root = navRootRef.value;
  const onDocDown = root?.__onDocDown;
  const onKeyDown = root?.__onKeyDown;
  if (onDocDown) document.removeEventListener('pointerdown', onDocDown);
  if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
});

const desktopLinks = computed(() => [
  { label: '首页', name: 'Home', to: '/' },
  { label: '创作', name: 'Studio', to: '/studio' },
  { label: '社区', name: 'Explore', to: '/explore' },
  { label: '素材库', name: 'Library', to: '/library' },
]);

const moreLinks = computed(() => [
  { label: '每日推荐', name: 'DailyRecommendations', to: '/daily', icon: 'ph-bold ph-sparkle' },
  { label: '弹奏乐器', name: 'PianoPlay', to: '/piano', icon: 'ph-bold ph-piano-keys' },
  { label: '音频转谱', name: 'AudioToSheet', to: '/audio-to-sheet', icon: 'ph-bold ph-waveform' },
  { label: 'AI 和弦', name: 'AiChordCreator', to: '/ai-chord', icon: 'ph-bold ph-magic-wand' },
]);
</script>

<template>
  <nav ref="navRootRef" class="fixed top-0 inset-x-0 z-50 glass border-b border-white/70">
    <div class="mx-auto max-w-7xl h-16 px-4 sm:px-6 flex items-center gap-3">
      <!-- Brand -->
      <button class="flex items-center gap-2 shrink-0" @click="router.push('/')" aria-label="MuseAI 首页">
        <div
          class="w-9 h-9 bg-gradient-to-tr from-sky-400 to-indigo-500 rounded-xl flex items-center justify-center shadow-[0_18px_45px_-28px_rgba(2,132,199,0.8)]"
        >
          <i class="ph-fill ph-music-notes text-white text-xl"></i>
        </div>
        <span
          class="hidden sm:inline text-xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-800 to-sky-700 tracking-tight"
        >
          MuseAI
        </span>
      </button>

      <!-- Desktop nav -->
      <div class="hidden lg:flex items-center gap-2 ml-4">
        <router-link
          v-for="item in desktopLinks"
          :key="item.name"
          :to="item.to"
          :class="navLinkClass(item.name)"
        >
          {{ item.label }}
        </router-link>

        <div class="relative">
          <button
            class="nav-link nav-link--inactive inline-flex items-center gap-1"
            :class="isMoreOpen ? 'nav-link--active' : ''"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="isMoreOpen ? 'true' : 'false'"
            @click="isMoreOpen = !isMoreOpen"
          >
            更多
            <i class="ph-bold ph-caret-down text-sm"></i>
          </button>

          <div
            v-if="isMoreOpen"
            class="absolute left-0 mt-2 w-56 glass-card rounded-2xl border border-white/70 overflow-hidden shadow-xl"
            role="menu"
          >
            <button
              v-for="item in moreLinks"
              :key="item.name"
              class="w-full px-4 py-3 text-sm font-semibold text-left flex items-center gap-3 hover:bg-white/35 transition"
              :class="isActive(item.name) ? 'text-slate-900' : 'text-slate-700'"
              type="button"
              role="menuitem"
              @click="router.push(item.to)"
            >
              <i :class="item.icon" class="text-slate-500"></i>
              <span>{{ item.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Search (desktop) -->
      <div class="hidden xl:flex items-center flex-1 justify-center">
        <form @submit.prevent="submitSearch" class="w-full max-w-[420px]">
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
      <div class="ml-auto flex items-center gap-2">
        <!-- Mobile: search + menu -->
        <UiButton
          variant="ghost"
          class="lg:hidden px-2 py-2 rounded-lg"
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

        <UiButton variant="secondary" class="hidden sm:inline-flex px-4 py-2 rounded-full text-sm font-semibold" @click="goToStudio">
          <i class="ph-bold ph-plus"></i>
          新建
        </UiButton>

        <template v-if="user">
          <UiButton @click="goToNotifications" variant="ghost" class="relative px-2 py-2 rounded-lg" aria-label="通知">
            <i class="ph-bold ph-bell text-xl"></i>
            <span
              v-if="unreadCount > 0"
              class="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border border-white/80 shadow-sm"
            >
              {{ unreadCount > 9 ? '9+' : unreadCount }}
            </span>
          </UiButton>

          <button
            @click="goToProfile"
            class="w-9 h-9 rounded-full bg-white/65 border border-white/70 backdrop-blur-xl flex items-center justify-center text-sky-700 hover:border-sky-200 transition overflow-hidden shadow-[0_18px_45px_-40px_rgba(2,132,199,0.8)]"
            aria-label="个人中心"
          >
            <img v-if="user.avatar" :src="user.avatar" class="w-full h-full object-cover" />
            <i v-else class="ph ph-user text-lg"></i>
          </button>

          <UiButton @click="logout" variant="ghost" class="hidden sm:inline-flex px-2 py-2 rounded-lg text-xs ml-1 items-center gap-1">
            <i class="ph-bold ph-sign-out text-lg"></i><span class="hidden sm:inline">退出</span>
          </UiButton>
        </template>

        <template v-else>
          <UiButton @click="router.push('/login')" variant="ghost" class="hidden sm:inline-flex text-sm font-semibold px-3 py-2 rounded-lg">
            登录
          </UiButton>
          <AuroraButton @click="router.push('/register')" class="hidden sm:inline-flex text-white text-sm font-semibold px-4 py-2 rounded-full">
            免费注册
          </AuroraButton>
        </template>
      </div>
    </div>

    <!-- Mobile sheet -->
    <div v-if="isMobileMenuOpen" class="lg:hidden border-t border-white/60">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 py-4 space-y-3">
        <form @submit.prevent="submitSearch" class="w-full">
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

        <div class="flex items-center justify-between gap-2 pt-2">
          <UiButton variant="secondary" class="px-4 py-2 rounded-full text-sm font-semibold" @click="goToStudio">
            <i class="ph-bold ph-plus"></i> 新建作品
          </UiButton>

          <div v-if="user" class="flex items-center gap-2">
            <UiButton @click="goToNotifications" variant="ghost" class="relative px-2 py-2 rounded-lg" aria-label="通知">
              <i class="ph-bold ph-bell text-xl"></i>
              <span
                v-if="unreadCount > 0"
                class="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border border-white/80 shadow-sm"
              >
                {{ unreadCount > 9 ? '9+' : unreadCount }}
              </span>
            </UiButton>
            <UiButton @click="logout" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold">退出</UiButton>
          </div>
          <div v-else class="flex items-center gap-2">
            <UiButton @click="router.push('/login')" variant="ghost" class="px-3 py-2 rounded-lg text-sm font-semibold">登录</UiButton>
            <AuroraButton @click="router.push('/register')" class="text-white text-sm font-semibold px-4 py-2 rounded-full">注册</AuroraButton>
          </div>
        </div>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.nav-link {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1;
  border: 1px solid transparent;
  transition:
    background-color 180ms ease,
    color 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}
.nav-link--inactive {
  color: rgb(71, 85, 105);
}
.nav-link--inactive:hover {
  color: rgb(15, 23, 42);
  background: rgba(255, 255, 255, 0.55);
}
.nav-link--active {
  color: rgb(15, 23, 42);
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(255, 255, 255, 0.7);
  box-shadow: 0 14px 35px -30px rgba(2, 132, 199, 0.25);
}
</style>
