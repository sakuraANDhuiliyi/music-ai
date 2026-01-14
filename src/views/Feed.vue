<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';

const router = useRouter();
const { user, isAuthReady } = useUser();

const items = ref([]);
const isLoading = ref(true);
const errorMsg = ref('');

const ensureLoggedIn = () => {
  if (!isAuthReady.value) return false;
  if (user.value) return true;
  router.push('/login');
  return false;
};

const coverStyle = (cover) => {
  const c = String(cover || '').trim();
  if (!c) {
    return { background: 'linear-gradient(135deg,rgba(56,189,248,0.28),rgba(99,102,241,0.22))' };
  }
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
    await authFetch('/api/notifications/read', {
      method: 'PUT',
      body: JSON.stringify({ types: ['followed_project'] }),
    });
    items.value = (items.value || []).map((it) => ({ ...it, isRead: true }));
  } catch {
    // ignore
  }
};

const fetchFeed = async () => {
  if (!ensureLoggedIn()) return;
  isLoading.value = true;
  errorMsg.value = '';
  try {
    const res = await authFetch('/api/notifications?types=followed_project&limit=50');
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

const hasItems = computed(() => (items.value || []).length > 0);

const openProject = (note) => {
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
            <div class="text-xs text-slate-500 font-semibold">你关注的人发布新作品会出现在这里</div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <UiButton
            variant="secondary"
            class="px-4 py-2 rounded-xl text-sm font-semibold"
            :disabled="isLoading || !hasItems"
            @click="markAllRead"
          >
            全部已读
          </UiButton>
          <UiButton variant="ghost" class="px-3 py-2 rounded-xl text-sm font-semibold" @click="fetchFeed">
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
            <div class="text-slate-600 text-sm mb-4">关注喜欢的创作者，第一时间获取新作品通知。</div>
            <UiButton variant="primary" class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" @click="router.push('/login')">
              立即登录
            </UiButton>
          </div>
        </div>
      </div>

      <div v-else class="glass-card rounded-2xl border border-white/70 overflow-hidden">
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
            class="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-white/35 transition"
            @click="openProject(note)"
          >
            <div class="shrink-0">
              <img
                v-if="note.sender?.avatar"
                :src="note.sender.avatar"
                class="w-10 h-10 rounded-full object-cover border border-white/70"
              />
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
              <div class="mt-1 text-sm text-slate-700 truncate">
                发布了新作品：<span class="font-semibold text-slate-900">{{ note.project?.title || '未命名作品' }}</span>
              </div>
            </div>

            <div
              v-if="note.project"
              class="w-16 h-12 rounded-xl bg-white/50 border border-white/70 shrink-0 shadow-sm"
              :style="coverStyle(note.project.cover)"
            ></div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

