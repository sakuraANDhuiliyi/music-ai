<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { authFetch, useUser } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';
import UserHoverCard from '../components/UserHoverCard.vue';

const route = useRoute();
const router = useRouter();
const { user } = useUser();

const input = ref('');
const filter = ref('all'); // all | projects | users

const projects = ref([]);
const users = ref([]);
const isLoading = ref(false);
const error = ref('');

const q = computed(() => String(route.query.q || '').trim());

const coverFallback = () => 'linear-gradient(135deg,rgba(56,189,248,0.32),rgba(99,102,241,0.22))';

const totalCount = computed(() => projects.value.length + users.value.length);

const showProjects = computed(() => filter.value === 'all' || filter.value === 'projects');
const showUsers = computed(() => filter.value === 'all' || filter.value === 'users');

const submit = () => {
  const next = input.value.trim();
  router.replace({ name: 'Search', query: next ? { q: next } : {} });
};

const clear = () => {
  input.value = '';
  router.replace({ name: 'Search', query: {} });
};

const goProject = (project) => {
  if (!project?.id) return;
  router.push({ name: 'ProjectDetail', params: { id: project.id } });
};

const startChat = (targetUser) => {
  if (!user.value) return router.push('/login');
  const peerId = targetUser?.uid;
  if (!peerId) return;
  if (String(peerId) === String(user.value.uid)) return;
  router.push({ name: 'Notifications', query: { tab: 'chat', peer: peerId } });
};

const fetchSearch = async (query) => {
  const needle = String(query || '').trim();
  projects.value = [];
  users.value = [];
  error.value = '';

  if (!needle) return;

  isLoading.value = true;
  try {
    const res = await authFetch(`/api/search?q=${encodeURIComponent(needle)}&limit=24`);
    if (!res.ok) throw new Error('search failed');
    const data = await res.json();
    projects.value = Array.isArray(data.projects) ? data.projects : [];
    users.value = Array.isArray(data.users) ? data.users : [];
  } catch (e) {
    error.value = '搜索失败，请稍后重试';
  } finally {
    isLoading.value = false;
  }
};

watch(
  () => q.value,
  (val) => {
    input.value = val;
    fetchSearch(val);
  },
  { immediate: true }
);
</script>

