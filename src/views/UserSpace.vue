<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';

const route = useRoute();
const router = useRouter();
const { user, isAuthReady } = useUser();

const userId = computed(() => String(route.params.id || '').trim());
const isSelf = computed(() => user.value && userId.value && String(user.value.uid) === String(userId.value));

const profile = ref(null);
const projects = ref([]);
const relationship = ref({ isFollowing: false, isBlocked: false, hasBlockedMe: false, isSelf: false });

const isLoading = ref(true);
const errorMsg = ref('');
const isFollowPending = ref(false);

const coverStyle = (cover) => {
  const c = String(cover || '').trim();
  if (!c) return { background: 'linear-gradient(135deg,rgba(56,189,248,0.28),rgba(99,102,241,0.22))' };
  if (/^(https?:)?\/\//.test(c) || c.startsWith('/') || c.startsWith('data:')) {
    return { backgroundImage: `url(${c})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: c };
};

const fetchRelationship = async () => {
  relationship.value = { isFollowing: false, isBlocked: false, hasBlockedMe: false, isSelf: Boolean(isSelf.value) };
  if (!user.value || !userId.value || isSelf.value) return;
  try {
    const res = await authFetch(`/api/users/${encodeURIComponent(userId.value)}/relationship`);
    if (res.ok) relationship.value = await res.json();
  } catch {
    // ignore
  }
};

const toggleFollow = async () => {
  if (!userId.value) return;
  if (!isAuthReady.value) return;
  if (!user.value) return router.push('/login');
  if (isSelf.value) return;
  if (relationship.value?.hasBlockedMe || relationship.value?.isBlocked) return;

  isFollowPending.value = true;
  try {
    const res = await authFetch(`/api/users/${encodeURIComponent(userId.value)}/follow`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const data = res.ok ? await res.json() : null;
    if (res.ok && data && typeof data.isFollowing === 'boolean') {
      relationship.value = { ...(relationship.value || {}), isFollowing: data.isFollowing };
      await fetchProfile();
    }
  } catch {
    // ignore
  } finally {
    isFollowPending.value = false;
  }
};

const fetchProfile = async () => {
  if (!userId.value) return;
  const res = await authFetch(`/api/users/${encodeURIComponent(userId.value)}/public`);
  const data = res.ok ? await res.json() : null;
  if (!res.ok) throw new Error(data?.message || '加载失败');
  profile.value = data;
};

const fetchProjects = async () => {
  if (!userId.value) return;
  // Use a stable endpoint to avoid 404 when backend routes are missing/outdated.
  // Newer server versions may honor `?author=`; older versions return all projects and we filter client-side.
  const res = await authFetch(`/api/projects?author=${encodeURIComponent(userId.value)}`);
  const data = res.ok ? await res.json() : null;
  if (!res.ok) {
    throw new Error(data?.message || '加载失败');
  }
  const raw = Array.isArray(data) ? data : [];
  const target = String(userId.value);
  projects.value = raw
    .filter((p) => {
      const author = p?.author;
      const authorId = typeof author === 'string' ? author : String(author?.uid || author?.id || author?._id || '');
      return authorId && authorId === target;
    })
    .slice(0, 50);
};

const fetchAll = async () => {
  errorMsg.value = '';
  isLoading.value = true;
  profile.value = null;
  projects.value = [];
  try {
    await Promise.all([fetchProfile(), fetchProjects(), fetchRelationship()]);
  } catch (e) {
    errorMsg.value = e?.message || '加载失败';
  } finally {
    isLoading.value = false;
  }
};

const openProject = (p) => {
  const id = String(p?.id || '').trim();
  if (!id) return;
  router.push({ name: 'ProjectDetail', params: { id } });
};

watch(
  () => user.value?.uid,
  () => fetchRelationship()
);

watch(
  () => route.params.id,
  () => fetchAll(),
  { immediate: true }
);
</script>

<template>
  <div class="page pb-12">
    <div class="page-container max-w-6xl">
      <div class="flex items-center gap-3 mb-6">
        <UiButton @click="router.back()" variant="ghost" class="px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
          <i class="ph-bold ph-arrow-left"></i>
          返回
        </UiButton>
        <span class="text-sm text-slate-500 font-semibold">个人空间</span>
      </div>

      <div v-if="isLoading" class="glass-card rounded-2xl border border-white/70 overflow-hidden">
        <div class="p-6 space-y-3">
          <div class="h-6 w-1/3 rounded-lg skeleton"></div>
          <div class="h-4 w-2/3 rounded-lg skeleton"></div>
          <div class="h-4 w-1/2 rounded-lg skeleton"></div>
        </div>
      </div>

      <div v-else-if="errorMsg" class="glass-card rounded-2xl border border-white/70 p-8">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600">
            <i class="ph-bold ph-warning-circle text-2xl"></i>
          </div>
          <div class="flex-1">
            <div class="text-lg font-extrabold text-slate-900 mb-1">加载失败</div>
            <div class="text-slate-600 text-sm">{{ errorMsg }}</div>
            <div class="mt-5 flex gap-3">
              <UiButton @click="router.push('/explore')" variant="primary" class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center gap-2">
                <i class="ph-bold ph-compass"></i>
                去社区
              </UiButton>
              <UiButton @click="fetchAll" variant="secondary" class="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2">
                <i class="ph-bold ph-arrow-clockwise"></i>
                重试
              </UiButton>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="space-y-6">
        <div class="glass-card rounded-2xl border border-white/70 p-6">
          <div class="flex flex-col sm:flex-row sm:items-center gap-4">
            <div class="flex items-center gap-4 flex-1 min-w-0">
              <div class="w-16 h-16 rounded-full bg-white/65 border border-white/70 overflow-hidden shrink-0">
                <img v-if="profile?.avatar" :src="profile.avatar" class="w-full h-full object-cover" />
                <div
                  v-else
                  class="w-full h-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white text-2xl font-extrabold"
                >
                  {{ profile?.username?.charAt(0)?.toUpperCase() || 'U' }}
                </div>
              </div>
              <div class="min-w-0">
                <div class="text-2xl font-extrabold text-slate-900 truncate">{{ profile?.username || '用户' }}</div>
                <div class="text-sm text-slate-600 mt-1 clamp-2">{{ profile?.bio || '这个人很神秘，什么都没写。' }}</div>
                <div class="mt-3 flex items-center gap-3 text-xs font-semibold text-slate-600">
                  <span class="px-2.5 py-1 rounded-full bg-white/55 border border-white/70">关注 {{ profile?.followingCount ?? 0 }}</span>
                  <span class="px-2.5 py-1 rounded-full bg-white/55 border border-white/70">粉丝 {{ profile?.followerCount ?? 0 }}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <UiButton
                v-if="!isSelf && !relationship.isBlocked && !relationship.hasBlockedMe"
                @click="toggleFollow"
                variant="primary"
                class="px-5 py-2.5 rounded-xl text-sm font-extrabold text-white flex items-center gap-2"
                :disabled="isFollowPending"
              >
                <i :class="relationship.isFollowing ? 'ph-fill ph-check' : 'ph-bold ph-plus'"></i>
                {{ relationship.isFollowing ? '已关注' : '关注' }}
              </UiButton>
              <UiButton v-if="isSelf" @click="router.push('/profile')" variant="secondary" class="px-5 py-2.5 rounded-xl text-sm font-extrabold">
                <i class="ph-bold ph-gear"></i>
                设置
              </UiButton>
            </div>
          </div>
        </div>

        <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
          <div class="px-4 sm:px-6 py-4 border-b border-slate-200/70 bg-white/40 flex items-center justify-between">
            <div class="text-sm font-extrabold text-slate-900">作品</div>
            <div class="text-xs text-slate-500 font-semibold">共 {{ projects.length }} 个</div>
          </div>

          <div v-if="projects.length" class="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <button
              v-for="p in projects"
              :key="p.id"
              type="button"
              class="glass-card rounded-2xl border border-white/70 overflow-hidden text-left hover:shadow-lg transition"
              @click="openProject(p)"
            >
              <div class="h-32" :style="coverStyle(p.cover)"></div>
              <div class="p-4">
                <div class="font-extrabold text-slate-900 truncate">{{ p.title || '未命名作品' }}</div>
                <div class="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-semibold">
                  <span>{{ p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '' }}</span>
                  <span class="inline-flex items-center gap-1"><i class="ph-bold ph-heart"></i>{{ p.likesCount ?? 0 }}</span>
                </div>
              </div>
            </button>
          </div>

          <div v-else class="p-10 text-center text-slate-500">
            <div class="font-extrabold text-slate-900">暂无作品</div>
            <div class="text-sm font-semibold mt-1">Ta 还没有发布作品。</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
