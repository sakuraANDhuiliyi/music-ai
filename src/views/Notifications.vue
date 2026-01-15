<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';
import MentionText from '../components/MentionText.vue';
import UserHoverCard from '../components/UserHoverCard.vue';
import EmojiPicker from '../components/EmojiPicker.vue';

const router = useRouter();
const route = useRoute();
const { user, isAuthReady } = useUser();

const tabs = [
  { id: 'chat', label: '我的消息', icon: 'ph-bold ph-chat-circle-text' },
  { id: 'replies', label: '回复我的', icon: 'ph-bold ph-chat-teardrop-text' },
  { id: 'mentions', label: '@ 我的', icon: 'ph-bold ph-at' },
  { id: 'likes', label: '收到的赞', icon: 'ph-bold ph-heart' },
  { id: 'system', label: '系统通知', icon: 'ph-bold ph-bell' },
  { id: 'settings', label: '消息设置', icon: 'ph-bold ph-gear' },
];

const isValidTab = (id) => tabs.some((t) => t.id === id);
const activeTab = ref('chat');

watch(
  () => route.query.tab,
  (tab) => {
    const next = String(tab || '');
    activeTab.value = isValidTab(next) ? next : 'chat';
  },
  { immediate: true }
);

const ensureAuth = () => {
  if (!isAuthReady.value) return false;
  if (user.value) return true;
  router.push('/login');
  return false;
};

const setTab = (id) => {
  if (!isValidTab(id)) return;
  const nextQuery = { ...route.query, tab: id };
  if (id !== 'chat') delete nextQuery.peer;
  router.replace({ path: route.path, query: nextQuery });
};

const tabTitle = computed(() => tabs.find((t) => t.id === activeTab.value)?.label || '消息中心');
const tabHint = computed(() => {
  if (activeTab.value === 'chat') return '点击社区头像即可开始私聊';
  if (activeTab.value === 'settings') return '控制你想收到的消息类型';
  return '点击消息可跳转到对应内容';
});

const canInteract = computed(() => Boolean(user.value));

// =========================
// Notifications
// =========================
const notifications = ref([]);
const isNotesLoading = ref(true);
const isClearing = ref(false);
const deletePending = ref({});
const likePending = ref({});

const replyingNoteId = ref('');
const replyDraft = ref('');
const replyInputEl = ref(null);
const isReplySubmitting = ref(false);
const replySentNoteId = ref('');

const hydrateNotifications = (list) => {
  return (list || []).map((note) => {
    const comment = note.comment
      ? {
          ...note.comment,
          likesCount: note.comment.likesCount ?? (note.comment.likes?.length || 0),
          isLiked: user.value ? (note.comment.likes || []).some((id) => String(id) === String(user.value.uid)) : false,
        }
      : null;
    return { ...note, comment };
  });
};

const fetchNotifications = async () => {
  if (!user.value) return;
  isNotesLoading.value = true;
  try {
    const res = await authFetch('/api/notifications');
    if (res.ok) {
      notifications.value = hydrateNotifications(await res.json());
    }
  } catch (e) {
    console.error(e);
  } finally {
    isNotesLoading.value = false;
  }
};

watch(
  () => user.value?.uid,
  () => {
    notifications.value = hydrateNotifications(notifications.value);
  }
);

const replyNotes = computed(() =>
  notifications.value.filter((n) => n.type === 'comment_project' || n.type === 'comment_post' || n.type === 'reply')
);
const mentionNotes = computed(() => notifications.value.filter((n) => n.type === 'mention'));
const likeNotes = computed(() => notifications.value.filter((n) => n.type === 'like_project' || n.type === 'like_comment'));
const systemNotes = computed(() => notifications.value.filter((n) => n.type === 'system' || n.type === 'followed_project'));

