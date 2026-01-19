<script setup>
import { ref, onMounted, computed, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';
import MentionText from '../components/MentionText.vue';
import UserHoverCard from '../components/UserHoverCard.vue';
import EmojiPicker from '../components/EmojiPicker.vue';
import { apiForkProject } from '../api/projects.js';
import { fetchCached, getCached, setCached } from '../utils/resourceCache.js';
import { notifyError } from '../utils/requestFeedback.js';
const router = useRouter();
const { user } = useUser();
const projects = ref([]);
const isLoading = ref(true);
const forkToast = ref('');
let forkTimer = null;

const highlightTags = ['AI 创作', 'Lo-fi', 'Synthwave', '人声', 'Remix', '协作'];
const communityStats = [
  { label: '今日上新', value: '32' },
  { label: '活跃协作', value: '18' },
  { label: '热门 Remix', value: '9' },
];

const projectTag = (project) => {
  const tags = Array.isArray(project?.tags) ? project.tags : [];
  if (tags.length) return String(tags[0] || '').trim() || 'AI 创作';
  return String(project?.genre || '').trim() || 'AI 创作';
};

const startChat = (targetUser) => {
  if (!user.value) return router.push('/login');
  const peerId = targetUser?.uid;
  if (!peerId) return;
  if (String(peerId) === String(user.value.uid)) return;
  router.push({ name: 'Notifications', query: { tab: 'chat', peer: peerId } });
};

// 评论状态
const showCommentModal = ref(false);
const currentProject = ref(null);
const comments = ref([]);
const newCommentContent = ref('');
const isSubmittingComment = ref(false);
const replyTarget = ref(null);
const commentInputEl = ref(null);
const commentImageInput = ref(null);
const pickedCommentImages = ref([]); // [{ file, previewUrl }]
const commentError = ref('');
const MAX_COMMENT_IMAGES = 6;

// 计算属性：扁平转嵌套
const nestedComments = computed(() => {
  const roots = [];
  const map = {};

  comments.value.forEach(c => {
    c.children = [];
    map[c.id] = c;
  });

  comments.value.forEach(c => {
    if (c.parentId && map[c.parentId]) {
      map[c.parentId].children.push(c);
    } else {
      roots.push(c);
    }
  });

  roots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return roots;
});

// 获取作品列表 (公开接口，可以使用 fetch 或 authFetch)
const fetchProjects = async () => {
  const cacheKey = 'api:/projects?limit=24';
  try {
    const data = await fetchCached(
      cacheKey,
      async () => {
        const res = await authFetch('/api/projects?limit=24');
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.message || '加载失败');
        return json;
      },
      { ttlMs: 60_000, staleWhileRevalidate: true }
    );
    if (Array.isArray(data)) {
      projects.value = data.map(p => ({
        ...p,
        likesCount: p.likesCount || 0,
        // 判断是否点赞需要依赖 user.value.uid
        isLiked: user.value ? p.likes.includes(user.value.uid) : false
      }));
    }
  } catch (e) {
    notifyError(e?.message || '加载失败');
  } finally { isLoading.value = false; }
};

