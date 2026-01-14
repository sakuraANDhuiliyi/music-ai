<script setup>
import { useRouter } from 'vue-router';
import ParticleTitle from '../components/ParticleTitle.vue';
import UiButton from '../components/UiButton.vue';
const router = useRouter();

const features = [
  { icon: 'ph-fill ph-lightning', color: '#facc15', title: "智能旋律续写", desc: "卡壳了？输入几个音符，AI 帮你补全剩下的旋律。" },
  { icon: 'ph-fill ph-stack', color: '#818cf8', title: "风格迁移", desc: "一键将你的钢琴曲转换成赛博朋克或爵士风格。" },
  { icon: 'ph-bold ph-git-fork', color: '#f472b6', title: "社区协同 (Fork)", desc: "发现好的作品？Fork 它，并在此基础上进行二次创作。" }
];
</script>

<template>
  <div class="page pb-20">
    <div class="page-container">
      <div class="flex flex-col items-center justify-center text-center gap-6">
        <div class="w-full flex justify-center">
          <ParticleTitle text="MuseAI" :density="3" :radius="110" class="max-w-full" />
        </div>
        <p class="text-slate-600 text-lg">音乐创作与分享</p>

        <div class="mt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
          <UiButton @click="router.push('/studio')" variant="primary" class="px-8 py-4 rounded-full font-semibold text-lg flex items-center gap-2">
            开始创作 <i class="ph-bold ph-arrow-right"></i>
          </UiButton>
          <UiButton @click="router.push('/explore')" variant="secondary" class="px-8 py-4 rounded-full font-semibold text-lg">
            探索社区作品
          </UiButton>
        </div>
      </div>

      <div class="mt-12 sm:mt-20">
        <div class="grid md:grid-cols-3 gap-5 sm:gap-8">
          <div v-for="(feature, idx) in features" :key="idx" v-reveal class="glass-card p-6 sm:p-8 rounded-2xl">
            <div class="w-12 h-12 rounded-xl bg-white/70 border border-white/70 backdrop-blur-xl flex items-center justify-center mb-6 transition text-2xl shadow-[0_18px_45px_-40px_rgba(2,132,199,0.8)]">
              <i :class="feature.icon" :style="{color: feature.color}"></i>
            </div>
            <h3 class="text-xl font-bold mb-3 text-slate-900">{{ feature.title }}</h3>
            <p class="text-slate-600 leading-relaxed">{{ feature.desc }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