const currentNotes = computed(() => {
  if (activeTab.value === 'replies') return replyNotes.value;
  if (activeTab.value === 'mentions') return mentionNotes.value;
  if (activeTab.value === 'likes') return likeNotes.value;
  if (activeTab.value === 'system') return systemNotes.value;
  return [];
});

const canClearNotes = computed(() => activeTab.value !== 'chat' && activeTab.value !== 'settings' && notifications.value.length);

const formatDate = (dateStr) => new Date(dateStr).toLocaleString();

const TAB_READ_TYPES = Object.freeze({
  replies: ['comment_project', 'comment_post', 'reply'],
  mentions: ['mention'],
  likes: ['like_project', 'like_comment'],
  system: ['system', 'followed_project'],
});

const tabUnreadCounts = computed(() => {
  const counts = { chat: 0, replies: 0, mentions: 0, likes: 0, system: 0 };

  for (const note of notifications.value || []) {
    if (!note || note.isRead) continue;
    if (note.type === 'comment_project' || note.type === 'comment_post' || note.type === 'reply') counts.replies += 1;
    else if (note.type === 'mention') counts.mentions += 1;
    else if (note.type === 'like_project' || note.type === 'like_comment') counts.likes += 1;
    else if (note.type === 'system' || note.type === 'followed_project') counts.system += 1;
  }

  // Respect user's display toggles (chat is UI-only; others are also treated as display toggles here)
  counts.chat = settings.value?.chat ? chatUnreadTotal.value : 0;
  if (settings.value && settings.value.replies === false) counts.replies = 0;
  if (settings.value && settings.value.mentions === false) counts.mentions = 0;
  if (settings.value && settings.value.likes === false) counts.likes = 0;
  if (settings.value && settings.value.system === false) counts.system = 0;

  return counts;
});

const totalUnread = computed(() => {
  const c = tabUnreadCounts.value;
  return (c.chat || 0) + (c.replies || 0) + (c.mentions || 0) + (c.likes || 0) + (c.system || 0);
});

const noteTag = (note) => {
  switch (note.type) {
    case 'comment_project':
      return '评论了你的作品';
    case 'comment_post':
      return '评论了你的帖子';
    case 'reply':
      return '回复了你的评论';
    case 'mention':
      return '@ 了你';
    case 'like_project':
      return '赞了你的作品';
    case 'like_comment':
      return '赞了你的评论';
    case 'followed_project':
      return '发布了新作品';
    case 'system':
      return '系统通知';
    default:
      return '新消息';
  }
};

const goToTarget = (note) => {
  const query = note.comment?.id ? { comment: note.comment.id } : {};

  const postId = note?.post?.id || note?.post?._id || note?.post;
  if (postId) return router.push({ name: 'PostDetail', params: { id: postId }, query });

  const projectId = note?.project?.id || note?.project?._id || note?.project;
  if (projectId) return router.push({ name: 'ProjectDetail', params: { id: projectId }, query });
};

const deleteNotification = async (note) => {
  if (!ensureAuth()) return;
  deletePending.value = { ...deletePending.value, [note.id]: true };
  try {
    const res = await authFetch(`/api/notifications/${note.id}`, { method: 'DELETE' });
    if (res.ok) notifications.value = notifications.value.filter((n) => n.id !== note.id);
  } catch (e) {
    console.error(e);
  } finally {
    deletePending.value = { ...deletePending.value, [note.id]: false };
  }
};

const clearAllNotifications = async () => {
  if (!ensureAuth()) return;
  if (!notifications.value.length) return;
  if (!confirm('确定要清空所有通知吗？')) return;
  isClearing.value = true;
  try {
    const res = await authFetch('/api/notifications', { method: 'DELETE' });
    if (res.ok) notifications.value = [];
  } catch (e) {
    console.error(e);
  } finally {
    isClearing.value = false;
  }
};

const isReplyable = (note) => ['reply', 'comment_project', 'comment_post', 'mention'].includes(note.type) && Boolean(note.comment);

