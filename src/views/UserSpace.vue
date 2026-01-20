<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';
import MentionText from '../components/MentionText.vue';
import { fetchCached } from '../utils/resourceCache.js';
import { apiCreateProjectDraft, apiGetDraftProjects, apiGetProjectSource, apiUpdateProjectDraft } from '../api/projects.js';
import { removeProjectDraft } from '../utils/projectStorage.js';

const route = useRoute();
const router = useRouter();
const { user, isAuthReady } = useUser();

const userId = computed(() => String(route.params.id || '').trim());
const isSelf = computed(() => user.value && userId.value && String(user.value.uid) === String(userId.value));

const profile = ref(null);
const projects = ref([]);
const draftProjects = ref([]);
const posts = ref([]);
const followingList = ref([]);
const followerList = ref([]);
const followSearch = ref('');
const isFollowLoading = ref(false);
const followError = ref('');
const relationship = ref({ isFollowing: false, isBlocked: false, hasBlockedMe: false, isSelf: false });

const isLoading = ref(true);
const errorMsg = ref('');
const isFollowPending = ref(false);

const followTab = computed(() => {
  const t = String(route.query?.tab || '').trim();
  if (t === 'following' || t === 'followers') return t;
  return '';
});
const isFollowPage = computed(() => Boolean(followTab.value));
const followTitle = computed(() => (followTab.value === 'followers' ? '粉丝' : '关注'));
const followCount = computed(() => (followTab.value === 'followers' ? followerList.value.length : followingList.value.length));
const filteredFollowList = computed(() => {
  const q = followSearch.value.trim().toLowerCase();
  const list = followTab.value === 'followers' ? followerList.value : followingList.value;
  if (!q) return list;
  return list.filter((u) => String(u?.username || '').toLowerCase().includes(q) || String(u?.bio || '').toLowerCase().includes(q));
});
const profileStats = computed(() => ([
  { label: '作品', value: projects.value.length },
  { label: '动态', value: posts.value.length },
  { label: '关注', value: profile.value?.followingCount ?? 0 },
  { label: '粉丝', value: profile.value?.followerCount ?? 0 },
]));

const coverStyle = (cover) => {
  const c = String(cover || '').trim();
  if (!c) return { background: 'linear-gradient(135deg,rgba(34,199,184,0.22),rgba(245,178,74,0.24))' };
  if (/^(https?:)?\/\//.test(c) || c.startsWith('/') || c.startsWith('data:')) {
    return { backgroundImage: `url(${c})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: c };
};

const userCoverStyle = (cover) => {
  const c = String(cover || '').trim();
  if (!c) return { background: 'linear-gradient(135deg,rgba(34,199,184,0.18),rgba(240,106,90,0.22))' };
  if (/^(https?:)?\/\//.test(c) || c.startsWith('/') || c.startsWith('data:')) {
    return { backgroundImage: `url(${c})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: c };
};

const normalizedDrafts = computed(() => {
  const list = Array.isArray(draftProjects.value) ? draftProjects.value : [];
  const seen = new Map();
  for (const p of list) {
    const localId = String(p?.editorMeta?.id || '').trim();
    const key = localId || String(p?.id || '').trim();
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, p);
      continue;
    }
    const prevTime = new Date(prev?.updatedAt || prev?.createdAt || 0).getTime() || 0;
    const nextTime = new Date(p?.updatedAt || p?.createdAt || 0).getTime() || 0;
    if (nextTime >= prevTime) seen.set(key, p);
  }
  const unique = Array.from(seen.values());
  unique.sort((a, b) => {
    const ta = new Date(a?.updatedAt || a?.createdAt || 0).getTime() || 0;
    const tb = new Date(b?.updatedAt || b?.createdAt || 0).getTime() || 0;
    return tb - ta;
  });
  return unique;
});

