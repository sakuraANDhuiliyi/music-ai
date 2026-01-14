<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';
import { useUser, authFetch } from '../composables/useUser.js';
import { playNeteaseTrack } from '../utils/musicBridge.js';

const router = useRouter();
const { user, isAuthReady } = useUser();

const loading = ref(false);
const errorMsg = ref('');
const items = ref([]);
const dateLabel = ref('');
const toast = ref('');
let toastTimer = null;

const hasItems = computed(() => items.value.length > 0);

const showToast = (msg) => {
  toast.value = String(msg || '');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = '';
  }, 1800);
};

const fetchDaily = async () => {
  if (!user.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await authFetch('/api/recommendations/daily');
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || '加载失败');
    items.value = Array.isArray(data?.items) ? data.items : [];
    dateLabel.value = data?.date || '';
  } catch (e) {
    items.value = [];
    errorMsg.value = e?.message || '加载失败，请稍后重试';
  } finally {
    loading.value = false;
  }
};

const rebuildDaily = async () => {
  if (!user.value) return router.push('/login');
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await authFetch('/api/recommendations/rebuild', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || '刷新失败');
    showToast('推荐已刷新');
    await fetchDaily();
  } catch (e) {
    errorMsg.value = e?.message || '刷新失败，请稍后重试';
  } finally {
    loading.value = false;
  }
};

const openItem = (entry) => {
  const item = entry?.item || {};
  if (item.source === 'netease') {
    const ok = playNeteaseTrack(item.sourceId);
    if (!ok) showToast('播放器未就绪，请稍后重试');
    return;
  }
  if (item.source === 'community') {
    return router.push(`/projects/${item.sourceId}`);
  }
};

watch(
  () => user.value?.uid,
  () => {
    if (user.value) fetchDaily();
  }
);

onMounted(() => {
  if (user.value) fetchDaily();
});
</script>

<template>
  <div class="page pb-12">
    <div
      v-if="toast"
      class="fixed top-20 right-4 sm:right-6 lg:right-8 z-[120] glass-card px-4 py-2 rounded-xl border border-white/70 text-sm font-semibold text-slate-800 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <i class="ph-bold ph-check-circle text-emerald-600"></i>
        {{ toast }}
      </div>
    </div>

    <div class="page-container max-w-6xl space-y-8">
      <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div class="text-sm text-slate-500 font-semibold">每日推荐</div>
          <h2 class="text-3xl font-extrabold text-slate-900 mb-2">为你挑选的音乐灵感</h2>
          <p class="text-slate-600">
            结合你的 AI 风格偏好、和弦习惯与站内播放记录，推荐站内作品与素材。
          </p>
        </div>
        <div class="flex items-center gap-3">
          <UiButton variant="secondary" class="px-4 py-2 rounded-lg text-sm font-semibold" @click="rebuildDaily">
            刷新推荐
          </UiButton>
          <UiButton variant="primary" class="px-4 py-2 rounded-lg text-sm font-semibold text-white" @click="router.push('/library')">
            生成新素材
          </UiButton>
        </div>
      </div>

      <div v-if="!user && isAuthReady" class="glass-card rounded-2xl border border-white/70 p-8">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600">
            <i class="ph-bold ph-sparkle text-2xl"></i>
          </div>
          <div>
            <div class="text-lg font-extrabold text-slate-900 mb-1">登录后解锁每日推荐</div>
            <div class="text-slate-600 text-sm mb-4">推荐会根据你的 AI 生成习惯与播放记录动态更新。</div>
            <UiButton variant="primary" class="px-5 py-2 rounded-xl text-sm font-semibold text-white" @click="router.push('/login')">
              立即登录
            </UiButton>
          </div>
        </div>
      </div>

      <div v-else class="glass-card rounded-2xl border border-white/70 overflow-hidden">
        <div class="px-4 sm:px-6 py-4 border-b border-slate-200/70 flex items-center justify-between bg-white/40">
          <div class="text-sm text-slate-600 font-semibold">日期：{{ dateLabel || '—' }}</div>
          <div class="text-xs text-slate-500 font-semibold">共 {{ items.length }} 首/个</div>
        </div>

        <div v-if="loading" class="p-6 space-y-4">
          <div v-for="i in 6" :key="i" class="h-20 rounded-xl skeleton"></div>
        </div>

        <div v-else-if="errorMsg" class="p-6 text-rose-700 text-sm font-semibold">
          {{ errorMsg }}
        </div>

        <div v-else-if="!hasItems" class="p-8 text-center text-slate-500">
          暂无推荐，尝试播放一些音乐或生成 AI 素材后再来看看。
        </div>

        <div v-else class="divide-y divide-slate-200/70">
          <div
            v-for="entry in items"
            :key="entry.item.id"
            class="px-4 sm:px-6 py-4 flex flex-col md:flex-row md:items-center gap-4 hover:bg-white/35 transition"
          >
            <div class="flex items-center gap-4 flex-1">
              <div
                class="w-14 h-14 rounded-2xl border border-white/70 bg-white/60 overflow-hidden flex items-center justify-center text-slate-600 font-bold"
                :style="entry.item.coverUrl ? { backgroundImage: `url(${entry.item.coverUrl})`, backgroundSize: 'cover' } : {}"
              >
                <i v-if="!entry.item.coverUrl" class="ph-fill ph-music-notes-simple text-xl"></i>
              </div>
              <div class="min-w-0">
                <div class="text-sm font-extrabold text-slate-900 truncate">
                  {{ entry.item.title || '未命名作品' }}
                </div>
                <div class="text-xs text-slate-500 font-semibold mt-1">
                  {{ entry.item.artistName || (entry.item.source === 'community' ? '社区创作者' : '网易云音乐') }}
                </div>
                <div class="mt-2 flex flex-wrap gap-2">
                  <span
                    v-for="tag in (entry.reasonTags || []).slice(0, 3)"
                    :key="tag"
                    class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/60 border border-white/70 text-slate-600"
                  >
                    {{ tag }}
                  </span>
                  <span
                    v-for="tag in (entry.item.styleTags || []).slice(0, 3)"
                    :key="`style-${tag}`"
                    class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/10 border border-sky-500/20 text-sky-700"
                  >
                    {{ tag }}
                  </span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-3">
                  <span
                    class="px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-emerald-500/10 border border-emerald-500/20 text-emerald-700"
                  >
                    社区作品
                  </span>
                  <UiButton
                    variant="primary"
                    class="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                    @click="openItem(entry)"
                  >
                    <i class="ph-bold ph-arrow-up-right"></i>
                    查看
                  </UiButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