const openReply = (note) => {
  if (!canInteract.value) return router.push('/login');
  replyingNoteId.value = note.id;
  replyDraft.value = '';
};
const closeReply = () => {
  replyingNoteId.value = '';
  replyDraft.value = '';
};

const submitReply = async (note) => {
  if (!canInteract.value) return router.push('/login');
  const projectId = note?.project?.id || note?.project?._id || note?.project;
  const postId = note?.post?.id || note?.post?._id || note?.post;
  if ((!projectId && !postId) || !note?.comment?.id) return;
  const content = replyDraft.value.trim();
  if (!content) return;

  isReplySubmitting.value = true;
  try {
    const parentId = note.comment.parentId || note.comment.id;
    const replyToUserId = note.sender?.uid || note.comment.author?.uid || null;
    const base = postId ? `/api/posts/${postId}/comments` : `/api/projects/${projectId}/comments`;
    const res = await authFetch(base, {
      method: 'POST',
      body: JSON.stringify({ content, parentId, replyToUserId }),
    });
    if (!res.ok) throw new Error('reply failed');

    replySentNoteId.value = note.id;
    window.setTimeout(() => {
      if (replySentNoteId.value === note.id) replySentNoteId.value = '';
    }, 1600);
    closeReply();
  } catch (e) {
    alert('回复失败，请稍后重试');
  } finally {
    isReplySubmitting.value = false;
  }
};

const toggleNoteLike = async (note) => {
  if (!canInteract.value) return router.push('/login');
  if (!note?.comment?.id) return;

  likePending.value = { ...likePending.value, [note.id]: true };

  const originalLiked = note.comment.isLiked;
  const originalCount = note.comment.likesCount || 0;
  note.comment.isLiked = !originalLiked;
  note.comment.likesCount = originalCount + (originalLiked ? -1 : 1);

  try {
    const res = await authFetch(`/api/comments/${note.comment.id}/like`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json();
      note.comment.likesCount = data.likesCount;
      note.comment.isLiked = data.isLiked;
    }
  } catch (e) {
    note.comment.isLiked = originalLiked;
    note.comment.likesCount = originalCount;
  } finally {
    likePending.value = { ...likePending.value, [note.id]: false };
  }
};

// =========================
// Chat
// =========================
const conversations = ref([]);
const isChatsLoading = ref(false);
const activeConversationId = ref('');
const messages = ref([]);
const isMessagesLoading = ref(false);
const messageDraft = ref('');
const isSendingMessage = ref(false);
const messagesEl = ref(null);

const chatUnreadTotal = computed(() => (conversations.value || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0));

const selectedConversation = computed(
  () => conversations.value.find((c) => c.id === activeConversationId.value) || null
);

const peerOf = (conversation) => {
  const me = String(user.value?.uid || '');
  return (conversation.participants || []).find((p) => String(p?.uid) !== me) || null;
};

const selectedPeer = computed(() => (selectedConversation.value ? peerOf(selectedConversation.value) : null));

const fetchChats = async () => {
  if (!user.value) return;
  isChatsLoading.value = true;
  try {
    const res = await authFetch('/api/chats');
    if (res.ok) conversations.value = await res.json();
  } catch (e) {
    console.error(e);
  } finally {
    isChatsLoading.value = false;
  }
};

const scrollMessagesToBottom = async () => {
  await nextTick();
  const el = messagesEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
};

const openConversation = async (conversationId) => {
  if (!ensureAuth()) return;
  activeConversationId.value = conversationId;
  messages.value = [];
  isMessagesLoading.value = true;
  try {
    const res = await authFetch(`/api/chats/${conversationId}/messages`);
    if (res.ok) messages.value = await res.json();
    await authFetch(`/api/chats/${conversationId}/read`, { method: 'PUT', body: JSON.stringify({}) });
    conversations.value = conversations.value.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c));
    scrollMessagesToBottom();
  } catch (e) {
    console.error(e);
  } finally {
    isMessagesLoading.value = false;
  }
};