const DRAFT_MAP_KEY = 'studio:draftMap';
const removeDraftMapId = (localId) => {
  const lid = String(localId || '').trim();
  if (!lid) return;
  try {
    const raw = localStorage.getItem(DRAFT_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return;
    if (!(lid in parsed)) return;
    delete parsed[lid];
    localStorage.setItem(DRAFT_MAP_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
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
  const url = `/api/users/${encodeURIComponent(userId.value)}/public`;
  const data = await fetchCached(
    `api:${url}`,
    async () => {
      const res = await authFetch(url);
      const json = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(json?.message || '加载失败');
      return json;
    },
    { ttlMs: 60_000, staleWhileRevalidate: true }
  );
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

const fetchDraftProjects = async () => {
  if (!userId.value) return;
  if (!isSelf.value) {
    draftProjects.value = [];
    return;
  }
  try {
    const items = await apiGetDraftProjects(userId.value, { limit: 60 });
    draftProjects.value = Array.isArray(items) ? items : [];
  } catch {
    draftProjects.value = [];
  }
};

const fetchFollowing = async () => {
  if (!userId.value) return;
  const url = `/api/users/${encodeURIComponent(userId.value)}/following?limit=100`;
  const data = await fetchCached(
    `api:${url}`,
    async () => {
      const res = await authFetch(url);
      const json = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(json?.message || '加载失败');
      return Array.isArray(json) ? json : [];
    },
    { ttlMs: 30_000, staleWhileRevalidate: true }
  );
  followingList.value = Array.isArray(data) ? data : [];
};

const fetchFollowers = async () => {
  if (!userId.value) return;
  const url = `/api/users/${encodeURIComponent(userId.value)}/followers?limit=100`;
  const data = await fetchCached(
    `api:${url}`,
    async () => {
      const res = await authFetch(url);
      const json = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(json?.message || '加载失败');
      return Array.isArray(json) ? json : [];
    },
    { ttlMs: 30_000, staleWhileRevalidate: true }
  );
  followerList.value = Array.isArray(data) ? data : [];
};

const fetchFollowList = async () => {
  if (!isFollowPage.value) return;
  followError.value = '';
  isFollowLoading.value = true;
  try {
    if (followTab.value === 'followers') await fetchFollowers();
    else await fetchFollowing();
  } catch (e) {
    followError.value = e?.message || '加载失败';
  } finally {
    isFollowLoading.value = false;
  }
};

const fetchPosts = async () => {
  if (!userId.value) return;
  const res = await authFetch(`/api/users/${encodeURIComponent(userId.value)}/posts`);
  const data = res.ok ? await res.json() : null;
  if (!res.ok) throw new Error(data?.message || '加载失败');
  posts.value = Array.isArray(data) ? data : [];
};

const fetchAll = async () => {
  errorMsg.value = '';
  isLoading.value = true;
  profile.value = null;
  projects.value = [];
  draftProjects.value = [];
  posts.value = [];
  followingList.value = [];
  followerList.value = [];
  try {
    await Promise.all([fetchProfile(), fetchProjects(), fetchPosts(), fetchRelationship(), fetchDraftProjects()]);
    await fetchFollowList();
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

const openDraft = (p) => {
  const id = String(p?.id || '').trim();
  if (!id) return;
  router.push({ name: 'Studio', params: { projectId: id } });
};

const deleteProject = async (p) => {
  if (!isSelf.value) return;
  const id = String(p?.id || '').trim();
  if (!id) return;
  if (!window.confirm('确定删除该作品吗？')) return;
  try {
    const res = await authFetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = res.ok ? await res.json() : null;
    if (!res.ok) throw new Error(data?.message || '删除失败');
    projects.value = (projects.value || []).filter((it) => String(it?.id || '') !== id);
  } catch (e) {
    alert(e?.message || '删除失败');
  }
};

const deleteDraft = async (p) => {
  if (!isSelf.value) return;
  const id = String(p?.id || '').trim();
  if (!id) return;
  if (!window.confirm('确定删除该草稿吗？')) return;
  const localId = String(p?.editorMeta?.id || '').trim();
  try {
    const res = await authFetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = res.ok ? await res.json() : null;
    if (!res.ok) throw new Error(data?.message || '删除失败');
    draftProjects.value = (draftProjects.value || []).filter((it) => String(it?.id || '') !== id);
    try {
      if (localId) {
        removeProjectDraft(localId);
        removeDraftMapId(localId);
      }
      removeProjectDraft(id);
      const lastKey = 'studio:lastProjectId';
      const snapKey = 'studio:lastSnapshot';
      const last = String(localStorage.getItem(lastKey) || '').trim();
      if (last === id || (localId && last === localId)) localStorage.removeItem(lastKey);
      const snapRaw = localStorage.getItem(snapKey);
      if (snapRaw) {
        const snap = JSON.parse(snapRaw);
        const sid = String(snap?.id || '').trim();
        if (sid === id || (localId && sid === localId)) localStorage.removeItem(snapKey);
      }
    } catch {
      // ignore local cleanup
    }
  } catch (e) {
    alert(e?.message || '删除失败');
  }
};

const renameDraft = async (p) => {
  if (!isSelf.value) return;
  const id = String(p?.id || '').trim();
  if (!id) return;
  const next = window.prompt('输入新的草稿名称', String(p?.editorMeta?.title || p?.title || ''));
  if (next == null) return;
  const title = String(next || '').trim();
  if (!title) return;
  try {
    let patched = null;
    try {
      const data = await apiGetProjectSource(id);
      const payload = data?.project || null;
      if (payload && typeof payload === 'object') {
        const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
        patched = { ...payload, meta: { ...meta, title } };
      }
    } catch {
      patched = null;
    }

    await apiUpdateProjectDraft(id, patched ? { title, project: patched } : { title });
    draftProjects.value = (draftProjects.value || []).map((it) =>
      String(it?.id || '') === id
        ? { ...it, title, editorMeta: { ...(it?.editorMeta || {}), title } }
        : it
    );
  } catch (e) {
    alert(e?.message || '重命名失败');
  }
};

const duplicateDraft = async (p) => {
  if (!isSelf.value) return;
  const id = String(p?.id || '').trim();
  if (!id) return;
  try {
    const data = await apiGetProjectSource(id);
    const payload = data?.project || null;
    if (!payload) throw new Error('草稿内容为空');
    const baseTitle = String(p?.editorMeta?.title || p?.title || '未命名草稿').trim() || '未命名草稿';
    const newTitle = `${baseTitle}（副本）`;
    const newLocalId = `proj_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
    const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
    const nextPayload = { ...payload, meta: { ...meta, id: newLocalId, title: newTitle } };
    const created = await apiCreateProjectDraft({ project: nextPayload, title: newTitle });
    if (created) {
      const next = {
        ...created,
        editorMeta: { id: newLocalId, title: newTitle },
      };
      draftProjects.value = [next, ...(draftProjects.value || [])];
    }
  } catch (e) {
    alert(e?.message || '复制失败');
  }
};

const openPost = (p) => {
  const id = String(p?.id || '').trim();
  if (!id) return;
  router.push({ name: 'PostDetail', params: { id } });
};

const prefetchProject = async (p) => {
  try {
    const id = String(p?.id || '').trim();
    if (!id) return;
    const base = `/api/projects/${encodeURIComponent(id)}`;
    await fetchCached(`api:${base}`, async () => {
      const res = await authFetch(base);
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return data;
    }, { ttlMs: 30_000, staleWhileRevalidate: true });

    const commentsUrl = `${base}/comments?limit=50`;
    await fetchCached(`api:${commentsUrl}`, async () => {
      const res = await authFetch(commentsUrl);
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return Array.isArray(data) ? data : [];
    }, { ttlMs: 20_000, staleWhileRevalidate: true });
  } catch {
    // ignore
  }
};

const prefetchPost = async (p) => {
  try {
    const id = String(p?.id || '').trim();
    if (!id) return;
    const base = `/api/posts/${encodeURIComponent(id)}`;
    await fetchCached(`api:${base}`, async () => {
      const res = await authFetch(base);
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return data;
    }, { ttlMs: 30_000, staleWhileRevalidate: true });

    const commentsUrl = `${base}/comments?limit=50`;
    await fetchCached(`api:${commentsUrl}`, async () => {
      const res = await authFetch(commentsUrl);
      const data = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error(data?.message || '加载失败');
      return Array.isArray(data) ? data : [];
    }, { ttlMs: 20_000, staleWhileRevalidate: true });
  } catch {
    // ignore
  }
};

const deletePost = async (p) => {
  if (!isSelf.value) return;
  const id = String(p?.id || '').trim();
  if (!id) return;
  if (!window.confirm('确定删除该动态吗？')) return;
  try {
    const res = await authFetch(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = res.ok ? await res.json() : null;
    if (!res.ok) throw new Error(data?.message || '删除失败');
    posts.value = (posts.value || []).filter((it) => String(it?.id || '') !== id);
  } catch (e) {
    alert(e?.message || '删除失败');
  }
};

watch(
  () => user.value?.uid,
  () => {
    fetchRelationship();
    fetchDraftProjects();
  }
);

watch(
  () => route.params.id,
  () => fetchAll(),
  { immediate: true }
);

watch(
  () => route.query?.tab,
  () => {
    followSearch.value = '';
    fetchFollowList();
  }
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
        <div class="glass-card rounded-3xl border border-white/70 overflow-hidden">
          <div class="h-32 sm:h-40 relative" :style="userCoverStyle(profile?.cover)">
            <div class="absolute inset-0 bg-white/10"></div>
          </div>
          <div class="p-6 grid grid-cols-1 lg:grid-cols-[1.3fr,1fr] gap-6">
            <div class="flex items-start gap-4 min-w-0">
              <div class="w-16 h-16 rounded-full bg-white/80 border border-white/70 overflow-hidden shrink-0">
                <img v-if="profile?.avatar" :src="profile.avatar" class="w-full h-full object-cover" />
                <div
                  v-else
                  class="w-full h-full bg-gradient-to-tr from-teal-400 to-amber-400 flex items-center justify-center text-white text-2xl font-extrabold"
                >
                  {{ profile?.username?.charAt(0)?.toUpperCase() || 'U' }}
                </div>
              </div>
              <div class="min-w-0">
                <div class="text-2xl font-extrabold text-slate-900 truncate">{{ profile?.username || '用户' }}</div>
                <div class="text-sm text-slate-600 mt-1 clamp-2">{{ profile?.bio || '这个人很神秘，什么都没写。' }}</div>
                <div class="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded-full bg-white/70 border border-white/70 hover:border-teal-200/70 hover:bg-white/80 transition"
                    @click="router.push({ name: 'UserSpace', params: { id: userId }, query: { tab: 'following' } })"
                  >
                    关注 {{ profile?.followingCount ?? 0 }}
                  </button>
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded-full bg-white/70 border border-white/70 hover:border-teal-200/70 hover:bg-white/80 transition"
                    @click="router.push({ name: 'UserSpace', params: { id: userId }, query: { tab: 'followers' } })"
                  >
                    粉丝 {{ profile?.followerCount ?? 0 }}
                  </button>
                </div>
              </div>
            </div>

            <div class="space-y-4">
              <div class="flex items-center gap-2 justify-start lg:justify-end">
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
              <div class="grid grid-cols-2 gap-3">
                <div v-for="stat in profileStats" :key="stat.label" class="rounded-2xl bg-white/75 border border-white/70 p-3">
                  <div class="text-lg font-extrabold text-slate-900">{{ stat.value }}</div>
                  <div class="text-[11px] text-slate-500 font-semibold">{{ stat.label }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="isFollowPage" class="glass-card rounded-2xl border border-white/70 overflow-hidden">
          <div class="px-4 sm:px-6 py-4 border-b border-slate-200/70 bg-white/40 flex items-center justify-between">
            <div class="text-sm font-extrabold text-slate-900">{{ followTitle }}</div>
            <div class="text-xs text-slate-500 font-semibold">共 {{ followCount }} 人</div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-[220px,1fr] gap-0">
            <div class="border-r border-slate-200/70 bg-white/30 p-4 space-y-2">
              <button
                type="button"
                class="w-full text-left px-3 py-2 rounded-xl text-sm font-semibold transition"
                :class="followTab === 'following' ? 'bg-teal-500/15 text-teal-700 border border-teal-200/70' : 'hover:bg-white/60 text-slate-700'"
                @click="router.push({ name: 'UserSpace', params: { id: userId }, query: { tab: 'following' } })"
              >
                全部关注 <span class="float-right text-xs">{{ profile?.followingCount ?? 0 }}</span>
              </button>
              <button
                type="button"
                class="w-full text-left px-3 py-2 rounded-xl text-sm font-semibold transition"
                :class="followTab === 'followers' ? 'bg-teal-500/15 text-teal-700 border border-teal-200/70' : 'hover:bg-white/60 text-slate-700'"
                @click="router.push({ name: 'UserSpace', params: { id: userId }, query: { tab: 'followers' } })"
              >
                我的粉丝 <span class="float-right text-xs">{{ profile?.followerCount ?? 0 }}</span>
              </button>
            </div>

            <div class="p-6">
              <div class="flex items-center justify-between gap-3 mb-4">
                <div class="text-sm font-extrabold text-slate-900">全部{{ followTitle }}</div>
                <div class="relative">
                  <input
                    v-model="followSearch"
                    type="text"
                    placeholder="输入关键词"
                    class="input-glass rounded-xl px-3 py-2 text-xs w-52"
                  />
                </div>
              </div>

              <div v-if="isFollowLoading" class="space-y-3">
                <div v-for="n in 6" :key="n" class="h-16 rounded-2xl skeleton"></div>
              </div>

              <div v-else-if="followError" class="text-rose-600 text-sm font-semibold">
                {{ followError }}
              </div>

              <div v-else-if="filteredFollowList.length === 0" class="text-center text-slate-500 py-12">
                <div class="font-extrabold text-slate-900">暂无{{ followTitle }}</div>
                <div class="text-sm font-semibold mt-1">去社区看看更多用户</div>
              </div>

              <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  v-for="u in filteredFollowList"
                  :key="u.uid || u.id"
                  type="button"
                  class="glass-card rounded-2xl border border-white/70 p-4 text-left hover:shadow-lg transition"
                  @click="router.push({ name: 'UserSpace', params: { id: u.uid || u.id || u._id } })"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-white/65 border border-white/70 overflow-hidden shrink-0">
                      <img v-if="u.avatar" :src="u.avatar" class="w-full h-full object-cover" />
                      <div v-else class="w-full h-full bg-gradient-to-tr from-teal-400 to-amber-400 flex items-center justify-center text-white text-sm font-extrabold">
                        {{ String(u.username || 'U').charAt(0).toUpperCase() }}
                      </div>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-extrabold text-slate-900 truncate">{{ u.username || '用户' }}</div>
                      <div class="text-xs text-slate-600 mt-1 clamp-2">{{ u.bio || '这个人很神秘，什么都没写。' }}</div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="isSelf && !isFollowPage" class="space-y-6">
          <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
            <div class="px-4 sm:px-6 py-4 border-b border-slate-200/70 bg-white/40 flex items-center justify-between">
              <div class="text-sm font-extrabold text-slate-900">草稿工程</div>
              <div class="text-xs text-slate-500 font-semibold">共 {{ normalizedDrafts.length }} 个</div>
            </div>

            <div v-if="normalizedDrafts.length" class="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div
                v-for="p in normalizedDrafts"
                :key="String(p?.editorMeta?.id || p?.id || '')"
                role="button"
                tabindex="0"
                class="glass-card rounded-2xl border border-white/70 overflow-hidden text-left hover:shadow-lg transition relative cursor-pointer"
                @click="openDraft(p)"
                @keydown.enter="openDraft(p)"
                @keydown.space.prevent="openDraft(p)"
              >
                <div class="absolute top-2 right-2 z-10 flex items-center gap-2">
                  <button
                    type="button"
                    class="w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
                    @click.stop="renameDraft(p)"
                    aria-label="重命名草稿"
                  >
                    <i class="ph-bold ph-pencil"></i>
                  </button>
                  <button
                    type="button"
                    class="w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
                    @click.stop="duplicateDraft(p)"
                    aria-label="复制草稿"
                  >
                    <i class="ph-bold ph-copy"></i>
                  </button>
                  <button
                    type="button"
                    class="w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
                    @click.stop="deleteDraft(p)"
                    aria-label="删除草稿"
                  >
                    <i class="ph-bold ph-trash"></i>
                  </button>
                </div>
                <div class="h-32" :style="coverStyle(p.cover)"></div>
                <div class="p-4">
                  <div class="font-extrabold text-slate-900 truncate">{{ p.editorMeta?.title || p.title || '未命名草稿' }}</div>
                  <div class="mt-2 space-y-1 text-[11px] text-slate-500 font-semibold">
                    <div class="flex items-center justify-between gap-2">
                      <span>{{ p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '' }}</span>
                      <span class="inline-flex items-center gap-1"><i class="ph-bold ph-pencil"></i>最新状态</span>
                    </div>
                    <div class="font-mono truncate">工程名称：{{ p.editorMeta?.title || p.title || '未命名草稿' }}</div>
                    <div class="font-mono truncate">工程ID：{{ p.id }}</div>
                    <div v-if="p.editorMeta?.id" class="font-mono truncate">工程本地ID：{{ p.editorMeta.id }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="p-10 text-center text-slate-500">
              <div class="font-extrabold text-slate-900">暂无草稿</div>
              <div class="text-sm font-semibold mt-1">在编辑器中创建并自动保存草稿。</div>
            </div>
          </div>

          <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
            <div class="px-4 sm:px-6 py-4 border-b border-slate-200/70 bg-white/40 flex items-center justify-between">
              <div class="text-sm font-extrabold text-slate-900">作品</div>
              <div class="text-xs text-slate-500 font-semibold">共 {{ projects.length }} 个</div>
            </div>

            <div v-if="projects.length" class="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div
                v-for="p in projects"
                :key="p.id"
                role="button"
                tabindex="0"
                class="glass-card rounded-2xl border border-white/70 overflow-hidden text-left hover:shadow-lg transition relative cursor-pointer"
                @click="openProject(p)"
                @mouseenter="prefetchProject(p)"
                @keydown.enter="openProject(p)"
                @keydown.space.prevent="openProject(p)"
              >
                <button
                  v-if="isSelf"
                  type="button"
                  class="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
                  @click.stop="deleteProject(p)"
                  aria-label="删除作品"
                >
                  <i class="ph-bold ph-trash"></i>
                </button>
                <div class="h-32" :style="coverStyle(p.cover)"></div>
                <div class="p-4">
                  <div class="font-extrabold text-slate-900 truncate">{{ p.title || '未命名作品' }}</div>
                  <div class="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-semibold">
                    <span>{{ p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '' }}</span>
                    <span class="inline-flex items-center gap-1"><i class="ph-bold ph-heart"></i>{{ p.likesCount ?? 0 }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="p-10 text-center text-slate-500">
              <div class="font-extrabold text-slate-900">暂无作品</div>
              <div class="text-sm font-semibold mt-1">Ta 还没有发布作品。</div>
            </div>
          </div>
        </div>

        <div v-else class="glass-card rounded-2xl border border-white/70 overflow-hidden">
          <div class="px-4 sm:px-6 py-4 border-b border-slate-200/70 bg-white/40 flex items-center justify-between">
            <div class="text-sm font-extrabold text-slate-900">作品</div>
            <div class="text-xs text-slate-500 font-semibold">共 {{ projects.length }} 个</div>
          </div>

          <div v-if="projects.length" class="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              v-for="p in projects"
              :key="p.id"
              role="button"
              tabindex="0"
              class="glass-card rounded-2xl border border-white/70 overflow-hidden text-left hover:shadow-lg transition relative cursor-pointer"
              @click="openProject(p)"
              @mouseenter="prefetchProject(p)"
              @keydown.enter="openProject(p)"
              @keydown.space.prevent="openProject(p)"
            >
              <button
                v-if="isSelf"
                type="button"
                class="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
                @click.stop="deleteProject(p)"
                aria-label="删除作品"
              >
                <i class="ph-bold ph-trash"></i>
              </button>
              <div class="h-32" :style="coverStyle(p.cover)"></div>
              <div class="p-4">
                <div class="font-extrabold text-slate-900 truncate">{{ p.title || '未命名作品' }}</div>
                <div class="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-semibold">
                  <span>{{ p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '' }}</span>
                  <span class="inline-flex items-center gap-1"><i class="ph-bold ph-heart"></i>{{ p.likesCount ?? 0 }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="p-10 text-center text-slate-500">
            <div class="font-extrabold text-slate-900">暂无作品</div>
            <div class="text-sm font-semibold mt-1">Ta 还没有发布作品。</div>
          </div>
        </div>

        <div v-if="!isFollowPage" class="glass-card rounded-2xl border border-white/70 overflow-hidden">
          <div class="px-4 sm:px-6 py-4 border-b border-slate-200/70 bg-white/40 flex items-center justify-between">
            <div class="text-sm font-extrabold text-slate-900">动态</div>
            <div class="text-xs text-slate-500 font-semibold">共 {{ posts.length }} 条</div>
          </div>

          <div v-if="posts.length" class="divide-y divide-slate-200/70">
            <div
              v-for="p in posts"
              :key="p.id"
              class="p-5 flex items-start gap-4 hover:bg-white/35 transition"
              @mouseenter="prefetchPost(p)"
            >
              <div class="flex-1 min-w-0">
                <div class="text-xs text-slate-500 font-semibold">
                  {{ p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '' }}
                </div>
                <div v-if="p.content" class="mt-2 text-sm text-slate-800 whitespace-pre-wrap">
                  <MentionText :text="p.content" :highlight="user?.username || ''" />
                </div>
                <div v-if="p.images?.length" class="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                  <img
                    v-for="img in p.images.slice(0, 6)"
                    :key="img.url"
                    :src="img.url"
                    class="w-full h-20 rounded-xl object-cover border border-white/70 bg-white/50"
                    loading="lazy"
                  />
                </div>
                <div class="mt-3 flex items-center gap-2">
                  <UiButton variant="secondary" class="px-3 py-1.5 rounded-lg text-xs font-semibold" @click="openPost(p)">
                    查看详情
                  </UiButton>
                  <UiButton
                    v-if="isSelf"
                    variant="ghost"
                    class="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600"
                    @click="deletePost(p)"
                  >
                    删除
                  </UiButton>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="p-10 text-center text-slate-500">
            <div class="font-extrabold text-slate-900">暂无动态</div>
            <div class="text-sm font-semibold mt-1">Ta 还没有发布动态。</div>
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
