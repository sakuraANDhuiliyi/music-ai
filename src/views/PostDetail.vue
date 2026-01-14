<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';
import EmojiPicker from '../components/EmojiPicker.vue';
import MentionText from '../components/MentionText.vue';

const route = useRoute();
const router = useRouter();
const { user, isAuthReady } = useUser();

const postId = computed(() => String(route.params.id || '').trim());

const post = ref(null);
const isLoading = ref(true);
const errorMsg = ref('');

const comments = ref([]);
const isCommentsLoading = ref(false);
const commentDraft = ref('');
const commentInputEl = ref(null);
const isSubmitting = ref(false);
const replyState = ref({ parentId: '', replyToUserId: '', replyToName: '' });

const ensureAuth = () => {
  if (!isAuthReady.value) return false;
  if (user.value) return true;
  router.push('/login');
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

const fetchPost = async () => {
  if (!postId.value) return;
  const res = await authFetch(`/api/posts/${encodeURIComponent(postId.value)}`);
  const data = res.ok ? await res.json() : null;
  if (!res.ok) throw new Error(data?.message || '加载失败');
  post.value = data;
};

const fetchComments = async () => {
  if (!postId.value) return;
  isCommentsLoading.value = true;
  try {
    const res = await authFetch(`/api/posts/${encodeURIComponent(postId.value)}/comments`);
    const data = res.ok ? await res.json() : null;
    if (!res.ok) throw new Error(data?.message || '加载评论失败');
    comments.value = Array.isArray(data) ? data : [];
  } catch (e) {
    // keep page usable even if comments fail
    console.error(e);
    comments.value = [];
  } finally {
    isCommentsLoading.value = false;
  }
};

const fetchAll = async () => {
  isLoading.value = true;
  errorMsg.value = '';
  post.value = null;
  try {
    await fetchPost();
    await fetchComments();
  } catch (e) {
    errorMsg.value = e?.message || '加载失败';
  } finally {
    isLoading.value = false;
  }
};

const openUser = (uid) => {
  const id = String(uid || '').trim();
  if (!id) return;
  router.push({ name: 'UserSpace', params: { id } });
};

const openProject = () => {
  const pid = post.value?.project?.id || post.value?.project?._id || post.value?.project;
  if (!pid) return;
  router.push({ name: 'ProjectDetail', params: { id: pid } });
};

const beginReply = (c) => {
  if (!ensureAuth()) return;
  const parentId = String(c?.parentId || c?.id || '').trim();
  const replyToUserId = String(c?.author?.uid || c?.author?.id || c?.author?._id || '').trim();
  replyState.value = {
    parentId: parentId || '',
    replyToUserId: replyToUserId || '',
    replyToName: String(c?.author?.username || '').trim(),
  };
};

const cancelReply = () => {
  replyState.value = { parentId: '', replyToUserId: '', replyToName: '' };
};

const submitComment = async () => {
  if (!ensureAuth()) return;
  const content = commentDraft.value.trim();
  if (!content) return;

  isSubmitting.value = true;
  try {
    const body = {
      content,
      ...(replyState.value.parentId ? { parentId: replyState.value.parentId } : {}),
      ...(replyState.value.replyToUserId ? { replyToUserId: replyState.value.replyToUserId } : {}),
    };
    const res = await authFetch(`/api/posts/${encodeURIComponent(postId.value)}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = res.ok ? await res.json() : null;
    if (!res.ok) throw new Error(data?.message || '评论失败');
    commentDraft.value = '';
    cancelReply();
    await fetchComments();
  } catch (e) {
    alert(e?.message || '评论失败');
  } finally {
    isSubmitting.value = false;
  }
};

const topLevel = computed(() => (comments.value || []).filter((c) => !c.parentId));
const repliesByParent = computed(() => {
  const map = new Map();
  for (const c of comments.value || []) {
    if (!c?.parentId) continue;
    const pid = String(c.parentId);
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid).push(c);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
  return map;
});

watch(
  () => route.params.id,
  () => fetchAll(),
  { immediate: true }
);

onMounted(() => {
  if (postId.value) fetchAll();
});
</script>

<template>
  <div class="page pb-12">
    <div class="page-container max-w-4xl">
      <div class="flex items-center gap-3 mb-6">
        <UiButton @click="router.back()" variant="ghost" class="px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
          <i class="ph-bold ph-arrow-left"></i>
          返回
        </UiButton>
        <span class="text-sm text-slate-500 font-semibold">帖子详情</span>
      </div>

      <div v-if="isLoading" class="glass-card rounded-2xl border border-white/70 p-6">
        <div class="h-5 w-1/3 rounded-lg skeleton"></div>
        <div class="mt-3 h-4 w-2/3 rounded-lg skeleton"></div>
        <div class="mt-3 h-40 rounded-2xl skeleton"></div>
      </div>

      <div v-else-if="errorMsg" class="glass-card rounded-2xl border border-white/70 p-8">
        <div class="text-lg font-extrabold text-slate-900 mb-1">加载失败</div>
        <div class="text-slate-600 text-sm">{{ errorMsg }}</div>
        <div class="mt-5 flex gap-3">
          <UiButton @click="fetchAll" variant="secondary" class="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2">
            <i class="ph-bold ph-arrow-clockwise"></i>
            重试
          </UiButton>
        </div>
      </div>

      <div v-else class="space-y-6">
        <div class="glass-card rounded-2xl border border-white/70 p-6">
          <div class="flex items-start gap-4">
            <button type="button" class="shrink-0" @click="openUser(post?.author?.uid || post?.author?.id || post?.author?._id)">
              <img
                v-if="post?.author?.avatar"
                :src="post.author.avatar"
                class="w-11 h-11 rounded-full object-cover border border-white/70"
              />
              <div
                v-else
                class="w-11 h-11 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white text-sm font-extrabold border border-white/70"
              >
                {{ post?.author?.username?.charAt(0)?.toUpperCase() || 'U' }}
              </div>
            </button>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="text-sm font-extrabold text-slate-900 truncate hover:text-sky-700 transition"
                  @click="openUser(post?.author?.uid || post?.author?.id || post?.author?._id)"
                >
                  {{ post?.author?.username || '用户' }}
                </button>
                <div class="text-[11px] text-slate-500 font-semibold">{{ timeAgo(post?.createdAt) }}</div>
              </div>

              <div v-if="post?.content" class="mt-2 text-slate-800 text-sm whitespace-pre-wrap">
                <MentionText :text="post.content" :highlight="user?.username || ''" />
              </div>

              <div v-if="post?.images?.length" class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                <img
                  v-for="img in post.images.slice(0, 6)"
                  :key="img.url"
                  :src="img.url"
                  class="w-full h-40 rounded-2xl object-cover border border-white/70 bg-white/50"
                  loading="lazy"
                />
              </div>

              <div v-if="post?.project" class="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-white/55 border border-white/70 p-4">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-12 h-9 rounded-xl bg-white/60 border border-white/70 shrink-0" :style="{ background: post.project.cover || '' }"></div>
                  <div class="min-w-0">
                    <div class="text-xs text-slate-500 font-semibold">分享作品</div>
                    <div class="text-sm font-extrabold text-slate-900 truncate">{{ post.project.title || '未命名作品' }}</div>
                  </div>
                </div>
                <UiButton variant="primary" class="px-4 py-2 rounded-xl text-sm font-semibold text-white" @click="openProject">
                  去看看
                </UiButton>
              </div>
            </div>
          </div>
        </div>

        <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
          <div class="px-4 sm:px-6 py-4 border-b border-slate-200/70 bg-white/40 flex items-center justify-between">
            <div class="text-sm font-extrabold text-slate-900">评论</div>
            <div class="text-xs text-slate-500 font-semibold">{{ comments.length }} 条</div>
          </div>

          <div class="p-6 border-b border-slate-200/70 bg-white/30">
            <div v-if="replyState.parentId" class="mb-3 flex items-center justify-between gap-3">
              <div class="text-xs font-semibold text-slate-600">
                回复 <span class="text-sky-700 font-extrabold">@{{ replyState.replyToName || '用户' }}</span>
              </div>
              <UiButton variant="ghost" class="px-2 py-1 rounded-lg text-xs font-semibold" @click="cancelReply">取消</UiButton>
            </div>

            <div class="flex items-center gap-2">
              <EmojiPicker v-model="commentDraft" :target="commentInputEl" :disabled="isSubmitting" size="sm" />
              <input
                ref="commentInputEl"
                v-model="commentDraft"
                type="text"
                class="flex-1 input-glass rounded-xl px-4 py-2 text-sm"
                placeholder="写下你的评论…"
                :disabled="isSubmitting"
              />
              <UiButton
                variant="primary"
                class="px-4 py-2 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50"
                :disabled="isSubmitting || !commentDraft.trim()"
                @click="submitComment"
              >
                <i v-if="isSubmitting" class="ph-bold ph-spinner animate-spin"></i>
                发送
              </UiButton>
            </div>
          </div>

          <div v-if="isCommentsLoading" class="p-6 space-y-3">
            <div v-for="n in 6" :key="n" class="h-16 rounded-2xl skeleton"></div>
          </div>

          <div v-else-if="!topLevel.length" class="p-10 text-center text-slate-500">
            <div class="font-extrabold text-slate-900">还没有评论</div>
            <div class="text-sm font-semibold mt-1">来抢个沙发吧</div>
          </div>

          <div v-else class="p-6 space-y-5">
            <div v-for="c in topLevel" :key="c.id" class="rounded-2xl bg-white/35 border border-white/70 p-4">
              <div class="flex items-start gap-3">
                <img
                  v-if="c.author?.avatar"
                  :src="c.author.avatar"
                  class="w-9 h-9 rounded-full object-cover border border-white/70"
                />
                <div
                  v-else
                  class="w-9 h-9 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white text-xs font-extrabold border border-white/70"
                >
                  {{ c.author?.username?.charAt(0)?.toUpperCase() || 'U' }}
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="text-xs font-extrabold text-slate-900 truncate hover:text-sky-700"
                      @click="openUser(c.author?.uid || c.author?.id || c.author?._id)"
                    >
                      {{ c.author?.username || '用户' }}
                    </button>
                    <div class="text-[11px] text-slate-500 font-semibold">{{ timeAgo(c.createdAt) }}</div>
                    <div class="ml-auto">
                      <UiButton variant="ghost" class="px-2 py-1 rounded-lg text-xs font-semibold" @click="beginReply(c)">回复</UiButton>
                    </div>
                  </div>
                  <div class="mt-1 text-sm text-slate-800 whitespace-pre-wrap">
                    <MentionText :text="c.content" :highlight="user?.username || ''" />
                  </div>

                  <div v-if="repliesByParent.get(String(c.id))?.length" class="mt-3 space-y-2">
                    <div
                      v-for="r in repliesByParent.get(String(c.id))"
                      :key="r.id"
                      class="rounded-2xl bg-white/55 border border-white/70 p-3 ml-6"
                    >
                      <div class="flex items-start gap-3">
                        <button type="button" class="shrink-0" @click="openUser(r.author?.uid || r.author?.id || r.author?._id)">
                          <img
                            v-if="r.author?.avatar"
                            :src="r.author.avatar"
                            class="w-8 h-8 rounded-full object-cover border border-white/70"
                          />
                          <div
                            v-else
                            class="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-[10px] text-white font-extrabold border border-white/70"
                          >
                            {{ r.author?.username?.charAt(0)?.toUpperCase() || 'U' }}
                          </div>
                        </button>

                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2">
                            <button
                              type="button"
                              class="text-xs font-extrabold text-slate-900 hover:text-sky-700 truncate"
                              @click="openUser(r.author?.uid || r.author?.id || r.author?._id)"
                            >
                              {{ r.author?.username || '用户' }}
                            </button>
                            <span v-if="r.replyToUser?.username" class="text-xs text-slate-500 font-semibold">
                              回复 <span class="text-sky-700 font-extrabold">@{{ r.replyToUser.username }}</span>
                            </span>
                            <div class="text-[11px] text-slate-500 font-semibold ml-auto shrink-0">{{ timeAgo(r.createdAt) }}</div>
                          </div>
                          <div class="mt-1 text-sm text-slate-800 whitespace-pre-wrap">
                            <MentionText :text="r.content" :highlight="user?.username || ''" />
                          </div>
                          <div class="mt-2">
                            <UiButton variant="ghost" class="px-2 py-1 rounded-lg text-xs font-semibold" @click="beginReply(r)">回复</UiButton>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
