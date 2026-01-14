<script setup>
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
// 引入 authFetch 用于发送带 Token 的请求
import { useUser, authFetch } from '../composables/useUser.js';

const router = useRouter();
const { user, isAuthReady } = useUser();

// 当前选中的标签页
const currentTab = ref('dashboard'); // 可选值: dashboard, users, projects, comments
const stats = ref({ userCount: 0, projectCount: 0, commentCount: 0 });
const dataList = ref([]);
const isLoading = ref(false);
const hasLoadedStats = ref(false);

// 等待鉴权完成后再判断权限，避免未加载完成就被错误重定向
watch(
  () => ({ ready: isAuthReady.value, role: user.value?.role }),
  ({ ready, role }) => {
    if (!ready) return;
    if (!user.value) {
      alert('请先登录');
      router.push('/login');
      return;
    }
    if (role !== 'admin') {
      alert('无权访问：你不是管理员');
      router.push('/');
      return;
    }
    if (!hasLoadedStats.value) {
      fetchStats();
      hasLoadedStats.value = true;
    }
  },
  { immediate: true }
);

// 获取仪表盘统计
const fetchStats = async () => {
  try {
    const res = await authFetch('/api/admin/stats');
    if (res.ok) {
      stats.value = await res.json();
    }
  } catch (e) {
    console.error("获取统计失败", e);
  }
};

// 获取列表数据 (用户/作品/评论)
const fetchData = async (type) => {
  currentTab.value = type;
  isLoading.value = true;
  dataList.value = [];

  try {
    const res = await authFetch(`/api/admin/${type}`);
    if (res.ok) {
      dataList.value = await res.json();
    } else {
      console.error('获取列表失败');
    }
  } catch (e) {
    console.error(e);
  } finally {
    isLoading.value = false;
  }
};

