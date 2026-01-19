<script setup>
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUser, authFetch } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';
import { notifyError } from '../utils/requestFeedback.js';

const router = useRouter();
const { user, isAuthReady, updateProfile, isLoading, error, successMessage } = useUser();

// 引用隐藏的文件输入框
const fileInput = ref(null);
const isUploading = ref(false);

const form = ref({
  username: '',
  email: '',
  bio: '',
  avatar: ''
});

// 填充表单数据
const fillForm = () => {
  if (user.value) {
    form.value = {
      username: user.value.username || '',
      email: user.value.email || '',
      bio: user.value.bio || '',
      avatar: user.value.avatar || ''
    };
  }
};

// 等待鉴权完成再判断，避免刷新时出现错误跳转/闪屏
watch(
  () => ({ ready: isAuthReady.value, uid: user.value?.uid }),
  ({ ready, uid }) => {
    if (!ready) return;
    if (!uid) return router.push('/login');
    fillForm();
  },
  { immediate: true }
);

const triggerFileInput = () => {
  fileInput.value.click();
};

// 处理头像上传
const handleFileChange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  // 1. 校验文件类型
  if (!file.type.startsWith('image/')) {
    alert('请上传图片文件');
    return;
  }

  isUploading.value = true;
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await authFetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    // 检查响应内容类型是否为 JSON
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      // 如果后端报错（比如413文件太大）返回的不是JSON，这里会捕获到
      const text = await response.text();
      throw new Error(`上传失败: ${response.status} ${text}`);
    }

    const data = await response.json();

    if (response.ok) {
      // 上传成功，更新本地预览
      form.value.avatar = data.url;
    } else {
      throw new Error(data.message || '上传失败');
    }
  } catch (e) {
    notifyError(`头像上传出错: ${e?.message || '操作失败'}`);
  } finally {
    isUploading.value = false;
    // 清空 input，否则选同一张图片不会触发 change 事件
    event.target.value = '';
  }
};

// 保存个人资料
const handleSave = async () => {
  // updateProfile 内部已经使用了 authFetch，会自动处理 Token
  await updateProfile({
    username: form.value.username,
    bio: form.value.bio,
    avatar: form.value.avatar
  });
};
</script>

<template>
  <div class="page pb-12">
    <div class="page-container max-w-2xl">
      <div class="flex items-center gap-4 mb-8">
        <UiButton @click="router.back()" variant="ghost" class="px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-semibold transition">
          <i class="ph-bold ph-arrow-left"></i> 返回
        </UiButton>
        <h1 class="text-2xl font-extrabold text-slate-900">个人设置</h1>
      </div>

      <div class="glass-card border border-white/70 rounded-2xl p-8 shadow-xl">

        <div class="flex items-center gap-6 mb-8 pb-8 border-b border-slate-200/70">
          <div class="w-20 h-20 rounded-full bg-white/60 border border-white/70 backdrop-blur-xl flex items-center justify-center overflow-hidden shadow-lg relative group">
            <img v-if="form.avatar" :src="form.avatar" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full bg-gradient-to-tr from-teal-400 to-amber-500 flex items-center justify-center text-white text-3xl font-extrabold">
              {{ form.username ? form.username.charAt(0).toUpperCase() : 'U' }}
            </div>
            <div v-if="isUploading" class="absolute inset-0 bg-black/50 flex items-center justify-center">
              <i class="ph-bold ph-spinner animate-spin text-white"></i>
            </div>
          </div>

          <div>
            <h3 class="text-lg font-extrabold text-slate-900">头像</h3>
            <p class="text-slate-600 text-sm mb-3">支持 JPG, PNG 格式，最大 5MB</p>
            <input type="file" ref="fileInput" class="hidden" accept="image/*" @change="handleFileChange"/>
            <UiButton @click="triggerFileInput" :disabled="isUploading" variant="secondary" class="px-4 py-2 text-sm font-semibold rounded-lg transition flex items-center gap-2 disabled:opacity-60">
              <i class="ph-bold ph-upload-simple"></i>
              {{ isUploading ? '上传中...' : '更改头像' }}
            </UiButton>
          </div>
        </div>

        <form @submit.prevent="handleSave" class="space-y-6">
          <div v-if="successMessage" class="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 rounded-lg text-sm flex items-center gap-2 animate-fade-in">
            <i class="ph-fill ph-check-circle"></i> {{ successMessage }}
          </div>
          <div v-if="error" class="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-700 rounded-lg text-sm flex items-center gap-2 animate-fade-in">
            <i class="ph-fill ph-warning"></i> {{ error }}
          </div>

          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-2">用户名</label>
            <div class="relative">
              <i class="ph-bold ph-user absolute left-3 top-3.5 text-slate-500"></i>
              <input v-model="form.username" type="text" class="w-full input-glass rounded-xl py-3 pl-10 pr-4 text-sm"/>
            </div>
          </div>

          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-2">电子邮箱</label>
            <div class="relative">
              <i class="ph-bold ph-envelope absolute left-3 top-3.5 text-slate-500"></i>
              <input v-model="form.email" type="email" disabled class="w-full bg-white/45 border border-white/60 rounded-xl py-3 pl-10 pr-4 text-slate-500 cursor-not-allowed backdrop-blur-xl"/>
            </div>
            <p class="text-xs text-slate-600 mt-1 pl-1">邮箱地址暂不支持修改</p>
          </div>

          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-2">个人简介</label>
            <textarea v-model="form.bio" rows="4" class="w-full input-glass rounded-xl px-4 py-3 text-sm resize-none"></textarea>
          </div>

          <div class="pt-4 flex justify-end border-t border-slate-200/70 mt-8">
            <UiButton type="submit" :disabled="isLoading" variant="primary" class="px-8 py-3 text-white font-semibold rounded-xl transition flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-teal-500/20">
              <i v-if="isLoading" class="ph-bold ph-spinner animate-spin"></i>
              {{ isLoading ? '保存中...' : '保存修改' }}
            </UiButton>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s ease-in-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
