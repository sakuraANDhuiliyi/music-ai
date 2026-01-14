<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useAttrs, watch } from 'vue';
import { useRouter } from 'vue-router';
import { authFetch, useUser } from '../composables/useUser.js';
import UiButton from './UiButton.vue';
import { apiUrl } from '../config/apiBase.js';

const userCache = new Map();

const props = defineProps({
  user: { type: Object, required: true },
  openDelay: { type: Number, default: 120 },
  closeDelay: { type: Number, default: 140 },
});

const attrs = useAttrs();
const router = useRouter();
const { user: me } = useUser();

const anchorEl = ref(null);
const cardEl = ref(null);

const isOpen = ref(false);
const placement = ref('bottom'); // bottom | top
const floatingStyle = ref({});

const isLoading = ref(false);
const profile = ref(null);
const relationship = ref(null);
const isRelationLoading = ref(false);
const isTogglingFollow = ref(false);
const isTogglingBlock = ref(false);
const actionError = ref('');

let openTimer = null;
let closeTimer = null;
let rafId = null;

const uid = computed(() => props.user?.uid || props.user?.id || '');
const isSelf = computed(() => Boolean(me.value?.uid) && Boolean(uid.value) && String(me.value.uid) === String(uid.value));
const isBlockedByMe = computed(() => Boolean(relationship.value?.isBlocked));
const hasBlockedMe = computed(() => Boolean(relationship.value?.hasBlockedMe));
const isBlockedEither = computed(() => isBlockedByMe.value || hasBlockedMe.value);
const canMessage = computed(() => Boolean(uid.value) && !isSelf.value && !isBlockedEither.value);
const canFollow = computed(() => Boolean(uid.value) && !isSelf.value && !isBlockedEither.value);

const displayProfile = computed(() => profile.value || props.user || {});
const displayBio = computed(() => {
  const bio = displayProfile.value?.bio;
  if (typeof bio === 'string') return bio.trim();
  return '';
});

const updateCachedProfile = (patch) => {
  const id = String(uid.value || '');
  if (!id) return;
  const next = { ...(profile.value || props.user || {}), ...patch };
  profile.value = next;
  userCache.set(id, next);
};

const safeJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const ensureProfile = async () => {
  const id = String(uid.value || '');
  if (!id || isSelf.value) return;

  const cached = userCache.get(id);
  if (cached) {
    profile.value = cached;
    return;
  }

  isLoading.value = true;
  try {
    const res = await fetch(apiUrl(`/api/users/${encodeURIComponent(id)}/public`));
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    userCache.set(id, data);
    profile.value = data;
  } catch (e) {
    profile.value = props.user;
    userCache.set(id, props.user);
  } finally {
    isLoading.value = false;
  }
};

const ensureRelationship = async () => {
  actionError.value = '';
  const id = String(uid.value || '');
  if (!id || isSelf.value) return;
  if (!me.value) {
    relationship.value = null;
    return;
  }

  isRelationLoading.value = true;
  try {
    const res = await authFetch(`/api/users/${encodeURIComponent(id)}/relationship`);
    if (!res.ok) {
      const data = await safeJson(res);
      throw new Error(data?.message || '加载关系失败');
    }
    relationship.value = await res.json();
  } catch (e) {
    relationship.value = null;
  } finally {
    isRelationLoading.value = false;
  }
};

const toggleFollow = async () => {
  actionError.value = '';
  const id = String(uid.value || '');
  if (!id || isSelf.value) return;
  if (!me.value) return router.push('/login');
  if (isBlockedEither.value) {
    actionError.value = hasBlockedMe.value ? '对方已拉黑你，无法关注' : '已拉黑该用户，无法关注';
    return;
  }

  const prevFollowing = Boolean(relationship.value?.isFollowing);
  const prevFollowerCount = Number(displayProfile.value?.followerCount || 0);

  isTogglingFollow.value = true;
  relationship.value = {
    ...(relationship.value || { isFollowing: false, isBlocked: false, hasBlockedMe: false, isSelf: false }),
    isFollowing: !prevFollowing,
  };
  updateCachedProfile({ followerCount: Math.max(0, prevFollowerCount + (prevFollowing ? -1 : 1)) });

  try {
    const res = await authFetch(`/api/users/${encodeURIComponent(id)}/follow`, { method: 'POST' });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.message || '操作失败');
    relationship.value = { ...(relationship.value || {}), isFollowing: Boolean(data?.isFollowing) };
  } catch (e) {
    relationship.value = { ...(relationship.value || {}), isFollowing: prevFollowing };
    updateCachedProfile({ followerCount: prevFollowerCount });
    actionError.value = e?.message || '操作失败';
  } finally {
    isTogglingFollow.value = false;
  }
};

