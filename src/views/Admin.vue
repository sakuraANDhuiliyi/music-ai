<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';
import { authFetch, useUser } from '../composables/useUser.js';

const router = useRouter();
const { user, isAuthReady } = useUser();

const isSuperAdmin = computed(() => user.value?.role === 'superadmin');
const isAdminLike = computed(() => user.value?.role === 'admin' || user.value?.role === 'superadmin');

const currentTab = ref('dashboard');
const stats = ref({ userCount: 0, projectCount: 0, commentCount: 0 });
const lists = ref({
  users: [],
  admins: [],
  allUsers: [],
  projects: [],
  comments: [],
});

const isLoading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const searchText = ref('');

const clearMessages = () => {
  errorMessage.value = '';
  successMessage.value = '';
};

const formatDate = (value) => {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
};

const roleBadge = (role) => {
  const r = String(role || 'user');
  if (r === 'superadmin') return { label: 'Super Admin', cls: 'bg-slate-900 text-white' };
  if (r === 'admin') return { label: 'Admin', cls: 'bg-gradient-to-r from-teal-500 to-amber-500 text-white' };
  return { label: 'User', cls: 'bg-white/60 text-slate-700 border border-white/70' };
};

const canEditRole = computed(() => isSuperAdmin.value);

const filteredRows = computed(() => {
  const tab = currentTab.value;
  const q = String(searchText.value || '').trim().toLowerCase();
  const raw =
    tab === 'users'
      ? lists.value.users
      : tab === 'admins'
        ? lists.value.admins
        : tab === 'allUsers'
          ? lists.value.allUsers
          : tab === 'projects'
            ? lists.value.projects
            : tab === 'comments'
              ? lists.value.comments
              : [];

  if (!q) return raw;

  const pick = (obj, keys) =>
    keys
      .map((k) => String(obj?.[k] || ''))
      .join(' ')
      .toLowerCase();

  if (tab === 'projects') return raw.filter((x) => pick(x, ['title']).includes(q) || pick(x?.author, ['username', 'email']).includes(q));
  if (tab === 'comments') return raw.filter((x) => pick(x, ['content']).includes(q) || pick(x?.author, ['username']).includes(q));
  return raw.filter((x) => pick(x, ['username', 'email', 'role']).includes(q));
});

const fetchStats = async () => {
  const res = await authFetch('/api/admin/stats');
  if (!res.ok) throw new Error('获取统计失败');
  stats.value = await res.json();
};

const fetchList = async (type) => {
  const endpoint =
    type === 'users'
      ? '/api/admin/users'
      : type === 'admins'
        ? '/api/admin/admins'
        : type === 'allUsers'
          ? '/api/admin/users/all'
          : type === 'projects'
            ? '/api/admin/projects'
            : type === 'comments'
              ? '/api/admin/comments'
              : null;

  if (!endpoint) return;
  const res = await authFetch(endpoint);
  if (!res.ok) throw new Error('获取列表失败');
  const data = await res.json();
  lists.value[type] = Array.isArray(data) ? data : [];
};

const refreshCurrent = async () => {
  clearMessages();
  if (!isAdminLike.value) return;
  isLoading.value = true;
  try {
    if (currentTab.value === 'dashboard') {
      await fetchStats();
    } else {
      await fetchList(currentTab.value);
    }
  } catch (e) {
    errorMessage.value = e?.message || '刷新失败';
  } finally {
    isLoading.value = false;
  }
};

const goTab = async (tab) => {
  clearMessages();
  searchText.value = '';
  currentTab.value = tab;
  await refreshCurrent();
};

// ===== 用户/管理员 CRUD（超级管理员可管理管理员；管理员仅管理普通用户） =====
const editorOpen = ref(false);
const editorMode = ref('create'); // create | edit
const editorTitle = ref('');
const editorTargetId = ref(null);
const editorForm = ref({
  email: '',
  username: '',
  password: '',
  role: 'user',
  avatar: '',
  bio: '',
});

