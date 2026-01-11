<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';
import MentionText from '../components/MentionText.vue';
import UserHoverCard from '../components/UserHoverCard.vue';

const route = useRoute();
const router = useRouter();
const { user } = useUser();

function startChat(targetUser) {
  if (!user.value) return router.push('/login');
  const peerId = targetUser?.uid;
  if (!peerId) return;
  if (String(peerId) === String(user.value.uid)) return;
  router.push({ name: 'Notifications', query: { tab: 'chat', peer: peerId } });
}

const projectId = computed(() => String(route.params.id || ''));

const project = ref(null);
const isProjectLoading = ref(true);
const projectError = ref('');

const comments = ref([]);
const isCommentsLoading = ref(true);
const newCommentContent = ref('');
const isSubmittingComment = ref(false);
const replyTarget = ref(null);
const commentInputRef = ref(null);
const highlightedCommentId = ref('');
let highlightTimer = null;

const nestedComments = computed(() => {
  const roots = [];
  const map = {};

  comments.value.forEach((comment) => {
    comment.children = [];
    map[comment.id] = comment;
  });

  comments.value.forEach((comment) => {
    if (comment.parentId && map[comment.parentId]) {
      map[comment.parentId].children.push(comment);
    } else {
      roots.push(comment);
    }
  });

  roots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return roots;
});

const commentsCountLabel = computed(() => {
  if (isCommentsLoading.value) return '…';
  return String(comments.value.length);
});

function coverFallback() {
  return 'linear-gradient(135deg,rgba(56,189,248,0.32),rgba(99,102,241,0.22))';
}

function focusCommentsInput() {
  commentInputRef.value?.focus?.();
}

async function scrollToComment(commentId) {
  const id = String(commentId || '');
  if (!id) return;

  await nextTick();
  const el = document.getElementById(`comment-${id}`);
  if (!el) return;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightedCommentId.value = id;
  if (highlightTimer) window.clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => {
    if (highlightedCommentId.value === id) highlightedCommentId.value = '';
  }, 1800);
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return '';
  }
}

function hydrateProjectMeta() {
  if (!project.value) return;
  project.value.likesCount = project.value.likesCount ?? (project.value.likes?.length || 0);
  project.value.isLiked = user.value ? (project.value.likes || []).includes(user.value.uid) : false;
}

function hydrateCommentsMeta(list) {
  return (list || []).map((c) => ({
    ...c,
    likesCount: c.likesCount || 0,
    isLiked: user.value ? (c.likes || []).includes(user.value.uid) : false,
  }));
}

async function fetchProject() {
  if (!projectId.value) {
    projectError.value = '缺少作品 ID';
    return;
  }

  isProjectLoading.value = true;
  projectError.value = '';
  project.value = null;

  try {
    const res = await authFetch(`/api/projects/${projectId.value}`);
    if (!res.ok) {
      projectError.value = res.status === 404 ? '作品不存在或已被屏蔽' : '加载作品失败，请稍后重试';
      return;
    }

    project.value = await res.json();

    hydrateProjectMeta();
  } catch (e) {
    projectError.value = '加载作品失败，请稍后重试';
  } finally {
    isProjectLoading.value = false;
  }
}

async function fetchComments() {
  if (!projectId.value) return;

  isCommentsLoading.value = true;
  try {
    const res = await authFetch(`/api/projects/${projectId.value}/comments`);
    const data = res.ok ? await res.json() : [];
    comments.value = hydrateCommentsMeta(Array.isArray(data) ? data : []);
  } catch (e) {
    comments.value = [];
  } finally {
    isCommentsLoading.value = false;
  }
}

