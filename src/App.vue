<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Navbar from './components/Navbar.vue';
import LoadingOverlay from './components/LoadingOverlay.vue';
import AuroraBackground from './components/AuroraBackground.vue';
import MusicPlayer from '@/components/Music/index.vue';
import AiAssistantModal from './components/AiAssistantModal.vue';
import { useLoader } from './composables/useLoader.js';
import { useUser, authFetch } from './composables/useUser.js';
import { fetchCached } from './utils/resourceCache.js';
const route = useRoute();
const { isLoading } = useLoader();
const { user } = useUser();
const showNavbar = computed(() => !route.meta?.hideNavbar);
const isAiOpen = ref(false);

const lastPrefetchAt = ref(0);
const prefetchPublic = async () => {
  const tasks = [
    fetchCached('api:/projects?limit=24', async () => {
      const res = await authFetch('/api/projects?limit=24');
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return Array.isArray(data) ? data : [];
    }, { ttlMs: 60_000, staleWhileRevalidate: true }),
    fetchCached('api:/emoji-packs', async () => {
      const res = await authFetch('/api/emoji-packs');
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return data || { pic: [], gif: [] };
    }, { ttlMs: 300_000, staleWhileRevalidate: true }),
    fetchCached('api:/music-proxy/status', async () => {
      const res = await authFetch('/api/music-proxy/status');
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return data || {};
    }, { ttlMs: 60_000, staleWhileRevalidate: true }),
  ];
  await Promise.allSettled(tasks);
};

const prefetchAuthed = async () => {
  if (!user.value?.uid) return;
  const uid = String(user.value.uid);
  const tasks = [
    fetchCached(`api:/users/${uid}/public`, async () => {
      const res = await authFetch(`/api/users/${encodeURIComponent(uid)}/public`);
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return data;
    }, { ttlMs: 60_000, staleWhileRevalidate: true }),
    fetchCached('api:/notifications/unread-count', async () => {
      const res = await authFetch('/api/notifications/unread-count');
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return data || {};
    }, { ttlMs: 30_000, staleWhileRevalidate: true }),
    fetchCached('api:/message-settings', async () => {
      const res = await authFetch('/api/message-settings');
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return data || {};
    }, { ttlMs: 60_000, staleWhileRevalidate: true }),
    fetchCached('api:/notifications?types=followed_project,followed_post&limit=20', async () => {
      const res = await authFetch('/api/notifications?types=followed_project,followed_post&limit=20');
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return Array.isArray(data) ? data : [];
    }, { ttlMs: 20_000, staleWhileRevalidate: true }),
    fetchCached(`api:/users/${uid}/following?limit=20`, async () => {
      const res = await authFetch(`/api/users/${encodeURIComponent(uid)}/following?limit=20`);
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return Array.isArray(data) ? data : [];
    }, { ttlMs: 40_000, staleWhileRevalidate: true }),
    fetchCached(`api:/users/${uid}/followers?limit=20`, async () => {
      const res = await authFetch(`/api/users/${encodeURIComponent(uid)}/followers?limit=20`);
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return Array.isArray(data) ? data : [];
    }, { ttlMs: 40_000, staleWhileRevalidate: true }),
    fetchCached('api:/recommendations/daily', async () => {
      const res = await authFetch('/api/recommendations/daily');
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return data || {};
    }, { ttlMs: 120_000, staleWhileRevalidate: true }),
  ];
  await Promise.allSettled(tasks);
};

const warmup = async () => {
  const now = Date.now();
  if (now - lastPrefetchAt.value < 8000) return;
  lastPrefetchAt.value = now;
  await prefetchPublic();
  await prefetchAuthed();
};

onMounted(() => {
  warmup();
});

watch(
  () => user.value?.uid,
  () => {
    warmup();
  }
);
</script>
<template>
  <div class="app-container font-sans min-h-screen text-slate-900">
    <AuroraBackground />
    <LoadingOverlay :show="isLoading" />

    <Navbar v-if="showNavbar" />

    <main :class="showNavbar ? 'pt-16' : ''">
      <router-view v-slot="{ Component, route: r }">
        <transition name="page" mode="out-in">
          <keep-alive v-if="r.meta?.keepAlive">
            <component :is="Component" :key="r.name" />
          </keep-alive>
          <component v-else :is="Component" :key="r.fullPath" />
        </transition>
      </router-view>
    </main>
    <button class="ai-fab" @click="isAiOpen = true">
      <i class="ph-bold ph-sparkle"></i>
      AI 助手
    </button>
    <AiAssistantModal v-model:open="isAiOpen" />
    <MusicPlayer />
  </div>
</template>

<style scoped>
.ai-fab {
  position: fixed;
  right: 20px;
  bottom: 24px;
  z-index: 55;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 999px;
  border: none;
  color: white;
  font-weight: 700;
  background: linear-gradient(135deg, rgb(34, 199, 184), rgb(245, 178, 74));
  box-shadow: 0 18px 40px -25px rgba(17, 20, 24, 0.35);
  cursor: pointer;
}

.ai-fab:hover {
  transform: translateY(-1px);
}

@media (max-width: 640px) {
  .ai-fab {
    right: 14px;
    bottom: 16px;
    padding: 10px 12px;
    font-size: 13px;
  }
}
</style>