// 作品点赞
const toggleLike = async (project) => {
  if (!user.value) return router.push('/login');
  const originalLiked = project.isLiked;
  const originalCount = project.likesCount;

  project.isLiked = !originalLiked;
  project.likesCount += originalLiked ? -1 : 1;

  try {
    // ✅ 使用 authFetch，移除 body 里的 userId
    const res = await authFetch(`/api/projects/${project.id}/like`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (res.ok) {
      const data = await res.json();
      project.likesCount = data.likesCount;
      project.isLiked = data.isLiked;
      try {
        const cached = getCached('api:/projects');
        if (Array.isArray(cached)) {
          const next = cached.map((p) =>
            String(p?.id) === String(project?.id)
              ? { ...p, likesCount: project.likesCount, isLiked: project.isLiked }
              : p
          );
          setCached('api:/projects', next, { ttlMs: 60_000 });
        }
      } catch {
        // ignore
      }
    }
  } catch (e) {
    project.isLiked = originalLiked;
    project.likesCount = originalCount;
  }
};

// 评论点赞
const toggleCommentLike = async (comment) => {
  if (!user.value) return router.push('/login');

  const originalLiked = comment.isLiked;
  const originalCount = comment.likesCount;

  comment.isLiked = !originalLiked;
  comment.likesCount += originalLiked ? -1 : 1;

  try {
    // ✅ 使用 authFetch，移除 body 里的 userId
    const res = await authFetch(`/api/comments/${comment.id}/like`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (res.ok) {
      const data = await res.json();
      comment.likesCount = data.likesCount;
      comment.isLiked = data.isLiked;
    }
  } catch (e) {
    comment.isLiked = originalLiked;
    comment.likesCount = originalCount;
  }
};

const goToDetail = (project) => {
  router.push({ name: 'ProjectDetail', params: { id: project.id } });
};

const prefetchProject = async (project) => {
  try {
    const id = String(project?.id || '').trim();
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
    // ignore prefetch errors
  }
};

const forkProject = (project) => {
  if (!user.value) return router.push('/login');
  const id = project?.id;
  if (!id) return;

  forkToast.value = 'Fork 中...';
  if (forkTimer) window.clearTimeout(forkTimer);

  apiForkProject(id)
    .then((data) => {
      const newId = String(data?.id || '').trim();
      forkToast.value = `已 Fork：${project.title}`;
      if (newId) router.push({ name: 'Studio', params: { projectId: newId } });
    })
    .catch((e) => {
      forkToast.value = e?.message || 'Fork 失败';
    })
    .finally(() => {
      forkTimer = window.setTimeout(() => {
        forkToast.value = '';
      }, 1800);
    });
};

const openComments = async (project) => {
  currentProject.value = project;
  showCommentModal.value = true;
  comments.value = [];
  replyTarget.value = null;
  newCommentContent.value = '';
  commentError.value = '';
  clearPickedCommentImages();

  try {
    const res = await authFetch(`/api/projects/${project.id}/comments`);
    const data = await res.json();
    comments.value = data.map(c => ({
      ...c,
      likesCount: c.likesCount || 0,
      isLiked: user.value ? c.likes.includes(user.value.uid) : false
    }));
  } catch (e) {
    notifyError(e?.message || '加载失败');
  }
};

const setReply = (comment, rootCommentId) => {
  if (!user.value) return router.push('/login');
  replyTarget.value = {
    id: comment.id,
    username: comment.author.username,
    parentId: rootCommentId || comment.id
  };
};

const cancelReply = () => { replyTarget.value = null; };

const resetCommentImageInput = () => {
  if (commentImageInput.value) commentImageInput.value.value = '';
};

const clearPickedCommentImages = () => {
  for (const it of pickedCommentImages.value || []) {
    if (it?.previewUrl) {
      try {
        URL.revokeObjectURL(it.previewUrl);
      } catch {
        // ignore
      }
    }
  }
  pickedCommentImages.value = [];
  resetCommentImageInput();
};

const removePickedCommentImage = (idx) => {
  const arr = [...(pickedCommentImages.value || [])];
  const it = arr[idx];
  if (it?.previewUrl) {
    try {
      URL.revokeObjectURL(it.previewUrl);
    } catch {
      // ignore
    }
  }
  arr.splice(idx, 1);
  pickedCommentImages.value = arr;
};

const triggerPickCommentImages = () => {
  if (commentImageInput.value) commentImageInput.value.click();
};

const handlePickCommentImages = (event) => {
  const files = Array.from(event?.target?.files || []);
  if (!files.length) return;
  const remaining = MAX_COMMENT_IMAGES - (pickedCommentImages.value?.length || 0);
  if (remaining <= 0) {
    commentError.value = `最多选择 ${MAX_COMMENT_IMAGES} 张图片`;
    resetCommentImageInput();
    return;
  }

  const valid = files.filter((f) => String(f?.type || '').startsWith('image/'));
  const picked = valid.slice(0, remaining).map((file) => ({
    file,
    previewUrl: URL.createObjectURL(file),
  }));

  pickedCommentImages.value = [...(pickedCommentImages.value || []), ...picked];
  if (valid.length > remaining) {
    commentError.value = `最多选择 ${MAX_COMMENT_IMAGES} 张图片`;
  } else {
    commentError.value = '';
  }
  resetCommentImageInput();
};

const submitComment = async () => {
  const content = newCommentContent.value.trim();
  const hasImages = Boolean(pickedCommentImages.value?.length);
  if (!content && !hasImages) return;
  if (!user.value) return router.push('/login');

  isSubmittingComment.value = true;
  commentError.value = '';
  try {
    let imageUrls = [];
    if (pickedCommentImages.value?.length) {
      const fd = new FormData();
      for (const it of pickedCommentImages.value) {
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

    const payload = {
      content,
      imageUrls,
      // ✅ 移除 userId，后端从 Token 获取
      parentId: replyTarget.value ? replyTarget.value.parentId : null,
      replyToUserId: replyTarget.value ?
          comments.value.find(c => c.id === replyTarget.value.id)?.author.uid : null
    };

    // ✅ 使用 authFetch
    const res = await authFetch(`/api/projects/${currentProject.value.id}/comments`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const newComment = await res.json();
    newComment.likes = [];
    newComment.likesCount = 0;
    newComment.isLiked = false;

    comments.value.push(newComment);
    newCommentContent.value = '';
    clearPickedCommentImages();
    replyTarget.value = null;
  } catch (e) {
    commentError.value = e?.message || '评论失败';
  }
  finally { isSubmittingComment.value = false; }
};

const deleteComment = async (comment) => {
  if (!user.value) return router.push('/login');
  if (!comment?.id) return;
  if (!window.confirm('确定删除该评论吗？该评论的回复也会被删除。')) return;
  try {
    const res = await authFetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
    const data = res.ok ? await res.json() : null;
    if (!res.ok) throw new Error(data?.message || '删除失败');

    const deletedIds = Array.isArray(data?.deletedIds) ? data.deletedIds : null;
    if (deletedIds?.length) {
      const set = new Set(deletedIds.map((x) => String(x)));
      comments.value = (comments.value || []).filter((c) => !set.has(String(c.id)));
    } else {
      const toRemove = new Set([String(comment.id)]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const c of comments.value || []) {
          if (c?.parentId && toRemove.has(String(c.parentId)) && !toRemove.has(String(c.id))) {
            toRemove.add(String(c.id));
            changed = true;
          }
        }
      }
      comments.value = (comments.value || []).filter((c) => !toRemove.has(String(c.id)));
    }
  } catch (e) {
    alert(e?.message || '删除失败');
  }
};

onMounted(() => { fetchProjects(); });

onBeforeUnmount(() => {
  if (forkTimer) window.clearTimeout(forkTimer);
  clearPickedCommentImages();
});
</script>

<template>
  <div class="page pb-12">
    <div
      v-if="forkToast"
      class="fixed top-20 right-4 sm:right-6 lg:right-8 z-[120] glass-card px-4 py-2 rounded-xl border border-white/70 text-sm font-semibold text-slate-800 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <i class="ph-bold ph-check-circle text-emerald-600"></i>
        {{ forkToast }}
      </div>
    </div>

    <div class="page-container">
      <section class="hero-surface px-6 sm:px-10 py-8 sm:py-10 mb-10">
        <div class="hero-grid"></div>
        <div class="grain-overlay"></div>
        <div class="relative z-10 grid grid-cols-1 lg:grid-cols-[1.2fr,1fr] gap-8 items-center">
          <div class="space-y-4" v-reveal>
            <div class="text-xs font-semibold text-slate-500">社区 / Explore</div>
            <h2 class="font-display text-3xl sm:text-4xl font-extrabold text-slate-900">探索社区创作</h2>
            <p class="text-slate-600">发现来自全球创作者的 AI 音乐作品与协作工程。</p>
            <div class="flex flex-wrap gap-2">
              <span v-for="tag in highlightTags" :key="tag" class="px-3 py-1 rounded-full bg-white/70 border border-white/70 text-xs font-semibold text-slate-600">
                {{ tag }}
              </span>
            </div>
            <div class="flex items-center gap-3">
              <UiButton @click="router.push('/studio')" variant="primary" class="text-white px-6 py-2 rounded-full font-semibold">
                + 开始创作
              </UiButton>
              <UiButton @click="router.push('/feed')" variant="secondary" class="px-6 py-2 rounded-full font-semibold">
                查看动态
              </UiButton>
            </div>
          </div>

          <div class="glass-card rounded-3xl border border-white/70 p-6" v-reveal>
            <div class="flex items-center justify-between">
              <div class="text-sm font-extrabold text-slate-900">今日社区</div>
              <div class="text-xs text-slate-500 font-semibold">实时更新</div>
            </div>
            <div class="mt-5 grid grid-cols-3 gap-3 text-center">
              <div v-for="stat in communityStats" :key="stat.label" class="rounded-2xl bg-white/70 border border-white/70 py-3">
                <div class="text-lg font-extrabold text-slate-900">{{ stat.value }}</div>
                <div class="text-[11px] text-slate-500 font-semibold">{{ stat.label }}</div>
              </div>
            </div>
            <div class="mt-6 rounded-2xl bg-white/70 border border-white/70 p-4">
              <div class="text-xs font-semibold text-slate-500">社区挑战</div>
              <div class="mt-2 text-sm font-extrabold text-slate-900">Waveform Collab</div>
              <div class="text-xs text-slate-600 mt-1">邀请 3 位创作者，完成 60 秒主题配乐。</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Skeleton Loading -->
      <div v-if="isLoading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div v-for="i in 6" :key="i" class="glass-card rounded-2xl overflow-hidden">
          <div class="h-48 skeleton"></div>
          <div class="p-5 space-y-4">
            <div class="h-5 w-3/4 rounded-lg skeleton"></div>
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-full skeleton"></div>
              <div class="h-4 w-24 rounded-md skeleton"></div>
            </div>
            <div class="h-px bg-slate-200/70"></div>
            <div class="flex gap-4">
              <div class="h-4 w-16 rounded-md skeleton"></div>
              <div class="h-4 w-16 rounded-md skeleton"></div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div
          v-for="project in projects"
          :key="project.id"
          v-reveal
          role="link"
          tabindex="0"
          :aria-label="`查看作品详情：${project.title}`"
          class="glass-card rounded-3xl overflow-hidden transition group flex flex-col cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-300/40"
          @click="goToDetail(project)"
          @mouseenter="prefetchProject(project)"
          @keydown.enter="goToDetail(project)"
          @keydown.space.prevent="goToDetail(project)"
        >
          <div class="h-48 relative" :style="{ background: project.cover || 'linear-gradient(135deg,rgba(34,199,184,0.2),rgba(245,178,74,0.24))' }">
            <div class="absolute inset-0 bg-white/10"></div>
            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition backdrop-blur-sm cursor-pointer">
              <div class="w-14 h-14 rounded-full bg-white/70 border border-white/75 backdrop-blur-xl flex items-center justify-center shadow-[0_18px_45px_-28px_rgba(17,20,24,0.35)]">
                <i class="ph-fill ph-play text-2xl text-slate-900 ml-0.5"></i>
              </div>
            </div>
          </div>
          <div class="p-5 flex-1 flex flex-col">
            <h3 class="font-bold text-lg text-slate-900 truncate">{{ project.title }}</h3>
            <div class="mt-2">
              <span class="px-2.5 py-1 rounded-full bg-white/70 border border-white/70 text-[11px] font-semibold text-slate-600">
                {{ projectTag(project) }}
              </span>
            </div>
            <button
              type="button"
              class="flex items-center gap-2 mt-3 mb-4 text-left group/author"
              @click.stop="startChat(project.author)"
            >
              <UserHoverCard :user="project.author" class="shrink-0">
                <img
                  v-if="project.author.avatar"
                  :src="project.author.avatar"
                  class="w-6 h-6 rounded-full object-cover border border-white/70 group-hover/author:border-teal-200 transition"
                >
                <div
                  v-else
                  class="w-6 h-6 rounded-full bg-gradient-to-tr from-teal-400 to-amber-400 flex items-center justify-center text-[10px] text-white font-bold shadow-sm group-hover/author:shadow-[0_18px_45px_-30px_rgba(17,20,24,0.35)] transition"
                >
                  {{ project.author.username.charAt(0).toUpperCase() }}
                </div>
              </UserHoverCard>
              <span class="text-sm text-slate-600 font-semibold group-hover/author:text-teal-700 transition">{{ project.author.username }}</span>
            </button>
            <div class="mt-auto pt-4 border-t border-slate-200/70 flex items-center justify-between">
              <div class="flex gap-4">
                <button @click.stop="toggleLike(project)" class="flex items-center gap-1 text-sm font-semibold transition" :class="project.isLiked ? 'text-rose-600' : 'text-slate-600 hover:text-rose-600'">
                  <i :class="project.isLiked ? 'ph-fill ph-heart' : 'ph-bold ph-heart'"></i> {{ project.likesCount }}
                </button>
                <button @click.stop="openComments(project)" class="flex items-center gap-1 text-slate-600 hover:text-teal-700 text-sm font-semibold transition">
                  <i class="ph-bold ph-chat-circle"></i> 评论
                </button>
                <button @click.stop="forkProject(project)" class="flex items-center gap-1 text-slate-600 hover:text-amber-600 text-sm font-semibold transition">
                  <i class="ph-bold ph-git-fork"></i> Fork
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showCommentModal" class="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div class="absolute inset-0 bg-slate-900/35 backdrop-blur-sm" @click="showCommentModal = false"></div>
      <div class="glass-card w-full max-w-lg rounded-2xl border border-white/70 shadow-2xl relative z-10 flex flex-col max-h-[80vh]">

        <div class="p-4 border-b border-slate-200/70 flex justify-between items-center">
          <h3 class="text-lg font-extrabold text-slate-900">评论 ({{ currentProject?.title }})</h3>
          <UiButton @click="showCommentModal = false" variant="ghost" class="px-2 py-2 rounded-lg"><i class="ph-bold ph-x text-xl"></i></UiButton>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-6 min-h-[300px]">
          <div v-if="comments.length === 0" class="text-center text-slate-500 py-10">暂无评论</div>

          <div v-for="rootComment in nestedComments" :key="rootComment.id" class="group">
            <div class="flex gap-3">
              <UserHoverCard :user="rootComment.author" class="shrink-0">
                <img
                  v-if="rootComment.author?.avatar"
                  :src="rootComment.author.avatar"
                  class="w-9 h-9 rounded-full object-cover border border-white/70 cursor-pointer hover:border-teal-200 transition"
                  @click="startChat(rootComment.author)"
                >
                <div
                  v-else
                  class="w-9 h-9 rounded-full bg-gradient-to-tr from-teal-400 to-amber-400 flex items-center justify-center text-xs text-white font-bold shrink-0 shadow-sm cursor-pointer hover:shadow-[0_18px_45px_-30px_rgba(17,20,24,0.35)] transition"
                  @click="startChat(rootComment.author)"
                >
                  {{ rootComment.author?.username?.charAt(0).toUpperCase() || 'U' }}
                </div>
              </UserHoverCard>

              <div class="flex-1">
                <div class="text-sm font-extrabold text-slate-700 mb-1 cursor-pointer hover:text-teal-700 transition" @click="startChat(rootComment.author)">
                  {{ rootComment.author?.username }}
                </div>
                <div class="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap break-words">
                  <MentionText :text="rootComment.content" :highlight="user?.username || ''" />
                </div>

                <div v-if="rootComment.images?.length" class="mt-2 grid grid-cols-3 gap-2">
                  <img
                    v-for="img in rootComment.images"
                    :key="img.url || img"
                    :src="img.url || img"
                    class="w-full h-20 rounded-xl object-cover border border-white/70 bg-white/50"
                    loading="lazy"
                  />
                </div>

                <div class="flex items-center gap-4 mt-2 text-xs text-slate-500">
                  <span>{{ new Date(rootComment.createdAt).toLocaleDateString() }}</span>

                  <button @click="toggleCommentLike(rootComment)" class="flex items-center gap-1 transition" :class="rootComment.isLiked ? 'text-rose-600' : 'hover:text-rose-600'">
                    <i :class="rootComment.isLiked ? 'ph-fill ph-thumbs-up' : 'ph-bold ph-thumbs-up'"></i> {{ rootComment.likesCount || '赞' }}
                  </button>

                  <button @click="setReply(rootComment, rootComment.id)" class="hover:text-teal-700 transition font-semibold">回复</button>

                  <button
                    v-if="user?.uid && rootComment.author?.uid === user.uid"
                    @click="deleteComment(rootComment)"
                    class="hover:text-rose-600 transition font-semibold"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>

            <div v-if="rootComment.children && rootComment.children.length > 0" class="ml-12 mt-3 space-y-3">
              <div v-for="child in rootComment.children" :key="child.id" class="flex gap-2">
                <UserHoverCard :user="child.author" class="shrink-0">
                  <img
                    v-if="child.author?.avatar"
                    :src="child.author.avatar"
                    class="w-6 h-6 rounded-full object-cover border border-white/70 mt-1 cursor-pointer hover:border-teal-200 transition"
                    @click="startChat(child.author)"
                  >
                  <div
                    v-else
                    class="w-6 h-6 rounded-full bg-gradient-to-tr from-teal-400 to-amber-400 flex items-center justify-center text-[10px] text-white font-bold shrink-0 mt-1 shadow-sm cursor-pointer hover:shadow-[0_18px_45px_-30px_rgba(17,20,24,0.35)] transition"
                    @click="startChat(child.author)"
                  >
                    {{ child.author?.username?.charAt(0).toUpperCase() || 'U' }}
                  </div>
                </UserHoverCard>

                <div class="flex-1">
                  <div class="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                    <span class="font-extrabold text-slate-700 text-xs cursor-pointer hover:text-teal-700 transition" @click="startChat(child.author)">
                      {{ child.author?.username }}
                    </span>

                    <span v-if="child.replyToUser" class="mx-1">
                        <span class="text-slate-500 text-xs">回复</span>
                        <span class="text-teal-700 text-xs cursor-pointer hover:underline" @click="startChat(child.replyToUser)">
                          @{{ child.replyToUser.username }}
                        </span>
                      </span>
                    <span class="text-slate-500 mx-0.5">:</span>

                    <MentionText :text="child.content" :highlight="user?.username || ''" />
                  </div>

                  <div v-if="child.images?.length" class="mt-2 grid grid-cols-3 gap-2">
                    <img
                      v-for="img in child.images"
                      :key="img.url || img"
                      :src="img.url || img"
                      class="w-full h-16 rounded-xl object-cover border border-white/70 bg-white/50"
                      loading="lazy"
                    />
                  </div>

                  <div class="flex items-center gap-4 mt-1.5 text-xs text-slate-500">
                    <span>{{ new Date(child.createdAt).toLocaleDateString() }}</span>

                    <button @click="toggleCommentLike(child)" class="flex items-center gap-1 transition" :class="child.isLiked ? 'text-rose-600' : 'hover:text-rose-600'">
                      <i :class="child.isLiked ? 'ph-fill ph-thumbs-up' : 'ph-bold ph-thumbs-up'"></i> {{ child.likesCount || '赞' }}
                    </button>

                    <button @click="setReply(child, rootComment.id)" class="hover:text-teal-700 transition font-semibold">回复</button>

                    <button
                      v-if="user?.uid && child.author?.uid === user.uid"
                      @click="deleteComment(child)"
                      class="hover:text-rose-600 transition font-semibold"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div class="p-4 border-t border-slate-200/70 bg-white/30">
          <div v-if="replyTarget" class="flex items-center justify-between bg-white/55 px-3 py-1.5 rounded-lg mb-2 text-xs text-slate-700 border border-white/75 backdrop-blur-xl">
            <span>正在回复 <span class="text-teal-700 font-extrabold">@{{ replyTarget.username }}</span></span>
            <UiButton @click="cancelReply" variant="ghost" class="px-2 py-1 rounded"><i class="ph-bold ph-x"></i></UiButton>
          </div>
          <div class="flex gap-2 items-center">
            <EmojiPicker v-model="newCommentContent" :target="commentInputEl" :disabled="isSubmittingComment" size="sm" />
            <input ref="commentImageInput" type="file" accept="image/*" multiple class="hidden" @change="handlePickCommentImages" />
            <input
              ref="commentInputEl"
              v-model="newCommentContent"
              @keyup.enter="submitComment"
              type="text"
              :placeholder="replyTarget ? `回复 @${replyTarget.username}...` : '发一条友善的评论...'"
              class="flex-1 input-glass rounded-xl px-4 py-2 text-sm"
            />
            <UiButton
              variant="secondary"
              class="px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-2"
              :disabled="isSubmittingComment || pickedCommentImages.length >= MAX_COMMENT_IMAGES"
              @click="triggerPickCommentImages"
            >
              <i class="ph-bold ph-image"></i>
              图片
            </UiButton>
            <UiButton
              @click="submitComment"
              variant="primary"
              :disabled="isSubmittingComment || (!newCommentContent.trim() && !pickedCommentImages.length)"
              class="text-white px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
            >
              发送
            </UiButton>
          </div>

          <div v-if="pickedCommentImages.length" class="mt-3 grid grid-cols-3 gap-2">
            <div
              v-for="(it, idx) in pickedCommentImages"
              :key="it.previewUrl"
              class="relative rounded-xl overflow-hidden border border-white/70 bg-white/50"
            >
              <img :src="it.previewUrl" class="w-full h-20 object-cover" />
              <button
                type="button"
                class="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center"
                @click.stop="removePickedCommentImage(idx)"
                aria-label="删除图片"
              >
                <i class="ph-bold ph-x"></i>
              </button>
            </div>
          </div>

          <div v-if="commentError" class="mt-2 text-xs font-semibold text-rose-600">
            {{ commentError }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