const toggleBlock = async () => {
  actionError.value = '';
  const id = String(uid.value || '');
  if (!id || isSelf.value) return;
  if (!me.value) return router.push('/login');

  const prevBlocked = Boolean(relationship.value?.isBlocked);
  const prevFollowing = Boolean(relationship.value?.isFollowing);
  const prevFollowerCount = Number(displayProfile.value?.followerCount || 0);
  const nextBlocked = !prevBlocked;

  if (nextBlocked) {
    const ok = window.confirm('确定要拉黑该用户吗？\n拉黑后将不会再看到 TA 的作品/消息，也无法继续互动。');
    if (!ok) return;
  }

  isTogglingBlock.value = true;
  relationship.value = {
    ...(relationship.value || { isFollowing: false, isBlocked: false, hasBlockedMe: false, isSelf: false }),
    isBlocked: nextBlocked,
    isFollowing: nextBlocked ? false : Boolean(relationship.value?.isFollowing),
  };
  if (nextBlocked && prevFollowing) updateCachedProfile({ followerCount: Math.max(0, prevFollowerCount - 1) });

  try {
    const res = await authFetch(`/api/users/${encodeURIComponent(id)}/block`, { method: 'POST' });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.message || '操作失败');
    const serverBlocked = Boolean(data?.isBlocked);
    relationship.value = {
      ...(relationship.value || {}),
      isBlocked: serverBlocked,
      isFollowing: serverBlocked ? false : Boolean(relationship.value?.isFollowing),
    };
  } catch (e) {
    relationship.value = { ...(relationship.value || {}), isBlocked: prevBlocked, isFollowing: prevFollowing };
    updateCachedProfile({ followerCount: prevFollowerCount });
    actionError.value = e?.message || '操作失败';
  } finally {
    isTogglingBlock.value = false;
  }
};

const scheduleUpdate = () => {
  if (!isOpen.value) return;
  if (rafId) return;
  rafId = window.requestAnimationFrame(async () => {
    rafId = null;
    await updatePosition();
  });
};

const updatePosition = async () => {
  const anchor = anchorEl.value;
  const card = cardEl.value;
  if (!anchor || !card) return;

  const rect = anchor.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const padding = 10;
  const offset = 10;

  let nextPlacement = 'bottom';
  let top = rect.bottom + offset;

  const fitsBottom = top + cardRect.height + padding <= vh;
  const fitsTop = rect.top - offset - cardRect.height >= padding;
  if (!fitsBottom && fitsTop) {
    nextPlacement = 'top';
    top = rect.top - offset - cardRect.height;
  }

  let left = rect.left + rect.width / 2 - cardRect.width / 2;
  left = Math.max(padding, Math.min(left, vw - cardRect.width - padding));

  const anchorCenterX = rect.left + rect.width / 2;
  const arrowLeft = Math.max(18, Math.min(anchorCenterX - left, cardRect.width - 18));

  placement.value = nextPlacement;
  floatingStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    zIndex: 9999,
    '--arrow-left': `${Math.round(arrowLeft)}px`,
  };
};

const addListeners = () => {
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('scroll', scheduleUpdate, true);
};

const removeListeners = () => {
  window.removeEventListener('resize', scheduleUpdate);
  window.removeEventListener('scroll', scheduleUpdate, true);
};

const openNow = async () => {
  if (isSelf.value) return;
  isOpen.value = true;
  await nextTick();
  await updatePosition();
  addListeners();
  ensureProfile();
  ensureRelationship();
};

const closeNow = () => {
  isOpen.value = false;
  removeListeners();
};