<template>
  <div class="min-h-screen pt-24 pb-16 px-4">
    <div class="max-w-6xl mx-auto">
      <div v-reveal class="glass-card rounded-2xl p-5 md:p-6 border border-white/70">
        <div class="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
          <div class="flex-1">
            <div class="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <i class="ph-bold ph-magnifying-glass text-sky-600"></i>
              搜索
              <span v-if="q" class="text-sm font-semibold text-slate-500">（{{ totalCount }} 条结果）</span>
            </div>
            <div class="text-xs text-slate-500 font-semibold mt-1">支持搜索作品标题、标签，以及用户昵称/简介</div>
          </div>

          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div class="relative">
              <i class="ph-bold ph-magnifying-glass absolute left-3 top-3 text-slate-500"></i>
              <input
                v-model="input"
                type="text"
                class="w-full sm:w-[360px] input-glass rounded-xl py-2.5 pl-10 pr-10 text-sm"
                placeholder="搜索作品 / 用户..."
                @keyup.enter="submit"
              />
              <button
                v-if="input"
                type="button"
                class="absolute right-2 top-2 w-7 h-7 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white/60 transition"
                @click="clear"
                aria-label="清空"
              >
                <i class="ph-bold ph-x"></i>
              </button>
            </div>

            <UiButton variant="primary" class="px-5 py-2.5 rounded-xl text-white font-semibold" @click="submit">
              搜索
            </UiButton>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border transition"
            :class="filter === 'all' ? 'bg-sky-500/10 text-sky-700 border-sky-500/20' : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/55 hover:text-slate-900'"
            @click="filter = 'all'"
          >
            全部
          </button>
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border transition"
            :class="filter === 'projects' ? 'bg-sky-500/10 text-sky-700 border-sky-500/20' : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/55 hover:text-slate-900'"
            @click="filter = 'projects'"
          >
            作品（{{ projects.length }}）
          </button>
          <button
            class="px-3 py-2 rounded-xl text-xs font-semibold border transition"
            :class="filter === 'users' ? 'bg-sky-500/10 text-sky-700 border-sky-500/20' : 'bg-white/40 text-slate-600 border-transparent hover:bg-white/55 hover:text-slate-900'"
            @click="filter = 'users'"
          >
            用户（{{ users.length }}）
          </button>
        </div>
      </div>

      <div v-if="!q && !isLoading" class="mt-10 text-center text-slate-600">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/60 border border-white/70 shadow-[0_18px_45px_-40px_rgba(2,132,199,0.55)]">
          <i class="ph-duotone ph-magnifying-glass text-3xl text-sky-700"></i>
        </div>
        <div class="mt-3 font-extrabold text-slate-900">输入关键词开始搜索</div>
        <div class="text-sm text-slate-500 font-semibold mt-1">例如：Pop、电子、Muse、AI</div>
      </div>

      <div v-else class="mt-6 space-y-8">
        <div v-if="error" class="glass-card rounded-2xl p-4 border border-rose-500/20 bg-rose-500/10 text-rose-700 text-sm font-semibold flex items-center gap-2">
          <i class="ph-bold ph-warning-circle"></i>
          {{ error }}
        </div>

        <div v-if="isLoading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div v-for="n in 9" :key="n" class="glass-card rounded-2xl overflow-hidden">
            <div class="h-28 skeleton"></div>
            <div class="p-5 space-y-2">
              <div class="h-4 skeleton rounded"></div>
              <div class="h-3 skeleton rounded w-2/3"></div>
            </div>
          </div>
        </div>

        <div v-else>
          <section v-if="showProjects" class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                <i class="ph-bold ph-music-notes text-sky-600"></i>
                作品
              </div>
              <div class="text-xs text-slate-500 font-semibold" v-if="q">共 {{ projects.length }} 条</div>
            </div>

            <div v-if="projects.length" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div
                v-for="p in projects"
                :key="p.id"
                class="glass-card rounded-2xl overflow-hidden cursor-pointer border border-white/70 hover:border-sky-200 transition"
                @click="goProject(p)"
              >
                <div class="h-28" :style="{ background: p.cover || coverFallback() }"></div>
                <div class="p-5">
                  <div class="font-extrabold text-slate-900 truncate">{{ p.title }}</div>
                  <div class="flex items-center justify-between gap-3 mt-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <UserHoverCard :user="p.author || { username: '未知用户' }" class="shrink-0">
                        <img
                          v-if="p.author?.avatar"
                          :src="p.author.avatar"
                          class="w-7 h-7 rounded-full object-cover border border-white/70 cursor-pointer hover:border-sky-200 transition"
                          @click.stop="startChat(p.author)"
                        />
                        <div
                          v-else
                          class="w-7 h-7 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-[10px] text-white font-bold border border-white/70 cursor-pointer hover:shadow-[0_18px_45px_-30px_rgba(2,132,199,0.7)] transition"
                          @click.stop="startChat(p.author)"
                        >
                          {{ p.author?.username?.charAt(0).toUpperCase() || 'U' }}
                        </div>
                      </UserHoverCard>
                      <div class="text-xs font-semibold text-slate-700 truncate">
                        {{ p.author?.username || '未知用户' }}
                      </div>
                    </div>

                    <div class="text-[11px] text-slate-500 font-semibold shrink-0">
                      {{ p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '' }}
                    </div>
                  </div>

                  <div class="mt-3 flex items-center justify-between">
                    <div class="flex flex-wrap gap-1.5">
                      <span
                        v-for="(tag, idx) in (p.tags || []).slice(0, 3)"
                        :key="idx"
                        class="px-2 py-1 rounded-full text-[10px] font-bold bg-white/55 border border-white/70 text-slate-600"
                      >
                        {{ tag }}
                      </span>
                    </div>
                    <div class="text-xs text-slate-500 font-semibold flex items-center gap-1">
                      <i class="ph-bold ph-heart"></i>
                      {{ p.likesCount ?? (p.likes?.length || 0) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="glass-card rounded-2xl p-6 text-center text-slate-500 border border-white/70">
              <div class="font-extrabold text-slate-800">没有找到相关作品</div>
              <div class="text-sm font-semibold mt-1">试试换个关键词或搜索标签</div>
            </div>
          </section>

          <section v-if="showUsers" class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                <i class="ph-bold ph-users text-sky-600"></i>
                用户
              </div>
              <div class="text-xs text-slate-500 font-semibold" v-if="q">共 {{ users.length }} 条</div>
            </div>

            <div v-if="users.length" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div v-for="u in users" :key="u.uid" class="glass-card rounded-2xl p-5 border border-white/70">
                <div class="flex items-start gap-3">
                  <UserHoverCard :user="u" class="shrink-0">
                    <img
                      v-if="u.avatar"
                      :src="u.avatar"
                      class="w-12 h-12 rounded-full object-cover border border-white/70 cursor-pointer hover:border-sky-200 transition"
                      @click.stop="startChat(u)"
                    />
                    <div
                      v-else
                      class="w-12 h-12 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white text-lg font-extrabold border border-white/70 cursor-pointer hover:shadow-[0_18px_45px_-30px_rgba(2,132,199,0.7)] transition"
                      @click.stop="startChat(u)"
                    >
                      {{ u.username?.charAt(0).toUpperCase() || 'U' }}
                    </div>
                  </UserHoverCard>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-3">
                      <div class="font-extrabold text-slate-900 truncate">{{ u.username }}</div>
                      <UiButton
                        v-if="user && String(user.uid) !== String(u.uid)"
                        variant="secondary"
                        class="px-3 py-2 rounded-xl text-xs font-semibold"
                        @click.stop="startChat(u)"
                      >
                        <i class="ph-bold ph-chat-circle-text"></i>
                        私聊
                      </UiButton>
                    </div>
                    <div class="mt-1 text-sm text-slate-600 clamp-2">
                      {{ u.bio || '这个用户还没有简介～' }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="glass-card rounded-2xl p-6 text-center text-slate-500 border border-white/70">
              <div class="font-extrabold text-slate-800">没有找到相关用户</div>
              <div class="text-sm font-semibold mt-1">试试搜索昵称或简介关键词</div>
            </div>
          </section>
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
