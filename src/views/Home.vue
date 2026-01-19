<script setup>
import { useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';

const router = useRouter();

const goToStudio = () => router.push('/studio');
const goToExplore = () => router.push('/explore');

const toolCards = [
  {
    title: 'AI 和弦编配',
    desc: '输入灵感，快速得到主歌/副歌和弦走向，适合起稿。',
    to: '/ai-chord',
    icon: 'ph-bold ph-magic-wand',
    gradient: 'linear-gradient(140deg, rgba(34,199,184,0.18), rgba(245,178,74,0.22))',
  },
  {
    title: '音频转谱',
    desc: '上传音频，自动生成可编辑谱面与音符信息。',
    to: '/audio-to-sheet',
    icon: 'ph-bold ph-waveform',
    gradient: 'linear-gradient(140deg, rgba(245,178,74,0.16), rgba(240,106,90,0.22))',
  },
  {
    title: '虚拟乐器',
    desc: '即开即弹，键盘/鼓垫轻量上手，灵感快速落地。',
    to: '/piano',
    icon: 'ph-bold ph-piano-keys',
    gradient: 'linear-gradient(140deg, rgba(34,199,184,0.16), rgba(17,20,24,0.08))',
  },
  {
    title: '协同 Studio',
    desc: '工程实时协作与版本管理，把创作变成团队旅程。',
    to: '/studio',
    icon: 'ph-bold ph-users-three',
    gradient: 'linear-gradient(140deg, rgba(240,106,90,0.16), rgba(245,178,74,0.22))',
  },
];

const communityPicks = [
  { title: 'Midnight Bloom', tag: 'Lo-fi', author: 'Ariadne', cover: 'linear-gradient(130deg,#f6d365,#fda085)' },
  { title: 'Echo Drift', tag: 'Synthwave', author: 'Orbit', cover: 'linear-gradient(130deg,#8fd3f4,#84fab0)' },
  { title: 'Amber Pulse', tag: 'Pop', author: 'Yuzu', cover: 'linear-gradient(130deg,#fbc2eb,#a6c1ee)' },
];

const quickSteps = [
  { title: '选择灵感', desc: '挑选曲风或输入关键词，建立创作方向。' },
  { title: '生成草稿', desc: '用 AI 生成和弦/旋律，快速搭建骨架。' },
  { title: '精修混音', desc: '在多轨编辑器里细化结构和声音层次。' },
];
</script>

<template>
  <div class="page pb-16">
    <div class="page-container space-y-16">
      <section class="hero-surface px-6 sm:px-10 py-10 sm:py-14">
        <div class="hero-grid"></div>
        <div class="hero-wave"></div>
        <div class="grain-overlay"></div>

        <div class="relative z-10 grid grid-cols-1 lg:grid-cols-[1.2fr,1fr] gap-10 items-center">
          <div class="space-y-6">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 border border-white/70 text-xs font-semibold text-slate-700">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              AI 创作 Studio · 多轨协作
            </div>
            <h1 class="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 leading-tight">
              让灵感在 30 秒内落地
            </h1>
            <p class="text-slate-600 text-base sm:text-lg leading-relaxed max-w-xl">
              MuseAI 结合 AI 生成与专业多轨编辑，快速完成从灵感到成品的完整音乐旅程。
            </p>
            <div class="flex flex-wrap items-center gap-3">
              <UiButton variant="primary" class="px-6 py-3 rounded-full text-sm font-semibold text-white" @click="goToStudio">
                立即进入 Studio
              </UiButton>
              <UiButton variant="secondary" class="px-6 py-3 rounded-full text-sm font-semibold" @click="goToExplore">
                体验社区 Demo
              </UiButton>
            </div>
            <div class="flex items-center gap-6 text-xs font-semibold text-slate-500">
              <span>无乐器门槛</span>
              <span>Web 端即开即用</span>
              <span>多轨协作/版本管理</span>
            </div>
          </div>

          <div class="glass-card rounded-3xl border border-white/70 p-6">
            <div class="flex items-center justify-between">
              <div class="text-sm font-extrabold text-slate-900">创作能量</div>
              <div class="text-xs text-slate-500 font-semibold">实时波形</div>
            </div>
            <div class="mt-6 wave-bars">
              <div v-for="n in 12" :key="n" class="wave-bar" :style="{ height: `${40 + (n % 5) * 12}px` }"></div>
            </div>
            <div class="mt-6 grid grid-cols-3 gap-3 text-center">
              <div class="rounded-2xl bg-white/70 border border-white/70 py-3">
                <div class="text-lg font-extrabold text-slate-900">32</div>
                <div class="text-[11px] text-slate-500 font-semibold">轨道模板</div>
              </div>
              <div class="rounded-2xl bg-white/70 border border-white/70 py-3">
                <div class="text-lg font-extrabold text-slate-900">1.2k</div>
                <div class="text-[11px] text-slate-500 font-semibold">社区作品</div>
              </div>
              <div class="rounded-2xl bg-white/70 border border-white/70 py-3">
                <div class="text-lg font-extrabold text-slate-900">4</div>
                <div class="text-[11px] text-slate-500 font-semibold">AI 助手</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="grid grid-cols-1 lg:grid-cols-[1fr,1.2fr] gap-8 items-center">
        <div class="space-y-4">
          <div class="text-xs font-semibold text-slate-500">快速体验</div>
          <h2 class="font-display text-3xl font-extrabold text-slate-900">点击几下，立刻听到灵感</h2>
          <p class="text-slate-600">借鉴 Chrome Music Lab 的轻量互动，让新手也能快速生成一段旋律。</p>
          <div class="flex items-center gap-3">
            <UiButton variant="primary" class="px-5 py-2.5 rounded-full text-sm font-semibold text-white" @click="goToStudio">
              进入创作
            </UiButton>
            <UiButton variant="ghost" class="px-4 py-2 rounded-full text-sm font-semibold" @click="goToExplore">
              查看示例工程
            </UiButton>
          </div>
        </div>
        <div class="glass-card rounded-3xl border border-white/70 p-6">
          <div class="grid grid-cols-8 gap-2">
            <div v-for="n in 32" :key="n" class="h-10 rounded-xl border border-white/70 bg-white/60 hover:bg-amber-100/60 transition"></div>
          </div>
          <div class="mt-4 flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Step Sequencer</span>
            <span>Tap to preview</span>
          </div>
        </div>
      </section>

      <section>
        <div class="flex items-center justify-between gap-4 mb-6">
          <div>
            <div class="text-xs font-semibold text-slate-500">AI 工具箱</div>
            <h2 class="font-display text-3xl font-extrabold text-slate-900">把复杂功能做成清晰模块</h2>
          </div>
          <UiButton variant="secondary" class="px-4 py-2 rounded-full text-sm font-semibold" @click="goToExplore">
            发现更多
          </UiButton>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <button
            v-for="card in toolCards"
            :key="card.title"
            type="button"
            class="glass-card rounded-3xl border border-white/70 p-6 text-left group"
            @click="router.push(card.to)"
          >
            <div class="w-12 h-12 rounded-2xl border border-white/70 bg-white/80 flex items-center justify-center text-slate-700">
              <i :class="card.icon" class="text-xl"></i>
            </div>
            <div class="mt-4">
              <div class="text-lg font-extrabold text-slate-900">{{ card.title }}</div>
              <div class="text-sm text-slate-600 mt-2 leading-relaxed">{{ card.desc }}</div>
            </div>
            <div class="mt-4 h-12 rounded-2xl" :style="{ background: card.gradient }"></div>
            <div class="mt-4 text-xs font-semibold text-slate-500 group-hover:text-teal-700 transition">
              立即体验 →
            </div>
          </button>
        </div>
      </section>

      <section class="grid grid-cols-1 lg:grid-cols-[1.2fr,1fr] gap-8 items-center">
        <div class="glass-card rounded-3xl border border-white/70 p-6">
          <div class="text-xs font-semibold text-slate-500">社区精选</div>
          <div class="mt-4 space-y-4">
            <div
              v-for="item in communityPicks"
              :key="item.title"
              class="rounded-2xl border border-white/70 bg-white/70 p-4 flex items-center gap-4"
            >
              <div class="w-14 h-14 rounded-2xl" :style="{ background: item.cover }"></div>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-extrabold text-slate-900 truncate">{{ item.title }}</div>
                <div class="text-xs text-slate-500 font-semibold mt-1">{{ item.author }} · {{ item.tag }}</div>
              </div>
              <div class="text-xs font-semibold text-teal-700">试听</div>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <div class="text-xs font-semibold text-slate-500">协作创作</div>
          <h2 class="font-display text-3xl font-extrabold text-slate-900">实时协作，随时 Fork</h2>
          <p class="text-slate-600">灵感通过动态流转，支持一键 Fork 和评论互动，社区即工作室。</p>
          <div class="flex items-center gap-3">
            <UiButton variant="primary" class="px-5 py-2.5 rounded-full text-sm font-semibold text-white" @click="goToExplore">
              进入社区
            </UiButton>
            <UiButton variant="ghost" class="px-4 py-2 rounded-full text-sm font-semibold" @click="goToStudio">
              创建协作工程
            </UiButton>
          </div>
        </div>
      </section>

      <section class="glass-card rounded-3xl border border-white/70 p-8">
        <div class="text-xs font-semibold text-slate-500">新手引导</div>
        <h2 class="font-display text-3xl font-extrabold text-slate-900 mt-2">三步完成你的第一首歌</h2>
        <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div v-for="step in quickSteps" :key="step.title" class="rounded-2xl border border-white/70 bg-white/70 p-5">
            <div class="text-sm font-extrabold text-slate-900">{{ step.title }}</div>
            <div class="text-sm text-slate-600 mt-2 leading-relaxed">{{ step.desc }}</div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