const onTriggerEnter = () => {
  if (isSelf.value) return;
  if (closeTimer) window.clearTimeout(closeTimer);
  if (isOpen.value) return;
  openTimer = window.setTimeout(openNow, props.openDelay);
};

const onTriggerLeave = () => {
  if (openTimer) window.clearTimeout(openTimer);
  closeTimer = window.setTimeout(closeNow, props.closeDelay);
};

const onCardEnter = () => {
  if (closeTimer) window.clearTimeout(closeTimer);
};

const onCardLeave = () => {
  closeTimer = window.setTimeout(closeNow, props.closeDelay);
};

const sendMessage = () => {
  const id = String(uid.value || '');
  if (!id || isSelf.value) return;
  if (isBlockedEither.value) return;
  closeNow();
  if (!me.value) return router.push('/login');
  router.push({ name: 'Notifications', query: { tab: 'chat', peer: id } });
};

watch(
  () => router.currentRoute.value.fullPath,
  () => closeNow()
);

watch(
  () => uid.value,
  () => {
    profile.value = null;
    relationship.value = null;
    closeNow();
  }
);

watch(
  () => me.value?.uid,
  () => {
    if (!isOpen.value) return;
    ensureRelationship();
  }
);

onBeforeUnmount(() => {
  if (openTimer) window.clearTimeout(openTimer);
  if (closeTimer) window.clearTimeout(closeTimer);
  if (rafId) window.cancelAnimationFrame(rafId);
  removeListeners();
});
</script>