// 删除通用函数
const deleteItem = async (id, type) => {
  if (!confirm('确定要永久删除吗？此操作不可恢复。')) return;

  try {
    const res = await authFetch(`/api/admin/${type}/${id}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      // 从本地列表中移除该项，避免重新请求
      dataList.value = dataList.value.filter(item => (item.id || item.uid) !== id);
      // 刷新统计数据
      fetchStats();
    } else {
      alert('删除失败');
    }
  } catch (e) {
    alert('操作出错');
    console.error(e);
  }
};

const formatDate = (str) => new Date(str).toLocaleString();
</script>

<template>
  <div class="page pb-10">
    <div class="page-container flex flex-col lg:flex-row gap-6">

    <aside class="w-full lg:w-64 glass-card border border-white/70 rounded-xl p-4 h-fit shrink-0 shadow-lg">
      <h2 class="text-xl font-extrabold text-slate-900 mb-6 px-4 flex items-center gap-2">
        <i class="ph-fill ph-shield-check text-sky-600"></i> 管理后台
      </h2>
      <nav class="space-y-2">
        <button
            @click="currentTab = 'dashboard'"
            :class="currentTab === 'dashboard' ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-[0_18px_45px_-35px_rgba(2,132,199,0.7)]' : 'text-slate-700 hover:bg-white/40 hover:text-slate-900'"
            class="w-full text-left px-4 py-3 rounded-lg transition font-medium flex items-center gap-3"
        >
          <i class="ph-bold ph-squares-four"></i> 仪表盘
        </button>
        <button
            @click="fetchData('users')"
            :class="currentTab === 'users' ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-[0_18px_45px_-35px_rgba(2,132,199,0.7)]' : 'text-slate-700 hover:bg-white/40 hover:text-slate-900'"
            class="w-full text-left px-4 py-3 rounded-lg transition font-medium flex items-center gap-3"
        >
          <i class="ph-bold ph-users"></i> 用户管理
        </button>
        <button
            @click="fetchData('projects')"
            :class="currentTab === 'projects' ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-[0_18px_45px_-35px_rgba(2,132,199,0.7)]' : 'text-slate-700 hover:bg-white/40 hover:text-slate-900'"
            class="w-full text-left px-4 py-3 rounded-lg transition font-medium flex items-center gap-3"
        >
          <i class="ph-bold ph-music-notes"></i> 作品管理
        </button>
        <button
            @click="fetchData('comments')"
            :class="currentTab === 'comments' ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-[0_18px_45px_-35px_rgba(2,132,199,0.7)]' : 'text-slate-700 hover:bg-white/40 hover:text-slate-900'"
            class="w-full text-left px-4 py-3 rounded-lg transition font-medium flex items-center gap-3"
        >
          <i class="ph-bold ph-chat-text"></i> 评论管理
        </button>
      </nav>
    </aside>

    <main class="flex-1 glass-card border border-white/70 rounded-xl p-4 sm:p-6 lg:p-8 min-h-[420px] sm:min-h-[600px] shadow-lg">

      <div v-if="currentTab === 'dashboard'" class="animate-fade-in">
        <h3 class="text-2xl font-extrabold text-slate-900 mb-6">数据概览</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="relative overflow-hidden bg-gradient-to-br from-sky-500/15 to-indigo-500/10 border border-white/70 p-6 rounded-xl hover:scale-[1.02] transition duration-300">
            <div class="text-sky-700 mb-2 font-semibold">总用户数</div>
            <div class="text-5xl font-extrabold text-slate-900">{{ stats.userCount }}</div>
            <i class="ph-duotone ph-users text-sky-500/20 absolute -top-3 -right-2 text-7xl"></i>
          </div>
          <div class="relative overflow-hidden bg-gradient-to-br from-indigo-500/12 to-cyan-500/10 border border-white/70 p-6 rounded-xl hover:scale-[1.02] transition duration-300">
            <div class="text-indigo-700 mb-2 font-semibold">作品总数</div>
            <div class="text-5xl font-extrabold text-slate-900">{{ stats.projectCount }}</div>
            <i class="ph-duotone ph-music-notes text-indigo-500/18 absolute -top-3 -right-2 text-7xl"></i>
          </div>
          <div class="relative overflow-hidden bg-gradient-to-br from-cyan-500/12 to-sky-500/10 border border-white/70 p-6 rounded-xl hover:scale-[1.02] transition duration-300">
            <div class="text-cyan-700 mb-2 font-semibold">评论总数</div>
            <div class="text-5xl font-extrabold text-slate-900">{{ stats.commentCount }}</div>
            <i class="ph-duotone ph-chat-centered-text text-cyan-500/18 absolute -top-3 -right-2 text-7xl"></i>
          </div>
        </div>
      </div>

      <div v-else class="animate-fade-in">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-2xl font-extrabold text-slate-900 capitalize">
            {{ currentTab === 'users' ? '用户列表' : (currentTab === 'projects' ? '作品列表' : '评论列表') }}
          </h3>
          <span class="text-slate-600 text-sm bg-white/55 px-3 py-1 rounded-full border border-white/70 backdrop-blur-xl font-semibold">
            共 {{ dataList.length }} 条数据
          </span>
        </div>

        <div v-if="isLoading" class="text-center py-20 text-slate-600">
          <i class="ph-bold ph-spinner animate-spin text-3xl"></i>
          <p class="mt-2 font-semibold">加载数据中...</p>
        </div>

        <div v-else class="overflow-x-auto rounded-lg border border-slate-200/70 bg-white/15">
          <table class="w-full text-left border-collapse">
            <thead>
            <tr class="text-slate-600 bg-white/45 text-sm font-semibold">
              <th class="py-4 px-6 font-medium">ID</th>
              <th class="py-4 px-6 font-medium">主要信息</th>
              <th class="py-4 px-6 font-medium">详细信息</th>
              <th class="py-4 px-6 font-medium">创建时间</th>
              <th class="py-4 px-6 font-medium text-right">操作</th>
            </tr>
            </thead>
            <tbody class="text-slate-700 text-sm">
            <tr v-for="item in dataList" :key="item.id || item.uid" class="border-b border-slate-200/70 hover:bg-white/35 transition">

              <td class="py-4 px-6 font-mono text-xs text-slate-600">
                {{ (item.id || item.uid).slice(-6) }}
              </td>

              <td class="py-4 px-6">
                <div v-if="currentTab === 'users'" class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-white/55 border border-white/70 overflow-hidden flex items-center justify-center text-xs font-extrabold text-white shadow-sm">
                    <img v-if="item.avatar" :src="item.avatar" class="w-full h-full object-cover">
                    <span v-else class="w-full h-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center">{{ item.username.charAt(0).toUpperCase() }}</span>
                  </div>
                  <div>
                    <div class="font-extrabold text-slate-900 flex items-center gap-2">
                      {{ item.username }}
                      <span v-if="item.role==='admin'" class="bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider">Admin</span>
                    </div>
                  </div>
                </div>
                <div v-else-if="currentTab === 'projects'" class="font-extrabold text-slate-900 text-base">
                  {{ item.title }}
                </div>
                <div v-else class="max-w-xs truncate text-slate-700 italic">
                  "{{ item.content }}"
                </div>
              </td>

              <td class="py-4 px-6 text-slate-700">
                <div v-if="currentTab === 'users'">
                  <div class="flex items-center gap-1 text-xs text-slate-500 mb-0.5"><i class="ph-bold ph-envelope"></i> 邮箱</div>
                  {{ item.email }}
                </div>
                <div v-else-if="currentTab === 'projects'">
                  <div class="flex items-center gap-1 text-xs text-slate-500 mb-0.5"><i class="ph-bold ph-user"></i> 作者</div>
                  <span class="text-slate-800 font-semibold">{{ item.author?.username || '未知用户' }}</span>
                </div>
                <div v-else>
                  <div class="flex items-center gap-1 text-xs text-slate-500 mb-0.5"><i class="ph-bold ph-arrow-elbow-down-right"></i> 来源</div>
                  <span class="text-sky-700 font-semibold">{{ item.author?.username }}</span>
                  <span class="mx-1">在</span>
                  <span class="text-slate-900 font-semibold">《{{ item.project?.title || '未知作品' }}》</span>
                </div>
              </td>

              <td class="py-4 px-6 text-slate-500 text-xs">
                {{ formatDate(item.createdAt) }}
              </td>

              <td class="py-4 px-6 text-right">
                <button
                    @click="deleteItem(item.id || item.uid, currentTab)"
                    class="text-rose-700 hover:text-white hover:bg-rose-600 px-3 py-1.5 rounded-lg transition text-xs font-semibold flex items-center gap-1 ml-auto disabled:opacity-50"
                    :disabled="item.role === 'admin'"
                    :class="{'opacity-50 cursor-not-allowed': item.role === 'admin'}"
                >
                  <i class="ph-bold ph-trash"></i> 删除
                </button>
              </td>
            </tr>
            </tbody>
          </table>
          <div v-if="dataList.length === 0" class="text-center py-20 text-slate-500 flex flex-col items-center">
            <i class="ph-duotone ph-folder-dashed text-4xl mb-2"></i>
            <span class="font-semibold">暂无数据</span>
          </div>
        </div>
      </div>

    </main>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