async function toggleProjectLike() {
  if (!project.value) return;
  if (!user.value) return router.push('/login');

  const originalLiked = project.value.isLiked;
  const originalCount = project.value.likesCount || 0;

  project.value.isLiked = !originalLiked;
  project.value.likesCount = originalCount + (originalLiked ? -1 : 1);

  try {
    const res = await authFetch(`/api/projects/${projectId.value}/like`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (res.ok) {
      const data = await res.json();
      project.value.likesCount = data.likesCount;
      project.value.isLiked = data.isLiked;
    }
  } catch (e) {
    project.value.isLiked = originalLiked;
    project.value.likesCount = originalCount;
  }
}

async function toggleCommentLike(comment) {
  if (!user.value) return router.push('/login');

  const originalLiked = comment.isLiked;
  const originalCount = comment.likesCount || 0;

  comment.isLiked = !originalLiked;
  comment.likesCount = originalCount + (originalLiked ? -1 : 1);

  try {
    const res = await authFetch(`/api/comments/${comment.id}/like`, {
      method: 'POST',
      body: JSON.stringify({}),
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
}

function setReply(comment, rootCommentId) {
  if (!user.value) return router.push('/login');
  replyTarget.value = {
    id: comment.id,
    username: comment.author.username,
    parentId: rootCommentId || comment.id,
  };
}

function cancelReply() {
  replyTarget.value = null;
}

async function submitComment() {
  if (!newCommentContent.value.trim()) return;
  if (!user.value) return router.push('/login');

  isSubmittingComment.value = true;
  try {
    const payload = {
      content: newCommentContent.value,
      parentId: replyTarget.value ? replyTarget.value.parentId : null,
      replyToUserId: replyTarget.value
        ? comments.value.find((c) => c.id === replyTarget.value.id)?.author.uid
        : null,
    };

    const res = await authFetch(`/api/projects/${projectId.value}/comments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error('comment failed');
    const newComment = await res.json();
    comments.value.unshift({
      ...newComment,
      likes: [],
      likesCount: 0,
      isLiked: false,
    });
    newCommentContent.value = '';
    replyTarget.value = null;
  } catch (e) {
    alert('评论失败，请稍后重试');
  } finally {
    isSubmittingComment.value = false;
  }
}

onMounted(async () => {
  await Promise.all([fetchProject(), fetchComments()]);
});

watch(
  () => route.params.id,
  async () => {
    await Promise.all([fetchProject(), fetchComments()]);
  }
);

watch(
  () => user.value?.uid,
  () => {
    hydrateProjectMeta();
    comments.value = hydrateCommentsMeta(comments.value);
  }
);

watch(
  [() => route.query.comment, () => isCommentsLoading.value],
  async ([commentId, isLoadingNow]) => {
    if (isLoadingNow) return;
    if (!commentId) return;
    await scrollToComment(commentId);
  },
  { immediate: true }
);
</script>

<template>
  <div class="min-h-screen pt-24 pb-12 px-6">
    <div class="max-w-6xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <UiButton @click="router.back()" variant="ghost" class="px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
          <i class="ph-bold ph-arrow-left"></i>
          返回
        </UiButton>
        <span class="text-sm text-slate-500 font-semibold">作品详情</span>
      </div>

      <div v-if="isProjectLoading" class="glass-card rounded-2xl border border-white/70 overflow-hidden">
        <div class="h-56 skeleton"></div>
        <div class="p-6 space-y-3">
          <div class="h-7 w-2/3 rounded-lg skeleton"></div>
          <div class="h-4 w-1/3 rounded-lg skeleton"></div>
          <div class="h-4 w-1/2 rounded-lg skeleton"></div>
        </div>
      </div>

      <div v-else-if="projectError" class="glass-card rounded-2xl border border-white/70 p-8">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600">
            <i class="ph-bold ph-warning-circle text-2xl"></i>
          </div>
          <div class="flex-1">
            <div class="text-lg font-extrabold text-slate-900 mb-1">加载失败</div>
            <div class="text-slate-600 text-sm">{{ projectError }}</div>
            <div class="mt-5 flex gap-3">
              <UiButton @click="router.push('/explore')" variant="primary" class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center gap-2">
                <i class="ph-bold ph-compass"></i>
                返回探索
              </UiButton>
              <UiButton @click="fetchProject()" variant="secondary" class="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2">
                <i class="ph-bold ph-arrow-clockwise"></i>
                重试
              </UiButton>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="grid lg:grid-cols-[360px,1fr] gap-6">
        <aside class="space-y-6">
          <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
            <div class="h-48 relative" :style="{ background: project.cover || coverFallback() }">
              <div class="absolute inset-0 bg-white/10"></div>
              <div class="absolute inset-0 bg-gradient-to-b from-white/15 via-transparent to-white/55"></div>
              <div class="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
                <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full glass text-slate-700 text-xs font-semibold">
                  <i class="ph-fill ph-sparkle text-sky-600"></i>
                  <span>社区作品</span>
                </div>
                <div class="text-[11px] text-white/90 font-semibold drop-shadow">
                  {{ formatDate(project.createdAt) }}
                </div>
              </div>
            </div>

            <div class="p-6">
              <h1 class="text-2xl font-extrabold text-slate-900 leading-snug">
                {{ project.title }}
              </h1>

              <div class="flex items-center gap-2 mt-4">
                <UserHoverCard :user="project.author" class="shrink-0">
                  <img
                    v-if="project.author?.avatar"
                    :src="project.author.avatar"
                    @click="startChat(project.author)"
                    class="w-8 h-8 rounded-full object-cover border border-white/70 cursor-pointer hover:border-sky-200 transition"
                  />
                  <div
                    v-else
                    @click="startChat(project.author)"
                    class="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-xs text-white font-extrabold shadow-sm cursor-pointer hover:shadow-[0_18px_45px_-30px_rgba(2,132,199,0.7)] transition"
                  >
                    {{ project.author?.username?.charAt(0).toUpperCase() || 'U' }}
                  </div>
                </UserHoverCard>
                <div class="min-w-0">
                  <div class="text-sm font-extrabold text-slate-900 truncate cursor-pointer hover:text-sky-700 transition" @click="startChat(project.author)">
                    {{ project.author?.username || '匿名用户' }}
                  </div>
                  <div class="text-xs text-slate-500 font-semibold">创作者</div>
                </div>
              </div>

              <div v-if="project.tags?.length" class="mt-5 flex flex-wrap gap-2">
                <span
                  v-for="tag in project.tags"
                  :key="tag"
                  class="px-2.5 py-1 rounded-lg bg-white/55 border border-white/70 text-xs text-slate-700 font-semibold backdrop-blur-xl"
                >
                  {{ tag }}
                </span>
              </div>

              <div class="mt-6 grid grid-cols-2 gap-3">
                <div class="bg-white/55 border border-white/70 rounded-xl p-3 backdrop-blur-xl">
                  <div class="text-xs text-slate-500 font-semibold mb-1">点赞</div>
                  <div class="text-slate-900 font-extrabold text-lg leading-none">{{ project.likesCount || 0 }}</div>
                </div>
                <div class="bg-white/55 border border-white/70 rounded-xl p-3 backdrop-blur-xl">
                  <div class="text-xs text-slate-500 font-semibold mb-1">评论</div>
                  <div class="text-slate-900 font-extrabold text-lg leading-none">{{ commentsCountLabel }}</div>
                </div>
              </div>

              <div class="mt-6 flex gap-3">
                <UiButton
                  @click="toggleProjectLike"
                  variant="primary"
                  class="flex-1 px-4 py-3 rounded-xl text-sm font-extrabold text-white flex items-center justify-center gap-2"
                  :class="project.isLiked ? 'shadow-lg shadow-rose-500/20' : 'shadow-lg shadow-sky-500/20'"
                >
                  <i :class="project.isLiked ? 'ph-fill ph-heart' : 'ph-bold ph-heart'"></i>
                  {{ project.isLiked ? '已点赞' : '点赞' }}
                </UiButton>

                <UiButton
                  @click="focusCommentsInput"
                  variant="secondary"
                  class="px-4 py-3 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2"
                >
                  <i class="ph-bold ph-chat-circle"></i>
                  评论
                </UiButton>
              </div>
            </div>
          </div>

          <div class="glass-card rounded-2xl border border-white/70 p-6">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-700">
                <i class="ph-bold ph-info text-xl"></i>
              </div>
              <div class="flex-1">
                <div class="text-sm font-extrabold text-slate-900 mb-1">小提示</div>
                <div class="text-sm text-slate-600 leading-relaxed">
                  想要灵感？你可以先点个赞，再在评论区留下你的想法或建议。
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section class="glass-card rounded-2xl border border-white/70 overflow-hidden flex flex-col min-h-[560px]">
          <div class="p-6 border-b border-slate-200/70 bg-white/30">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="text-lg font-extrabold text-slate-900">评论区</h2>
                <p class="text-xs text-slate-500 font-semibold mt-1">分享你的感受，让作品更完整</p>
              </div>
              <div class="text-xs text-slate-500 font-semibold mt-1">{{ commentsCountLabel }} 条</div>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-6 space-y-6">
            <div v-if="isCommentsLoading" class="space-y-5">
              <div v-for="i in 6" :key="i" class="flex gap-3">
                <div class="w-9 h-9 rounded-full skeleton"></div>
                <div class="flex-1 space-y-2">
                  <div class="h-4 w-32 rounded-lg skeleton"></div>
                  <div class="h-4 w-2/3 rounded-lg skeleton"></div>
                  <div class="h-3 w-1/3 rounded-lg skeleton"></div>
                </div>
              </div>
            </div>

            <div v-else-if="comments.length === 0" class="text-center py-16 text-slate-500">
              <i class="ph-duotone ph-chat-circle-dots text-5xl mb-4 block mx-auto text-slate-400"></i>
              <div class="font-semibold">还没有评论</div>
              <div class="text-sm mt-1">成为第一个留言的人吧</div>
            </div>

            <div v-else class="space-y-6">
              <div
                v-for="rootComment in nestedComments"
                :key="rootComment.id"
                :id="`comment-${rootComment.id}`"
                class="group scroll-mt-24 rounded-2xl border border-transparent p-4 transition"
                :class="highlightedCommentId === rootComment.id ? 'bg-white/60 border-sky-200 ring-4 ring-sky-300/30 shadow-[0_20px_60px_-45px_rgba(2,132,199,0.8)]' : 'hover:bg-white/25'"
              >
                <div class="flex gap-3">
                  <UserHoverCard :user="rootComment.author" class="shrink-0">
                    <img
                      v-if="rootComment.author?.avatar"
                      :src="rootComment.author.avatar"
                      @click="startChat(rootComment.author)"
                      class="w-9 h-9 rounded-full object-cover border border-white/70 cursor-pointer hover:border-sky-200 transition"
                    />
                    <div
                      v-else
                      @click="startChat(rootComment.author)"
                      class="w-9 h-9 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-xs text-white font-bold shrink-0 shadow-sm cursor-pointer hover:shadow-[0_18px_45px_-30px_rgba(2,132,199,0.7)] transition"
                    >
                      {{ rootComment.author?.username?.charAt(0).toUpperCase() || 'U' }}
                    </div>
                  </UserHoverCard>

                  <div class="flex-1">
                    <div class="flex items-center gap-2">
                      <div class="text-sm font-extrabold text-slate-700 cursor-pointer hover:text-sky-700 transition" @click="startChat(rootComment.author)">
                        {{ rootComment.author?.username }}
                      </div>
                      <div class="text-[11px] text-slate-500 font-semibold">{{ formatDate(rootComment.createdAt) }}</div>
                    </div>

                    <p class="text-slate-700 text-sm leading-relaxed mt-1">
                      <MentionText :text="rootComment.content" :highlight="user?.username || ''" />
                    </p>

                    <div class="flex items-center gap-4 mt-3 text-xs text-slate-500">
                      <button
                        @click="toggleCommentLike(rootComment)"
                        class="flex items-center gap-1 transition font-semibold"
                        :class="rootComment.isLiked ? 'text-rose-600' : 'hover:text-rose-600'"
                      >
                        <i :class="rootComment.isLiked ? 'ph-fill ph-thumbs-up' : 'ph-bold ph-thumbs-up'"></i>
                        {{ rootComment.likesCount || '赞' }}
                      </button>

                      <button @click="setReply(rootComment, rootComment.id)" class="hover:text-sky-700 transition font-semibold">
                        回复
                      </button>
                    </div>
                  </div>
                </div>

                <div v-if="rootComment.children && rootComment.children.length > 0" class="ml-12 mt-4 space-y-4">
                  <div
                    v-for="child in rootComment.children"
                    :key="child.id"
                    :id="`comment-${child.id}`"
                    class="flex gap-2 scroll-mt-24 rounded-xl border border-transparent p-3 transition"
                    :class="highlightedCommentId === child.id ? 'bg-white/60 border-sky-200 ring-4 ring-sky-300/25 shadow-[0_18px_55px_-42px_rgba(2,132,199,0.75)]' : 'hover:bg-white/20'"
                  >
                    <UserHoverCard :user="child.author" class="shrink-0">
                      <img
                        v-if="child.author?.avatar"
                        :src="child.author.avatar"
                        @click="startChat(child.author)"
                        class="w-7 h-7 rounded-full object-cover border border-white/70 mt-0.5 cursor-pointer hover:border-sky-200 transition"
                      />
                      <div
                        v-else
                        @click="startChat(child.author)"
                        class="w-7 h-7 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-[10px] text-white font-bold shrink-0 mt-0.5 shadow-sm cursor-pointer hover:shadow-[0_18px_45px_-30px_rgba(2,132,199,0.7)] transition"
                      >
                        {{ child.author?.username?.charAt(0).toUpperCase() || 'U' }}
                      </div>
                    </UserHoverCard>

                    <div class="flex-1">
                      <div class="flex items-center gap-2">
                        <div class="text-xs font-extrabold text-slate-700 cursor-pointer hover:text-sky-700 transition" @click="startChat(child.author)">
                          {{ child.author?.username }}
                        </div>
                        <div class="text-[11px] text-slate-500 font-semibold">{{ formatDate(child.createdAt) }}</div>
                      </div>

                      <div class="text-sm leading-relaxed text-slate-700 mt-1">
                        <span v-if="child.replyToUser" class="text-slate-500 text-xs">
                          回复
                          <span class="text-sky-700 font-semibold hover:underline cursor-pointer" @click="startChat(child.replyToUser)">
                            @{{ child.replyToUser.username }}
                          </span>
                          :
                        </span>
                        <MentionText :text="child.content" :highlight="user?.username || ''" />
                      </div>

                      <div class="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        <button
                          @click="toggleCommentLike(child)"
                          class="flex items-center gap-1 transition font-semibold"
                          :class="child.isLiked ? 'text-rose-600' : 'hover:text-rose-600'"
                        >
                          <i :class="child.isLiked ? 'ph-fill ph-thumbs-up' : 'ph-bold ph-thumbs-up'"></i>
                          {{ child.likesCount || '赞' }}
                        </button>

                        <button @click="setReply(child, rootComment.id)" class="hover:text-sky-700 transition font-semibold">
                          回复
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="p-4 border-t border-slate-200/70 bg-white/30">
            <div
              v-if="replyTarget"
              class="flex items-center justify-between bg-white/55 px-3 py-1.5 rounded-lg mb-2 text-xs text-slate-700 border border-white/75 backdrop-blur-xl"
            >
              <span>
                正在回复 <span class="text-sky-700 font-extrabold">@{{ replyTarget.username }}</span>
              </span>
              <UiButton @click="cancelReply" variant="ghost" class="px-2 py-1 rounded">
                <i class="ph-bold ph-x"></i>
              </UiButton>
            </div>

            <div class="flex gap-2">
              <input
                id="comments-input"
                ref="commentInputRef"
                v-model="newCommentContent"
                @keyup.enter="submitComment"
                type="text"
                :placeholder="replyTarget ? `回复 @${replyTarget.username}...` : '发一条友善的评论...'"
                class="flex-1 input-glass rounded-lg px-4 py-2 text-sm"
              />
              <UiButton
                @click="submitComment"
                variant="primary"
                :disabled="isSubmittingComment || !newCommentContent"
                class="text-white px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
              >
                <i v-if="isSubmittingComment" class="ph-bold ph-spinner animate-spin"></i>
                发送
              </UiButton>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