const openCreate = (defaultRole = 'user') => {
  clearMessages();
  editorMode.value = 'create';
  editorTitle.value = defaultRole === 'admin' ? '创建管理员账号' : '创建用户账号';
  editorTargetId.value = null;
  editorForm.value = {
    email: '',
    username: '',
    password: '',
    role: defaultRole,
    avatar: '',
    bio: '',
  };
  editorOpen.value = true;
};

const openEdit = (row) => {
  clearMessages();
  editorMode.value = 'edit';
  editorTitle.value = '编辑账号';
  editorTargetId.value = row?.uid || null;
  editorForm.value = {
    email: row?.email || '',
    username: row?.username || '',
    password: '',
    role: row?.role || 'user',
    avatar: row?.avatar || '',
    bio: row?.bio || '',
  };
  editorOpen.value = true;
};

const closeEditor = () => {
  editorOpen.value = false;
};

const saveUser = async () => {
  clearMessages();
  isLoading.value = true;
  try {
    const payload = {
      email: editorForm.value.email,
      username: editorForm.value.username,
      avatar: editorForm.value.avatar,
      bio: editorForm.value.bio,
    };
    if (editorMode.value === 'create') payload.password = editorForm.value.password;
    if (editorMode.value === 'edit' && editorForm.value.password) payload.password = editorForm.value.password;
    if (canEditRole.value) payload.role = editorForm.value.role;

    const res =
      editorMode.value === 'create'
        ? await authFetch('/api/admin/users', { method: 'POST', body: JSON.stringify({ ...payload, role: editorForm.value.role }) })
        : await authFetch(`/api/admin/users/${editorTargetId.value}`, { method: 'PUT', body: JSON.stringify(payload) });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || '保存失败');

    successMessage.value = editorMode.value === 'create' ? '创建成功' : '保存成功';
    closeEditor();

    // 刷新相关列表
    if (currentTab.value === 'users') await fetchList('users');
    if (currentTab.value === 'admins') await fetchList('admins');
    if (currentTab.value === 'allUsers') await fetchList('allUsers');
    // 角色变更可能影响其他列表
    if (isSuperAdmin.value) {
      if (currentTab.value !== 'admins') await fetchList('admins').catch(() => {});
      if (currentTab.value !== 'allUsers') await fetchList('allUsers').catch(() => {});
    }
    await fetchStats().catch(() => {});
  } catch (e) {
    errorMessage.value = e?.message || '保存失败';
  } finally {
    isLoading.value = false;
  }
};

const deleteUser = async (row) => {
  clearMessages();
  const id = row?.uid;
  if (!id) return;
  const name = row?.username || row?.email || '该账号';
  if (!confirm(`确定删除 ${name} 吗？此操作不可恢复。`)) return;

  isLoading.value = true;
  try {
    const res = await authFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || '删除失败');

    successMessage.value = '删除成功';
    // 刷新相关列表
    if (currentTab.value === 'users') await fetchList('users');
    if (currentTab.value === 'admins') await fetchList('admins');
    if (currentTab.value === 'allUsers') await fetchList('allUsers');
    await fetchStats().catch(() => {});
  } catch (e) {
    errorMessage.value = e?.message || '删除失败';
  } finally {
    isLoading.value = false;
  }
};

const deleteProject = async (row) => {
  clearMessages();
  const id = row?.id;
  if (!id) return;
  if (!confirm('确定删除该作品吗？此操作不可恢复。')) return;
  isLoading.value = true;
  try {
    const res = await authFetch(`/api/admin/projects/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || '删除失败');
    successMessage.value = '删除成功';
    await fetchList('projects');
    await fetchStats().catch(() => {});
  } catch (e) {
    errorMessage.value = e?.message || '删除失败';
  } finally {
    isLoading.value = false;
  }
};

const deleteComment = async (row) => {
  clearMessages();
  const id = row?.id;
  if (!id) return;
  if (!confirm('确定删除该评论吗？此操作不可恢复。')) return;
  isLoading.value = true;
  try {
    const res = await authFetch(`/api/admin/comments/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || '删除失败');
    successMessage.value = '删除成功';
    await fetchList('comments');
    await fetchStats().catch(() => {});
  } catch (e) {
    errorMessage.value = e?.message || '删除失败';
  } finally {
    isLoading.value = false;
  }
};

