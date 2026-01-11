<script setup>
import { ref, onMounted, computed, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';
import MentionText from '../components/MentionText.vue';
import UserHoverCard from '../components/UserHoverCard.vue';
const router = useRouter();
const { user } = useUser();
const projects = ref([]);
const isLoading = ref(true);
const forkToast = ref('');
let forkTimer = null;

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
  try {
    const res = await authFetch('/api/projects');
    const data = await res.json();
    if (Array.isArray(data)) {
      projects.value = data.map(p => ({
        ...p,
        likesCount: p.likesCount || 0,
        // 判断是否点赞需要依赖 user.value.uid
        isLiked: user.value ? p.likes.includes(user.value.uid) : false
      }));
    }
  } catch (e) { console.error(e); } finally { isLoading.value = false; }
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

const forkProject = (project) => {
  forkToast.value = `已复制作品《${project.title}》`;
  if (forkTimer) window.clearTimeout(forkTimer);
  forkTimer = window.setTimeout(() => {
    forkToast.value = '';
  }, 1800);
};

const openComments = async (project) => {
  currentProject.value = project;
  showCommentModal.value = true;
  comments.value = [];
  replyTarget.value = null;
  newCommentContent.value = '';

  try {
    const res = await authFetch(`/api/projects/${project.id}/comments`);
    const data = await res.json();
    comments.value = data.map(c => ({
      ...c,
      likesCount: c.likesCount || 0,
      isLiked: user.value ? c.likes.includes(user.value.uid) : false
    }));
  } catch (e) { console.error(e); }
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

const submitComment = async () => {
  if (!newCommentContent.value.trim()) return;
  if (!user.value) return router.push('/login');

  isSubmittingComment.value = true;
  try {
    const payload = {
      content: newCommentContent.value,
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
    replyTarget.value = null;
  } catch (e) { alert('评论失败'); }
  finally { isSubmittingComment.value = false; }
};

onMounted(() => { fetchProjects(); });

onBeforeUnmount(() => {
  if (forkTimer) window.clearTimeout(forkTimer);
});
</script>

<template>
  <div class="min-h-screen pt-24 pb-12 px-6">
    <div
      v-if="forkToast"
      class="fixed top-24 right-6 z-[120] glass-card px-4 py-2 rounded-xl border border-white/70 text-sm font-semibold text-slate-800 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <i class="ph-bold ph-check-circle text-emerald-600"></i>
        {{ forkToast }}
      </div>
    </div>

    <div class="max-w-7xl mx-auto">
      <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div v-reveal>
          <h2 class="text-3xl font-extrabold text-slate-900 mb-2">探索社区</h2>
          <p class="text-slate-600">发现来自全球创作者的 AI 音乐作品</p>
        </div>
        <div v-reveal class="flex items-center gap-3">
          <UiButton @click="router.push('/studio')" variant="primary" class="text-white px-6 py-2 rounded-full font-semibold transition shadow-lg shadow-sky-500/20">+ 开始创作</UiButton>
        </div>
      </div>

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
          class="glass-card rounded-2xl overflow-hidden transition group flex flex-col cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300/40"
          @click="goToDetail(project)"
          @keydown.enter="goToDetail(project)"
          @keydown.space.prevent="goToDetail(project)"
        >
          <div class="h-48 relative" :style="{ background: project.cover || 'linear-gradient(135deg,rgba(56,189,248,0.28),rgba(99,102,241,0.22))' }">
            <div class="absolute inset-0 bg-white/10"></div>
            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition backdrop-blur-sm cursor-pointer">
              <div class="w-14 h-14 rounded-full bg-white/60 border border-white/75 backdrop-blur-xl flex items-center justify-center shadow-[0_18px_45px_-28px_rgba(2,132,199,0.6)]">
                <i class="ph-fill ph-play text-2xl text-slate-900 ml-0.5"></i>
              </div>
            </div>
          </div>
          <div class="p-5 flex-1 flex flex-col">
            <h3 class="font-bold text-lg text-slate-900 truncate mb-2">{{ project.title }}</h3>
            <button
              type="button"
              class="flex items-center gap-2 mb-4 text-left group/author"
              @click.stop="startChat(project.author)"
            >
              <UserHoverCard :user="project.author" class="shrink-0">
                <img
                  v-if="project.author.avatar"
                  :src="project.author.avatar"
                  class="w-6 h-6 rounded-full object-cover border border-white/70 group-hover/author:border-sky-200 transition"
                >
                <div
                  v-else
                  class="w-6 h-6 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-[10px] text-white font-bold shadow-sm group-hover/author:shadow-[0_18px_45px_-30px_rgba(2,132,199,0.7)] transition"
                >
                  {{ project.author.username.charAt(0).toUpperCase() }}
                </div>
              </UserHoverCard>
              <span class="text-sm text-slate-600 font-semibold group-hover/author:text-sky-700 transition">{{ project.author.username }}</span>
            </button>
            <div class="mt-auto pt-4 border-t border-slate-200/70 flex items-center justify-between">
              <div class="flex gap-4">
                <button @click.stop="toggleLike(project)" class="flex items-center gap-1 text-sm font-semibold transition" :class="project.isLiked ? 'text-rose-600' : 'text-slate-600 hover:text-rose-600'">
                  <i :class="project.isLiked ? 'ph-fill ph-heart' : 'ph-bold ph-heart'"></i> {{ project.likesCount }}
                </button>
                <button @click.stop="openComments(project)" class="flex items-center gap-1 text-slate-600 hover:text-sky-700 text-sm font-semibold transition">
                  <i class="ph-bold ph-chat-circle"></i> 评论
                </button>
                <button @click.stop="forkProject(project)" class="flex items-center gap-1 text-slate-600 hover:text-indigo-600 text-sm font-semibold transition">
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
                  class="w-9 h-9 rounded-full object-cover border border-white/70 cursor-pointer hover:border-sky-200 transition"
                  @click="startChat(rootComment.author)"
                >
                <div
                  v-else
                  class="w-9 h-9 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-xs text-white font-bold shrink-0 shadow-sm cursor-pointer hover:shadow-[0_18px_45px_-30px_rgba(2,132,199,0.7)] transition"
                  @click="startChat(rootComment.author)"
                >
                  {{ rootComment.author?.username?.charAt(0).toUpperCase() || 'U' }}
                </div>
              </UserHoverCard>

              <div class="flex-1">
                <div class="text-sm font-extrabold text-slate-700 mb-1 cursor-pointer hover:text-sky-700 transition" @click="startChat(rootComment.author)">
                  {{ rootComment.author?.username }}
                </div>
                <p class="text-slate-700 text-sm leading-relaxed">
                  <MentionText :text="rootComment.content" :highlight="user?.username || ''" />
                </p>

                <div class="flex items-center gap-4 mt-2 text-xs text-slate-500">
                  <span>{{ new Date(rootComment.createdAt).toLocaleDateString() }}</span>

                  <button @click="toggleCommentLike(rootComment)" class="flex items-center gap-1 transition" :class="rootComment.isLiked ? 'text-rose-600' : 'hover:text-rose-600'">
                    <i :class="rootComment.isLiked ? 'ph-fill ph-thumbs-up' : 'ph-bold ph-thumbs-up'"></i> {{ rootComment.likesCount || '赞' }}
                  </button>

                  <button @click="setReply(rootComment, rootComment.id)" class="hover:text-sky-700 transition font-semibold">回复</button>
                </div>
              </div>
            </div>

            <div v-if="rootComment.children && rootComment.children.length > 0" class="ml-12 mt-3 space-y-3">
              <div v-for="child in rootComment.children" :key="child.id" class="flex gap-2">
                <UserHoverCard :user="child.author" class="shrink-0">
                  <img
                    v-if="child.author?.avatar"
                    :src="child.author.avatar"
                    class="w-6 h-6 rounded-full object-cover border border-white/70 mt-1 cursor-pointer hover:border-sky-200 transition"
                    @click="startChat(child.author)"
                  >
                  <div
                    v-else
                    class="w-6 h-6 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-[10px] text-white font-bold shrink-0 mt-1 shadow-sm cursor-pointer hover:shadow-[0_18px_45px_-30px_rgba(2,132,199,0.7)] transition"
                    @click="startChat(child.author)"
                  >
                    {{ child.author?.username?.charAt(0).toUpperCase() || 'U' }}
                  </div>
                </UserHoverCard>

                <div class="flex-1">
                  <div class="text-sm leading-relaxed text-slate-700">
                    <span class="font-extrabold text-slate-700 text-xs cursor-pointer hover:text-sky-700 transition" @click="startChat(child.author)">
                      {{ child.author?.username }}
                    </span>

                    <span v-if="child.replyToUser" class="mx-1">
                        <span class="text-slate-500 text-xs">回复</span>
                        <span class="text-sky-700 text-xs cursor-pointer hover:underline" @click="startChat(child.replyToUser)">
                          @{{ child.replyToUser.username }}
                        </span>
                      </span>
                    <span class="text-slate-500 mx-0.5">:</span>

                    <MentionText :text="child.content" :highlight="user?.username || ''" />
                  </div>

                  <div class="flex items-center gap-4 mt-1.5 text-xs text-slate-500">
                    <span>{{ new Date(child.createdAt).toLocaleDateString() }}</span>

                    <button @click="toggleCommentLike(child)" class="flex items-center gap-1 transition" :class="child.isLiked ? 'text-rose-600' : 'hover:text-rose-600'">
                      <i :class="child.isLiked ? 'ph-fill ph-thumbs-up' : 'ph-bold ph-thumbs-up'"></i> {{ child.likesCount || '赞' }}
                    </button>

                    <button @click="setReply(child, rootComment.id)" class="hover:text-sky-700 transition font-semibold">回复</button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div class="p-4 border-t border-slate-200/70 bg-white/30">
          <div v-if="replyTarget" class="flex items-center justify-between bg-white/55 px-3 py-1.5 rounded-lg mb-2 text-xs text-slate-700 border border-white/75 backdrop-blur-xl">
            <span>正在回复 <span class="text-sky-700 font-extrabold">@{{ replyTarget.username }}</span></span>
            <UiButton @click="cancelReply" variant="ghost" class="px-2 py-1 rounded"><i class="ph-bold ph-x"></i></UiButton>
          </div>
          <div class="flex gap-2">
            <input v-model="newCommentContent" @keyup.enter="submitComment" type="text" :placeholder="replyTarget ? `回复 @${replyTarget.username}...` : '发一条友善的评论...'" class="flex-1 input-glass rounded-lg px-4 py-2 text-sm" />
            <UiButton @click="submitComment" variant="primary" :disabled="isSubmittingComment || !newCommentContent" class="text-white px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50">发送</UiButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