const openChatWithPeer = async (peerId) => {
  if (!ensureAuth()) return;
  if (!peerId) return;
  try {
    const res = await authFetch(`/api/chats/with/${peerId}`, { method: 'POST', body: JSON.stringify({}) });
    if (!res.ok) return;
    const conversation = await res.json();
    if (!conversations.value.some((c) => c.id === conversation.id)) {
      conversations.value = [{ ...conversation, unreadCount: 0 }, ...conversations.value];
    }
    await openConversation(conversation.id);
  } catch (e) {
    console.error(e);
  }
};

const sendMessage = async () => {
  if (!ensureAuth()) return;
  const content = messageDraft.value.trim();
  if (!activeConversationId.value || !content) return;

  isSendingMessage.value = true;
  try {
    const res = await authFetch(`/api/chats/${activeConversationId.value}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error('send failed');
    const msg = await res.json();

    messages.value = [...messages.value, msg];
    messageDraft.value = '';

    conversations.value = conversations.value
      .map((c) => (c.id === activeConversationId.value ? { ...c, lastMessage: msg, lastMessageAt: msg.createdAt, unreadCount: 0 } : c))
      .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));

    scrollMessagesToBottom();
  } catch (e) {
    console.error(e);
  } finally {
    isSendingMessage.value = false;
  }
};

// =========================
// Settings
// =========================
const settings = ref({ chat: true, replies: true, mentions: true, likes: true, system: true });
const isSettingsLoading = ref(false);
const savingKey = ref('');

const settingOptions = [
  { key: 'chat', label: '聊天提醒', desc: '控制是否显示私聊未读角标' },
  { key: 'replies', label: '回复我的', desc: '作品评论、评论回复的通知' },
  { key: 'mentions', label: '@ 我的', desc: '他人在评论中 @ 你的提醒' },
  { key: 'likes', label: '收到的赞', desc: '作品点赞、评论点赞的通知' },
  { key: 'system', label: '系统通知', desc: '活动、公告等系统消息' },
];

const fetchSettings = async () => {
  if (!user.value) return;
  isSettingsLoading.value = true;
  try {
    const res = await authFetch('/api/message-settings');
    if (res.ok) settings.value = await res.json();
  } catch (e) {
    console.error(e);
  } finally {
    isSettingsLoading.value = false;
  }
};

const toggleSetting = async (key) => {
  if (!ensureAuth()) return;
  savingKey.value = key;
  const prev = settings.value[key];
  const next = !prev;
  settings.value = { ...settings.value, [key]: next };
  try {
    const res = await authFetch('/api/message-settings', { method: 'PUT', body: JSON.stringify({ [key]: next }) });
    if (res.ok) settings.value = await res.json();
    else throw new Error('save failed');
  } catch (e) {
    settings.value = { ...settings.value, [key]: prev };
  } finally {
    savingKey.value = '';
  }
};

const markNotificationsReadForTab = async (tabId) => {
  if (!ensureAuth()) return;
  const types = TAB_READ_TYPES[tabId];
  if (!types) return;

  const hasUnread = (notifications.value || []).some((note) => note && !note.isRead && types.includes(note.type));
  if (!hasUnread) return;

  // Optimistic local update for a snappy UI.
  notifications.value = (notifications.value || []).map((note) =>
    note && !note.isRead && types.includes(note.type) ? { ...note, isRead: true } : note
  );

  try {
    await authFetch('/api/notifications/read', { method: 'PUT', body: JSON.stringify({ types }) });
  } catch (e) {
    console.error(e);
  }
};

watch(
  () => activeTab.value,
  async (tab) => {
    if (!user.value) return;
    if (tab === 'chat') await fetchChats();
    if (tab === 'settings') await fetchSettings();
  }
);

watch(
  () => ({ tab: activeTab.value, loading: isNotesLoading.value, uid: user.value?.uid }),
  async ({ tab, loading, uid }) => {
    if (!uid) return;
    if (loading) return;
    await markNotificationsReadForTab(tab);
  },
  { immediate: true }
);

watch(
  () => [activeTab.value, route.query.peer, user.value?.uid],
  async ([tab, peer]) => {
    if (tab !== 'chat') return;
    if (!user.value) return;
    if (!conversations.value.length) await fetchChats();
    if (peer) await openChatWithPeer(String(peer));
  },
  { immediate: true }
);

const hasBootstrapped = ref(false);
watch(
  () => ({ ready: isAuthReady.value, uid: user.value?.uid }),
  async ({ ready, uid }) => {
    if (!ready) return;
    if (!uid) {
      router.push('/login');
      return;
    }
    if (hasBootstrapped.value) return;
    hasBootstrapped.value = true;
    await fetchSettings();
    await fetchNotifications();
    if (activeTab.value === 'chat') await fetchChats();
  },
  { immediate: true }
);
</script>

<template>
  <div class="page pb-16">
    <div class="page-container max-w-6xl grid grid-cols-1 md:grid-cols-[240px,1fr] gap-4 md:gap-6">
      <aside class="md:sticky md:top-20 h-fit">
        <div class="glass-card rounded-2xl p-3">
          <div class="px-3 py-2 flex items-center justify-between gap-3">
            <div class="text-sm font-extrabold text-slate-800">消息中心</div>
            <div
              v-if="totalUnread"
              class="text-[11px] font-bold text-rose-600 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full"
            >
              {{ totalUnread > 99 ? '99+' : totalUnread }}
            </div>
          </div>

          <div class="mt-1 flex md:flex-col gap-2 md:gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
            <button
              v-for="t in tabs"
              :key="t.id"
              class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition border shrink-0"
              :class="activeTab === t.id ? 'bg-sky-500/10 text-sky-700 border-sky-500/20' : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/55 hover:text-slate-900'"
              @click="setTab(t.id)"
            >
              <i :class="t.icon" class="text-lg"></i>
              <span class="whitespace-nowrap">{{ t.label }}</span>
              <span
                v-if="tabUnreadCounts[t.id] && t.id !== 'settings'"
                class="ml-auto min-w-4 h-4 px-1 bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border border-white/80 shadow-sm"
              >
                {{ tabUnreadCounts[t.id] > 99 ? '99+' : tabUnreadCounts[t.id] }}
              </span>
            </button>
          </div>
        </div>
      </aside>

      <main>
        <div class="glass-card rounded-2xl p-4 md:p-6">
          <div class="flex items-start justify-between gap-4 mb-4">
            <div>
              <div class="text-lg font-extrabold text-slate-900">{{ tabTitle }}</div>
              <div class="text-xs text-slate-500 font-semibold mt-1">{{ tabHint }}</div>
            </div>
            <UiButton
              v-if="canClearNotes"
              variant="ghost"
              class="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2"
              :disabled="isClearing"
              @click="clearAllNotifications"
            >
              <i class="ph-bold ph-trash"></i>
              清空
            </UiButton>
          </div>

          <!-- Chat -->
          <div v-if="activeTab === 'chat'" class="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-4">
            <div class="panel p-2">
              <div class="flex items-center justify-between px-2 py-2">
                <div class="text-sm font-extrabold text-slate-800">最近会话</div>
                <UiButton variant="ghost" class="px-2 py-2 rounded-lg" @click="fetchChats">
                  <i class="ph-bold ph-arrow-clockwise"></i>
                </UiButton>
              </div>

              <div v-if="isChatsLoading" class="p-2 space-y-2">
                <div v-for="n in 6" :key="n" class="h-14 rounded-2xl skeleton"></div>
              </div>

              <div v-else-if="conversations.length === 0" class="p-8 text-center text-slate-500">
                <div class="text-sm font-semibold">暂无私聊</div>
                <div class="text-xs mt-1">去社区点击他人的头像开始聊天</div>
              </div>

              <div v-else class="max-h-[520px] overflow-y-auto p-1 space-y-1">
                <button
                  v-for="conv in conversations"
                  :key="conv.id"
                  class="w-full text-left p-3 rounded-2xl border transition flex gap-3 items-center"
                  :class="activeConversationId === conv.id ? 'bg-sky-500/10 border-sky-500/20' : 'bg-white/40 border-transparent hover:bg-white/55'"
                  @click="openConversation(conv.id)"
                >
                  <div class="relative">
                    <UserHoverCard :user="peerOf(conv) || { username: '未知用户' }" class="inline-flex">
                      <img
                        v-if="peerOf(conv)?.avatar"
                        :src="peerOf(conv).avatar"
                        class="w-10 h-10 rounded-full object-cover border border-white/70"
                      />
                      <div
                        v-else
                        class="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-xs text-white font-extrabold border border-white/70"
                      >
                        {{ peerOf(conv)?.username?.charAt(0).toUpperCase() || 'U' }}
                      </div>
                    </UserHoverCard>
                    <span
                      v-if="conv.unreadCount && settings.chat"
                      class="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border border-white/80 shadow-sm"
                    >
                      {{ conv.unreadCount > 99 ? '99+' : conv.unreadCount }}
                    </span>
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-2">
                      <div class="font-extrabold text-sm text-slate-900 truncate">{{ peerOf(conv)?.username || '未知用户' }}</div>
                      <div class="text-[11px] text-slate-500 font-semibold shrink-0">
                        {{ conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleDateString() : '' }}
                      </div>
                    </div>
                    <div class="text-xs text-slate-600 mt-1 truncate">{{ conv.lastMessage?.content || '开始聊天吧～' }}</div>
                  </div>
                </button>
              </div>
            </div>

            <div class="panel flex flex-col min-h-[420px] md:min-h-[520px]">
              <div class="px-4 py-3 border-b border-slate-200/70 flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-extrabold text-slate-900 truncate">{{ selectedPeer?.username || '选择一个会话' }}</div>
                  <div class="text-xs text-slate-500 font-semibold truncate">{{ selectedPeer ? '私聊中' : '从左侧选择聊天对象' }}</div>
                </div>
                <UiButton
                  v-if="activeConversationId"
                  variant="ghost"
                  class="px-2 py-2 rounded-lg"
                  @click="openConversation(activeConversationId)"
                >
                  <i class="ph-bold ph-arrow-clockwise"></i>
                </UiButton>
              </div>

              <div ref="messagesEl" class="flex-1 overflow-y-auto p-4 space-y-3">
                <div v-if="!activeConversationId" class="h-full flex items-center justify-center text-center text-slate-500">
                  <div class="text-sm font-semibold">还没有打开任何会话</div>
                </div>

                <div v-else-if="isMessagesLoading" class="space-y-2">
                  <div v-for="n in 10" :key="n" class="h-10 rounded-2xl skeleton"></div>
                </div>

                <template v-else>
                  <div
                    v-for="m in messages"
                    :key="m.id"
                    class="flex"
                    :class="String(m.sender?.uid) === String(user.uid) ? 'justify-end' : 'justify-start'"
                  >
                    <div
                      class="max-w-[78%] rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm border"
                      :class="
                        String(m.sender?.uid) === String(user.uid)
                          ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white border-white/20'
                          : 'bg-white/65 text-slate-800 border-white/70'
                      "
                    >
                      <div class="whitespace-pre-wrap break-words">{{ m.content }}</div>
                      <div class="mt-1 text-[10px] font-semibold opacity-75" :class="String(m.sender?.uid) === String(user.uid) ? 'text-white/80' : 'text-slate-500'">
                        {{ formatDate(m.createdAt) }}
                      </div>
                    </div>
                  </div>
                </template>
              </div>

              <div class="p-3 border-t border-slate-200/70 bg-white/30">
                <div class="flex gap-2 items-center">
                  <input
                    v-model="messageDraft"
                    type="text"
                    class="flex-1 input-glass rounded-xl px-4 py-2 text-sm"
                    :disabled="!activeConversationId || isSendingMessage"
                    placeholder="输入消息，回车发送..."
                    @keydown.enter.prevent="sendMessage"
                  />
                  <UiButton
                    variant="primary"
                    class="px-4 py-2 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50"
                    :disabled="!activeConversationId || isSendingMessage || !messageDraft.trim()"
                    @click="sendMessage"
                  >
                    <i v-if="isSendingMessage" class="ph-bold ph-spinner animate-spin"></i>
                    发送
                  </UiButton>
                </div>
              </div>
            </div>
          </div>

          <!-- Settings -->
          <div v-else-if="activeTab === 'settings'">
            <div v-if="isSettingsLoading" class="space-y-3">
              <div v-for="n in 5" :key="n" class="h-20 rounded-2xl skeleton"></div>
            </div>
            <div v-else class="space-y-3">
              <div v-for="opt in settingOptions" :key="opt.key" class="panel p-4 flex items-center justify-between gap-4">
                <div>
                  <div class="font-extrabold text-slate-900">{{ opt.label }}</div>
                  <div class="text-xs text-slate-500 font-semibold mt-1">{{ opt.desc }}</div>
                </div>
                <button class="toggle" :class="settings[opt.key] ? 'toggle-on' : 'toggle-off'" :disabled="savingKey === opt.key" @click="toggleSetting(opt.key)">
                  <span class="toggle-dot" :class="settings[opt.key] ? 'toggle-dot-on' : 'toggle-dot-off'"></span>
                </button>
              </div>
            </div>
          </div>

          <!-- Notifications -->
          <div v-else>
            <div v-if="isNotesLoading" class="space-y-3">
              <div v-for="n in 6" :key="n" class="h-24 rounded-2xl skeleton"></div>
            </div>

            <div v-else-if="currentNotes.length === 0" class="p-16 text-center text-slate-500">
              <div class="text-sm font-semibold">暂无内容</div>
              <div class="text-xs mt-1">有新动态时会出现在这里</div>
            </div>

            <div v-else class="space-y-4">
              <div
                v-for="note in currentNotes"
                :key="note.id"
                class="panel p-4 md:p-5 cursor-pointer hover:border-sky-200/60 transition"
                @click="goToTarget(note)"
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="flex items-start gap-3 min-w-0">
                    <UserHoverCard :user="note.sender || { username: '未知用户' }" class="shrink-0">
                      <img v-if="note.sender?.avatar" :src="note.sender.avatar" class="w-10 h-10 rounded-full object-cover border border-white/70" />
                      <div v-else class="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-xs text-white font-extrabold border border-white/70">
                        {{ note.sender?.username?.charAt(0).toUpperCase() || 'U' }}
                      </div>
                    </UserHoverCard>

                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <div class="text-sm font-extrabold text-slate-900">{{ note.sender?.username || '未知用户' }}</div>
                        <div class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-700 border border-sky-500/20">
                          {{ noteTag(note) }}
                        </div>
                        <div class="text-[11px] text-slate-500 font-semibold">{{ formatDate(note.createdAt) }}</div>
                      </div>

                      <div v-if="note.project" class="mt-1 text-xs text-slate-500 font-semibold">
                        作品：<span class="text-slate-800 font-extrabold">“{{ note.project.title || '未命名' }}”</span>
                      </div>

                      <div v-if="note.comment?.content" class="mt-2 quote note-clamp-2">
                        <MentionText :text="note.comment.content" :highlight="user?.username || ''" />
                      </div>

                      <div class="mt-3 flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2">
                          <div
                            v-if="replySentNoteId === note.id"
                            class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg"
                            @click.stop
                          >
                            <i class="ph-bold ph-check-circle"></i>
                            已发送
                          </div>

                          <UiButton v-if="isReplyable(note)" variant="ghost" class="px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1" @click.stop="openReply(note)">
                            <i class="ph-bold ph-chat-circle"></i>
                            回复
                          </UiButton>

                          <button
                            v-if="note.comment"
                            class="px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition border"
                            :class="note.comment.isLiked ? 'text-rose-600 bg-rose-500/10 border-rose-500/20' : 'text-slate-600 hover:text-rose-600 hover:bg-white/50 border-transparent hover:border-white/70'"
                            :disabled="Boolean(likePending[note.id])"
                            @click.stop="toggleNoteLike(note)"
                          >
                            <i :class="note.comment.isLiked ? 'ph-fill ph-heart' : 'ph-bold ph-heart'"></i>
                            {{ note.comment.likesCount || 0 }}
                          </button>
                        </div>

                        <UiButton
                          variant="ghost"
                          aria-label="删除通知"
                          class="px-2 py-2 rounded-lg text-xs font-semibold opacity-70 hover:opacity-100 transition disabled:opacity-50"
                          :disabled="Boolean(deletePending[note.id])"
                          @click.stop="deleteNotification(note)"
                        >
                          <i class="ph-bold ph-trash text-slate-500 hover:text-rose-600"></i>
                        </UiButton>
                      </div>

                      <div v-if="isReplyable(note) && replyingNoteId === note.id" class="mt-3" @click.stop>
                        <div class="bg-white/55 border border-white/70 backdrop-blur-xl rounded-2xl p-3">
                          <div class="flex items-center justify-between gap-3 mb-2">
                            <div class="text-xs text-slate-600 font-semibold">
                              回复 <span class="text-sky-700 font-extrabold">@{{ note.sender.username }}</span>
                            </div>
                            <UiButton variant="ghost" class="px-2 py-1 rounded-lg text-xs font-semibold" @click.stop="closeReply">
                              取消
                            </UiButton>
                          </div>

                          <div class="flex gap-2 items-center">
                            <EmojiPicker v-model="replyDraft" :target="replyInputEl" :disabled="isReplySubmitting" size="sm" />
                            <input
                              ref="replyInputEl"
                              v-model="replyDraft"
                              type="text"
                              class="flex-1 input-glass rounded-xl px-4 py-2 text-sm"
                              :placeholder="`回复 @${note.sender.username}...`"
                              @click.stop
                              @keydown.stop
                            />
                            <UiButton
                              variant="primary"
                              class="px-4 py-2 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50"
                              :disabled="isReplySubmitting || !replyDraft.trim()"
                              @click.stop="submitReply(note)"
                            >
                              <i v-if="isReplySubmitting" class="ph-bold ph-spinner animate-spin"></i>
                              发送
                            </UiButton>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-if="note.project" class="w-12 h-12 rounded-xl bg-white/50 border border-white/70 backdrop-blur-xl shrink-0 shadow-sm" :style="{ background: note.project.cover }"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.panel {
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-radius: 18px;
}

.quote {
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  padding: 10px 12px;
  color: rgb(51, 65, 85);
  font-size: 14px;
}

.note-clamp-2 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.toggle {
  width: 52px;
  height: 30px;
  border-radius: 9999px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  position: relative;
  transition: background 160ms ease, border-color 160ms ease;
  background: rgba(226, 232, 240, 0.9);
}
.toggle:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.toggle-on {
  background: rgba(14, 165, 233, 0.9);
  border-color: rgba(14, 165, 233, 0.6);
}
.toggle-dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 24px;
  height: 24px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 10px 25px -18px rgba(2, 132, 199, 0.7);
  transition: transform 180ms ease;
}
.toggle-dot-on {
  transform: translateX(22px);
}
</style>