const resetPassword = async (row) => {
  clearMessages();
  const id = row?.uid;
  if (!id) return;

  const label = row?.username || row?.email || '该账号';
  if (!confirm(`确定重置 ${label} 的密码吗？系统会生成一个临时密码。`)) return;

  isLoading.value = true;
  try {
    const res = await authFetch(`/api/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || '重置失败');

    const pwd = String(data?.password || '').trim();
    successMessage.value = '已重置密码（临时密码已弹窗显示）';
    if (pwd) {
      try {
        await navigator.clipboard.writeText(pwd);
        successMessage.value = '已重置密码（临时密码已复制到剪贴板）';
      } catch {
        // ignore
      }
      alert(`新的临时密码：${pwd}`);
    }
  } catch (e) {
    errorMessage.value = e?.message || '重置失败';
  } finally {
    isLoading.value = false;
  }
};

watch(
  () => ({ ready: isAuthReady.value, uid: user.value?.uid, role: user.value?.role }),
  async ({ ready }) => {
    if (!ready) return;
    if (!user.value) {
      router.replace('/login');
      return;
    }
    if (!isAdminLike.value) {
      router.replace('/');
      return;
    }
    await refreshCurrent();
  },
  { immediate: true }
);
</script>

<template>
  <div class="page pb-16" v-if="isAdminLike">
    <div class="page-container space-y-6">
      <section class="hero-surface px-6 sm:px-10 py-9 sm:py-11">
        <div class="hero-grid"></div>
        <div class="hero-wave"></div>
        <div class="grain-overlay"></div>

        <div class="relative z-10 flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
          <div>
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 border border-white/70 text-xs font-semibold text-slate-700">
              <i class="ph-bold ph-shield-check text-teal-700"></i>
              管理后台
            </div>
            <h1 class="mt-3 font-display text-3xl sm:text-4xl font-extrabold text-slate-900 leading-tight">系统管理</h1>
            <p class="mt-2 text-slate-600 text-sm sm:text-base leading-relaxed">
              当前账号：
              <span class="font-semibold text-slate-900">{{ user?.username }}</span>
              <span class="mx-2 text-slate-400">·</span>
              <span class="inline-flex items-center gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full" :class="roleBadge(user?.role).cls">{{ roleBadge(user?.role).label }}</span>
              </span>
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <UiButton variant="secondary" class="px-5 py-2.5 rounded-full text-sm font-semibold" @click="refreshCurrent" :disabled="isLoading">
              <i class="ph-bold ph-arrows-clockwise"></i>
              刷新
            </UiButton>
            <UiButton variant="primary" class="px-5 py-2.5 rounded-full text-sm font-semibold text-white" @click="router.push('/')" :disabled="isLoading">
              <i class="ph-bold ph-house"></i>
              返回首页
            </UiButton>
          </div>
        </div>
      </section>

      <section class="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-6 items-start">
        <aside class="glass-card rounded-3xl border border-white/70 p-5">
          <div class="flex items-center justify-between">
            <div class="text-sm font-extrabold text-slate-900">功能</div>
            <div class="text-xs text-slate-500 font-semibold">RBAC</div>
          </div>

          <div class="mt-4 space-y-2">
            <button
              type="button"
              class="w-full text-left px-4 py-3 rounded-2xl border border-white/70 transition flex items-center gap-3"
              :class="currentTab === 'dashboard' ? 'bg-gradient-to-r from-teal-500 to-amber-500 text-white' : 'bg-white/55 hover:bg-white/70 text-slate-700'"
              @click="goTab('dashboard')"
            >
              <i class="ph-bold ph-squares-four"></i> 仪表盘
            </button>

            <button
              type="button"
              class="w-full text-left px-4 py-3 rounded-2xl border border-white/70 transition flex items-center gap-3"
              :class="currentTab === 'users' ? 'bg-gradient-to-r from-teal-500 to-amber-500 text-white' : 'bg-white/55 hover:bg-white/70 text-slate-700'"
              @click="goTab('users')"
            >
              <i class="ph-bold ph-users"></i> 普通用户
            </button>

            <button
              v-if="isSuperAdmin"
              type="button"
              class="w-full text-left px-4 py-3 rounded-2xl border border-white/70 transition flex items-center gap-3"
              :class="currentTab === 'admins' ? 'bg-gradient-to-r from-teal-500 to-amber-500 text-white' : 'bg-white/55 hover:bg-white/70 text-slate-700'"
              @click="goTab('admins')"
            >
              <i class="ph-bold ph-user-gear"></i> 管理员账号
            </button>

            <button
              v-if="isSuperAdmin"
              type="button"
              class="w-full text-left px-4 py-3 rounded-2xl border border-white/70 transition flex items-center gap-3"
              :class="currentTab === 'allUsers' ? 'bg-gradient-to-r from-teal-500 to-amber-500 text-white' : 'bg-white/55 hover:bg-white/70 text-slate-700'"
              @click="goTab('allUsers')"
            >
              <i class="ph-bold ph-database"></i> 所有注册信息
            </button>

            <button
              type="button"
              class="w-full text-left px-4 py-3 rounded-2xl border border-white/70 transition flex items-center gap-3"
              :class="currentTab === 'projects' ? 'bg-gradient-to-r from-teal-500 to-amber-500 text-white' : 'bg-white/55 hover:bg-white/70 text-slate-700'"
              @click="goTab('projects')"
            >
              <i class="ph-bold ph-music-notes"></i> 作品管理
            </button>

            <button
              type="button"
              class="w-full text-left px-4 py-3 rounded-2xl border border-white/70 transition flex items-center gap-3"
              :class="currentTab === 'comments' ? 'bg-gradient-to-r from-teal-500 to-amber-500 text-white' : 'bg-white/55 hover:bg-white/70 text-slate-700'"
              @click="goTab('comments')"
            >
              <i class="ph-bold ph-chat-text"></i> 评论管理
            </button>
          </div>
        </aside>

        <main class="glass-card rounded-3xl border border-white/70 p-6">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div class="text-xs font-semibold text-slate-500">当前模块</div>
              <h2 class="mt-1 text-xl font-extrabold text-slate-900">
                <template v-if="currentTab === 'dashboard'">仪表盘</template>
                <template v-else-if="currentTab === 'users'">普通用户管理</template>
                <template v-else-if="currentTab === 'admins'">管理员账号管理</template>
                <template v-else-if="currentTab === 'allUsers'">所有用户注册信息</template>
                <template v-else-if="currentTab === 'projects'">作品管理</template>
                <template v-else>评论管理</template>
              </h2>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <div v-if="currentTab !== 'dashboard'" class="relative">
                <i class="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input
                  v-model="searchText"
                  type="text"
                  placeholder="搜索（用户名/邮箱/标题/内容）"
                  class="pl-9 pr-3 py-2 rounded-full border border-white/70 bg-white/70 text-sm font-semibold text-slate-700 w-64 max-w-[70vw] outline-none focus:ring-4 focus:ring-teal-300/30"
                />
              </div>

              <UiButton
                v-if="currentTab === 'users'"
                variant="primary"
                class="px-4 py-2 rounded-full text-sm font-semibold text-white"
                @click="openCreate('user')"
                :disabled="isLoading"
              >
                <i class="ph-bold ph-user-plus"></i>
                新建用户
              </UiButton>

              <UiButton
                v-if="currentTab === 'admins' && isSuperAdmin"
                variant="primary"
                class="px-4 py-2 rounded-full text-sm font-semibold text-white"
                @click="openCreate('admin')"
                :disabled="isLoading"
              >
                <i class="ph-bold ph-user-plus"></i>
                新建管理员
              </UiButton>
            </div>
          </div>

          <div v-if="errorMessage" class="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-semibold">
            {{ errorMessage }}
          </div>
          <div v-if="successMessage" class="mt-4 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700 font-semibold">
            {{ successMessage }}
          </div>

          <div class="mt-6">
            <div v-if="currentTab === 'dashboard'" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="rounded-3xl border border-white/70 bg-white/65 p-5">
                <div class="text-xs font-semibold text-slate-500">用户总数</div>
                <div class="mt-2 text-3xl font-extrabold text-slate-900 font-display">{{ stats.userCount }}</div>
              </div>
              <div class="rounded-3xl border border-white/70 bg-white/65 p-5">
                <div class="text-xs font-semibold text-slate-500">作品总数</div>
                <div class="mt-2 text-3xl font-extrabold text-slate-900 font-display">{{ stats.projectCount }}</div>
              </div>
              <div class="rounded-3xl border border-white/70 bg-white/65 p-5">
                <div class="text-xs font-semibold text-slate-500">评论总数</div>
                <div class="mt-2 text-3xl font-extrabold text-slate-900 font-display">{{ stats.commentCount }}</div>
              </div>
            </div>

            <div v-else class="overflow-x-auto rounded-3xl border border-white/70 bg-white/55">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="text-slate-600 bg-white/65 text-xs font-semibold">
                    <th class="py-4 px-5">主要信息</th>
                    <th class="py-4 px-5">详情</th>
                    <th class="py-4 px-5">创建时间</th>
                    <th class="py-4 px-5 text-right">操作</th>
                  </tr>
                </thead>

                <tbody class="text-slate-700 text-sm">
                  <tr v-if="isLoading">
                    <td colspan="4" class="py-14 text-center text-slate-600">
                      <i class="ph-bold ph-spinner animate-spin text-2xl"></i>
                      <div class="mt-2 font-semibold">加载中…</div>
                    </td>
                  </tr>

                  <template v-else-if="filteredRows.length">
                    <tr v-for="row in filteredRows" :key="row.uid || row.id" class="border-t border-white/70 hover:bg-white/70 transition">
                      <td class="py-4 px-5">
                        <div v-if="currentTab === 'projects'" class="space-y-1">
                          <div class="font-extrabold text-slate-900">{{ row.title }}</div>
                          <div class="text-xs text-slate-500 font-semibold">
                            作者：{{ row.author?.username || '未知用户' }}
                            <span v-if="row.author?.email" class="mx-1 text-slate-300">·</span>
                            <span v-if="row.author?.email">{{ row.author.email }}</span>
                          </div>
                        </div>
                        <div v-else-if="currentTab === 'comments'" class="space-y-1">
                          <div class="max-w-[560px] truncate italic">“{{ row.content }}”</div>
                          <div class="text-xs text-slate-500 font-semibold">
                            {{ row.author?.username || '未知用户' }}
                            <span class="mx-1 text-slate-300">·</span>
                            《{{ row.project?.title || '未知作品' }}》
                          </div>
                        </div>
                        <div v-else class="flex items-center gap-3">
                          <div class="w-9 h-9 rounded-full bg-white/55 border border-white/70 overflow-hidden flex items-center justify-center text-xs font-extrabold text-white shadow-sm">
                            <img v-if="row.avatar" :src="row.avatar" class="w-full h-full object-cover" />
                            <span v-else class="w-full h-full bg-gradient-to-tr from-teal-400 to-amber-500 flex items-center justify-center">
                              {{ String(row.username || '?').charAt(0).toUpperCase() }}
                            </span>
                          </div>
                          <div>
                            <div class="font-extrabold text-slate-900 flex items-center gap-2">
                              {{ row.username }}
                              <span class="text-[10px] px-2 py-0.5 rounded-full" :class="roleBadge(row.role).cls">{{ roleBadge(row.role).label }}</span>
                            </div>
                            <div class="text-xs text-slate-500 font-semibold">{{ row.email }}</div>
                          </div>
                        </div>
                      </td>

                      <td class="py-4 px-5 text-slate-700">
                        <div v-if="currentTab === 'projects'" class="text-xs text-slate-500 font-semibold">ID：{{ String(row.id).slice(-8) }}</div>
                        <div v-else-if="currentTab === 'comments'" class="text-xs text-slate-500 font-semibold">ID：{{ String(row.id).slice(-8) }}</div>
                        <div v-else class="space-y-1">
                          <div v-if="row.bio" class="text-xs text-slate-600 max-w-[520px] truncate">简介：{{ row.bio }}</div>
                          <div v-else class="text-xs text-slate-400">暂无简介</div>
                        </div>
                      </td>

                      <td class="py-4 px-5 text-xs text-slate-500 font-semibold">
                        {{ formatDate(row.createdAt) }}
                      </td>

                      <td class="py-4 px-5">
                        <div class="flex items-center justify-end gap-2">
                          <button
                            v-if="currentTab === 'users' || currentTab === 'admins' || currentTab === 'allUsers'"
                            class="px-3 py-1.5 rounded-xl border border-white/70 bg-white/65 hover:bg-white/80 text-xs font-semibold text-slate-700 transition"
                            @click="openEdit(row)"
                            :disabled="row.role === 'superadmin'"
                            :class="row.role === 'superadmin' ? 'opacity-40 cursor-not-allowed' : ''"
                          >
                            <i class="ph-bold ph-pencil-simple"></i>
                            编辑
                          </button>

                          <button
                            v-if="currentTab === 'users' || currentTab === 'admins' || currentTab === 'allUsers'"
                            class="px-3 py-1.5 rounded-xl border border-white/70 bg-white/65 hover:bg-white/80 text-xs font-semibold text-slate-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                            @click="resetPassword(row)"
                            :disabled="row.role === 'superadmin' || (row.role === 'admin' && !isSuperAdmin)"
                          >
                            <i class="ph-bold ph-key"></i>
                            重置密码
                          </button>

                          <button
                            v-if="currentTab === 'projects'"
                            class="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white transition"
                            @click="deleteProject(row)"
                          >
                            <i class="ph-bold ph-trash"></i>
                            删除
                          </button>

                          <button
                            v-else-if="currentTab === 'comments'"
                            class="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white transition"
                            @click="deleteComment(row)"
                          >
                            <i class="ph-bold ph-trash"></i>
                            删除
                          </button>

                          <button
                            v-else
                            class="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                            @click="deleteUser(row)"
                            :disabled="row.role === 'superadmin' || (row.role === 'admin' && !isSuperAdmin)"
                          >
                            <i class="ph-bold ph-trash"></i>
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  </template>

                  <tr v-else>
                    <td colspan="4" class="py-16 text-center text-slate-500">
                      <i class="ph-duotone ph-folder-dashed text-3xl"></i>
                      <div class="mt-2 font-semibold">暂无数据</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </section>
    </div>

    <!-- 编辑/创建弹窗 -->
    <div v-if="editorOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" @click="closeEditor"></div>

      <div class="relative w-full max-w-xl rounded-3xl border border-white/70 bg-white/85 shadow-2xl p-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-xs font-semibold text-slate-500">账号管理</div>
            <h3 class="mt-1 text-lg font-extrabold text-slate-900">{{ editorTitle }}</h3>
            <p class="mt-1 text-xs text-slate-500 font-semibold">
              <template v-if="editorMode === 'create'">创建时必须填写密码。</template>
              <template v-else>不填密码表示不修改密码。</template>
            </p>
          </div>
          <button class="w-10 h-10 rounded-full bg-white/70 border border-white/70 text-slate-600 hover:bg-white transition" @click="closeEditor">
            <i class="ph-bold ph-x"></i>
          </button>
        </div>

        <div class="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1">
            <div class="text-xs font-semibold text-slate-500">邮箱</div>
            <input
              v-model="editorForm.email"
              type="email"
              class="w-full px-4 py-2.5 rounded-2xl border border-white/70 bg-white/70 text-sm font-semibold text-slate-700 outline-none focus:ring-4 focus:ring-teal-300/30"
              placeholder="user@example.com"
              autocomplete="off"
            />
          </div>

          <div class="space-y-1">
            <div class="text-xs font-semibold text-slate-500">用户名</div>
            <input
              v-model="editorForm.username"
              type="text"
              class="w-full px-4 py-2.5 rounded-2xl border border-white/70 bg-white/70 text-sm font-semibold text-slate-700 outline-none focus:ring-4 focus:ring-teal-300/30"
              placeholder="昵称"
              autocomplete="off"
            />
          </div>

          <div class="space-y-1">
            <div class="text-xs font-semibold text-slate-500">密码</div>
            <input
              v-model="editorForm.password"
              type="text"
              class="w-full px-4 py-2.5 rounded-2xl border border-white/70 bg-white/70 text-sm font-semibold text-slate-700 outline-none focus:ring-4 focus:ring-teal-300/30"
              placeholder="创建必填 / 编辑可留空"
              autocomplete="off"
            />
          </div>

          <div class="space-y-1">
            <div class="text-xs font-semibold text-slate-500">角色</div>
            <select
              v-model="editorForm.role"
              class="w-full px-4 py-2.5 rounded-2xl border border-white/70 bg-white/70 text-sm font-semibold text-slate-700 outline-none focus:ring-4 focus:ring-teal-300/30"
              :disabled="!canEditRole"
              :class="!canEditRole ? 'opacity-60 cursor-not-allowed' : ''"
            >
              <option value="user">普通用户</option>
              <option value="admin" v-if="isSuperAdmin">管理员</option>
            </select>
            <div v-if="!canEditRole" class="text-[11px] text-slate-400 font-semibold">仅超级管理员可修改角色</div>
          </div>

          <div class="space-y-1 sm:col-span-2">
            <div class="text-xs font-semibold text-slate-500">头像 URL（可选）</div>
            <input
              v-model="editorForm.avatar"
              type="text"
              class="w-full px-4 py-2.5 rounded-2xl border border-white/70 bg-white/70 text-sm font-semibold text-slate-700 outline-none focus:ring-4 focus:ring-teal-300/30"
              placeholder="https://..."
              autocomplete="off"
            />
          </div>

          <div class="space-y-1 sm:col-span-2">
            <div class="text-xs font-semibold text-slate-500">简介（可选）</div>
            <textarea
              v-model="editorForm.bio"
              rows="3"
              class="w-full px-4 py-2.5 rounded-2xl border border-white/70 bg-white/70 text-sm font-semibold text-slate-700 outline-none focus:ring-4 focus:ring-teal-300/30 resize-none"
              placeholder="一句话简介"
            />
          </div>
        </div>

        <div class="mt-6 flex items-center justify-end gap-3">
          <UiButton variant="secondary" class="px-5 py-2.5 rounded-full text-sm font-semibold" @click="closeEditor" :disabled="isLoading">
            取消
          </UiButton>
          <UiButton variant="primary" class="px-5 py-2.5 rounded-full text-sm font-semibold text-white" @click="saveUser" :disabled="isLoading">
            <i class="ph-bold ph-floppy-disk"></i>
            保存
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
