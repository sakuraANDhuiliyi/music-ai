<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUser } from '../composables/useUser.js';
import UiButton from '../components/UiButton.vue';

const props = defineProps(['initialType']);
const router = useRouter();

const { user, isAuthReady, login, register, error, isLoading } = useUser();

const type = ref('login'); // login | register
const formData = ref({
  username: '',
  email: '',
  password: '',
});

onMounted(() => {
  if (props.initialType) type.value = props.initialType;
});

const hasToken = computed(() => {
  try {
    return typeof window !== 'undefined' && Boolean(localStorage.getItem('token'));
  } catch {
    return false;
  }
});

const isRestoring = computed(() => hasToken.value && !isAuthReady.value);

watch(
  () => ({ ready: isAuthReady.value, uid: user.value?.uid }),
  ({ ready, uid }) => {
    if (!ready) return;
    if (!uid) return;
    router.replace('/studio');
  },
  { immediate: true }
);

const toggleType = () => {
  type.value = type.value === 'login' ? 'register' : 'login';
  if (error) error.value = null;
};

const handleSubmit = async () => {
  if (!formData.value.email || !formData.value.password) {
    alert('请填写邮箱和密码');
    return;
  }

  if (type.value === 'register') {
    if (!formData.value.username) {
      alert('注册时请填写用户名');
      return;
    }
    await register({
      email: formData.value.email,
      password: formData.value.password,
      username: formData.value.username,
    });
    return;
  }

  await login({
    email: formData.value.email,
    password: formData.value.password,
  });
};
</script>

<template>
  <div class="page pb-12 flex items-center justify-center relative overflow-hidden">
    <UiButton
      v-reveal
      @click="router.push('/')"
      variant="ghost"
      class="fixed top-20 left-4 sm:left-6 lg:left-8 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold z-20 transition"
    >
      <i class="ph-bold ph-house"></i>
      回到首页
    </UiButton>

    <div class="absolute top-[-10%] left-[-10%] w-[520px] h-[520px] bg-sky-400/20 rounded-full blur-[120px]"></div>
    <div class="absolute bottom-[-10%] right-[-10%] w-[520px] h-[520px] bg-indigo-400/20 rounded-full blur-[120px]"></div>

    <div v-reveal class="w-full max-w-md glass-card border border-white/70 p-8 rounded-2xl shadow-2xl relative z-10">
      <div class="text-center mb-8">
        <h2 class="text-3xl font-extrabold text-slate-900 mb-2">
          {{ type === 'login' ? '欢迎回来' : '加入 MuseAI' }}
        </h2>
        <p class="text-slate-600">
          {{ type === 'login' ? '继续你的音乐创作之旅' : '开始与 AI 协作创作音乐' }}
        </p>
      </div>

      <div v-if="isRestoring" class="py-10 text-center text-slate-600">
        <i class="ph-bold ph-spinner animate-spin text-3xl text-sky-600"></i>
        <p class="mt-3 font-semibold">正在恢复登录状态</p>
        <p class="text-xs text-slate-500 mt-1">请稍后...</p>
      </div>

      <div
        v-if="!isRestoring && error"
        class="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-700 text-sm flex items-center gap-2"
      >
        <i class="ph-bold ph-warning-circle"></i>
        {{ error }}
      </div>

      <form v-if="!isRestoring" @submit.prevent="handleSubmit" class="space-y-4">
        <div v-if="type === 'register'" class="relative">
          <i class="ph-bold ph-user absolute left-3 top-3.5 text-slate-500"></i>
          <input
            v-model="formData.username"
            type="text"
            placeholder="用户名"
            class="w-full input-glass rounded-xl py-3 pl-10 pr-4 text-sm"
          />
        </div>

        <div class="relative">
          <i class="ph-bold ph-envelope absolute left-3 top-3.5 text-slate-500"></i>
          <input v-model="formData.email" type="email" placeholder="电子邮箱" class="w-full input-glass rounded-xl py-3 pl-10 pr-4 text-sm" />
        </div>

        <div class="relative">
          <i class="ph-bold ph-lock absolute left-3 top-3.5 text-slate-500"></i>
          <input
            v-model="formData.password"
            type="password"
            placeholder="密码"
            class="w-full input-glass rounded-xl py-3 pl-10 pr-4 text-sm"
          />
        </div>

        <UiButton
          :disabled="isLoading"
          type="submit"
          variant="primary"
          class="w-full text-white font-semibold py-3 rounded-xl transition transform hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <i v-if="isLoading" class="ph-bold ph-spinner animate-spin"></i>
          {{ isLoading ? '处理中...' : type === 'login' ? '立即登录' : '创建账户' }}
        </UiButton>
      </form>

      <div v-if="!isRestoring" class="mt-6 text-center">
        <p class="text-slate-600 text-sm">
          {{ type === 'login' ? '还没有账号？' : '已有账号？' }}
          <button @click="toggleType" type="button" class="ml-2 text-sky-700 hover:text-sky-600 font-semibold">
            {{ type === 'login' ? '免费注册' : '直接登录' }}
          </button>
        </p>
      </div>
    </div>
  </div>
</template>