<template>
  <span class="inline-flex">
    <span
      ref="anchorEl"
      class="inline-flex"
      v-bind="attrs"
      @mouseenter="onTriggerEnter"
      @mouseleave="onTriggerLeave"
    >
      <slot />
    </span>

    <Teleport to="body">
      <transition name="hovercard">
        <div
          v-if="isOpen"
          ref="cardEl"
          class="user-hover-card"
          :data-placement="placement"
          :style="floatingStyle"
          @mouseenter="onCardEnter"
          @mouseleave="onCardLeave"
        >
        <div class="glass-card border border-white/70 rounded-2xl overflow-hidden shadow-2xl w-[320px] max-w-[calc(100vw-2rem)]">
          <div class="relative h-20 bg-gradient-to-r from-sky-400/25 via-indigo-400/20 to-cyan-400/25">
            <div class="absolute inset-0 aurora-noise"></div>
          </div>

          <div class="px-4 pb-4 -mt-8">
            <div class="flex items-start gap-3">
              <img
                v-if="displayProfile.avatar"
                :src="displayProfile.avatar"
                class="w-14 h-14 rounded-2xl object-cover border border-white/80 shadow-[0_18px_45px_-35px_rgba(2,132,199,0.55)] bg-white/60"
              />
              <div
                v-else
                class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white text-xl font-extrabold border border-white/80 shadow-[0_18px_45px_-35px_rgba(2,132,199,0.55)]"
              >
                {{ (displayProfile.username || 'U').charAt(0).toUpperCase() }}
              </div>

              <div class="min-w-0 flex-1 pt-1">
                <div class="font-extrabold text-slate-900 truncate">
                  {{ displayProfile.username || '未知用户' }}
                </div>
                <div v-if="isLoading" class="mt-2 space-y-2">
                  <div class="h-3 skeleton rounded w-5/6"></div>
                  <div class="h-3 skeleton rounded w-3/5"></div>
                </div>
                <div v-else class="mt-1 text-sm text-slate-600 leading-snug clamp-3">
                  {{ displayBio || '这个用户还没有简介～' }}
                </div>
              </div>
            </div>

            <div class="mt-3 grid grid-cols-2 gap-2">
              <div class="rounded-xl bg-white/45 border border-white/70 px-3 py-2 text-center">
                <div class="text-[11px] font-bold text-slate-500">关注</div>
                <div class="text-sm font-extrabold text-slate-900">
                  {{ typeof displayProfile.followingCount === 'number' ? displayProfile.followingCount : '—' }}
                </div>
              </div>
              <div class="rounded-xl bg-white/45 border border-white/70 px-3 py-2 text-center">
                <div class="text-[11px] font-bold text-slate-500">粉丝</div>
                <div class="text-sm font-extrabold text-slate-900">
                  {{ typeof displayProfile.followerCount === 'number' ? displayProfile.followerCount : '—' }}
                </div>
              </div>
            </div>

            <div v-if="isBlockedByMe" class="mt-3 text-[11px] font-bold text-rose-700 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-xl">
              你已拉黑该用户：将不会再看到 TA 的作品/消息
            </div>
            <div v-else-if="hasBlockedMe" class="mt-3 text-[11px] font-bold text-amber-800 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl">
              对方已拉黑你：无法关注/私聊
            </div>
            <div v-else-if="actionError" class="mt-3 text-[11px] font-bold text-rose-700 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-xl">
              {{ actionError }}
            </div>

            <div class="mt-4 grid grid-cols-2 gap-2">
              <UiButton
                v-if="!isSelf"
                variant="secondary"
                class="w-full text-xs font-semibold py-2.5 rounded-xl"
                :disabled="isRelationLoading || isTogglingFollow || !canFollow"
                :aria-disabled="isRelationLoading || isTogglingFollow || !canFollow"
                @click.stop="toggleFollow"
              >
                <i v-if="isTogglingFollow" class="ph-bold ph-spinner animate-spin"></i>
                <i v-else :class="relationship?.isFollowing ? 'ph-bold ph-check' : 'ph-bold ph-user-plus'"></i>
                {{ relationship?.isFollowing ? '已关注' : '关注' }}
              </UiButton>
              <UiButton
                v-if="canMessage"
                variant="primary"
                class="w-full text-white font-semibold py-2.5 rounded-xl shadow-lg shadow-sky-500/20"
                @click.stop="sendMessage"
              >
                <i class="ph-bold ph-chat-circle-text"></i>
                发消息
              </UiButton>
              <UiButton
                v-else
                variant="secondary"
                class="w-full text-xs font-semibold py-2.5 rounded-xl opacity-70"
                disabled
              >
                <i class="ph-bold ph-lock"></i>
                无法私聊
              </UiButton>
            </div>

            <div class="mt-2 flex items-center gap-2">
              <UiButton
                v-if="!isSelf"
                variant="ghost"
                class="flex-1 px-3 py-2.5 rounded-xl text-xs font-semibold"
                :class="relationship?.isBlocked ? 'text-rose-700 hover:bg-rose-500/10 hover:border-rose-500/20' : 'hover:text-rose-700'"
                :disabled="isTogglingBlock"
                @click.stop="toggleBlock"
              >
                <i v-if="isTogglingBlock" class="ph-bold ph-spinner animate-spin"></i>
                <i v-else :class="relationship?.isBlocked ? 'ph-bold ph-prohibit-inset' : 'ph-bold ph-warning'"></i>
                {{ relationship?.isBlocked ? '取消拉黑' : '拉黑' }}
              </UiButton>
              <UiButton
                variant="ghost"
                class="px-3 py-2.5 rounded-xl text-xs font-semibold"
                @click.stop="closeNow"
              >
                <i class="ph-bold ph-x"></i>
              </UiButton>
            </div>
          </div>
        </div>
        </div>
      </transition>
    </Teleport>
  </span>
</template>

<style scoped>
.user-hover-card {
  transform: translateZ(0);
}

.user-hover-card::before {
  content: '';
  position: absolute;
  left: var(--arrow-left, 40px);
  width: 12px;
  height: 12px;
  background: rgba(255, 255, 255, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transform: translateX(-50%) rotate(45deg);
  top: -6px;
  box-shadow: 0 18px 45px -35px rgba(2, 132, 199, 0.35);
}

.user-hover-card[data-placement='top']::before {
  top: auto;
  bottom: -6px;
}

.clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hovercard-enter-active,
.hovercard-leave-active {
  transition: opacity 160ms ease, transform 180ms ease, filter 180ms ease;
}
.hovercard-enter-from,
.hovercard-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
  filter: blur(10px);
}

@media (prefers-reduced-motion: reduce) {
  .hovercard-enter-active,
  .hovercard-leave-active {
    transition: none;
  }
  .hovercard-enter-from,
  .hovercard-leave-to {
    transform: none;
    filter: none;
  }
}
</style>
