<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';

const route = useRoute();
const router = useRouter();

const lessons = [
  {
    key: 'prologue',
    title: '序章：认识 MuseAI',
    desc: '快速了解首页、社区与 Studio 的核心流程，建议首次使用先看本章。',
    goals: ['理解页面结构与入口', '学会创建工程', '学会保存草稿与导出'],
  },
  {
    key: 'chapter-1',
    title: '第一章：从灵感到草稿',
    desc: '从和弦/旋律出发搭建第一版结构，并使用多轨编辑器完成基础编排。',
    goals: ['快速搭建段落结构', '掌握多轨剪辑与对齐', '为后续混音留出空间'],
  },
  {
    key: 'chapter-2',
    title: '第二章：细化与混音',
    desc: '在多轨工程中进行音色选择、效果链与简单混音，让作品更“站得住”。',
    goals: ['了解常用 FX 的使用顺序', '控制响度与动态', '导出并发布到社区'],
  },
  {
    key: 'practice',
    title: '练习：跟做小项目',
    desc: '提供一套可复用的练习流程，建议边做边保存草稿，逐步形成自己的模板。',
    goals: ['完成一个 30 秒片段', '至少使用 1 个 FX', '发布并获得反馈'],
  },
];

const slug = computed(() => String(route.params?.slug || 'prologue').trim() || 'prologue');
const currentLesson = computed(() => lessons.find((item) => item.key === slug.value) || lessons[0]);

const goToLesson = (key) => router.push(`/tutorial/${key}`);
</script>

<template>
  <div class="page pb-16">
    <div class="page-container space-y-10">
      <section class="hero-surface px-6 sm:px-10 py-10 sm:py-12">
        <div class="hero-grid"></div>
        <div class="hero-wave"></div>
        <div class="grain-overlay"></div>

        <div class="relative z-10 flex flex-col lg:flex-row gap-8 items-start lg:items-center justify-between">
          <div class="max-w-2xl">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 border border-white/70 text-xs font-semibold text-slate-700">
              <i class="ph-bold ph-book-open text-teal-700"></i>
              教程中心
            </div>
            <h1 class="mt-4 font-display text-3xl sm:text-4xl font-extrabold text-slate-900 leading-tight">
              {{ currentLesson.title }}
            </h1>
            <p class="mt-3 text-slate-600 text-sm sm:text-base leading-relaxed">
              {{ currentLesson.desc }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <UiButton variant="secondary" class="px-5 py-2.5 rounded-full text-sm font-semibold" @click="router.push('/studio')">
              进入 Studio
            </UiButton>
            <UiButton variant="primary" class="px-5 py-2.5 rounded-full text-sm font-semibold text-white" @click="router.push('/explore')">
              去社区看看
            </UiButton>
          </div>
        </div>
      </section>

      <section class="grid grid-cols-1 lg:grid-cols-[300px,1fr] gap-6 items-start">
        <aside class="glass-card rounded-3xl border border-white/70 p-5">
          <div class="flex items-center justify-between">
            <div class="text-sm font-extrabold text-slate-900">目录</div>
            <div class="text-xs text-slate-500 font-semibold">共 {{ lessons.length }} 篇</div>
          </div>

          <div class="mt-4 space-y-2">
            <button
              v-for="item in lessons"
              :key="item.key"
              type="button"
              class="w-full text-left px-4 py-3 rounded-2xl border border-white/70 bg-white/55 hover:bg-white/70 transition"
              :class="item.key === slug ? 'ring-4 ring-teal-300/25' : ''"
              @click="goToLesson(item.key)"
            >
              <div class="text-sm font-extrabold text-slate-900">{{ item.title }}</div>
              <div class="mt-1 text-xs text-slate-500 font-semibold leading-snug">{{ item.desc }}</div>
            </button>
          </div>
        </aside>

        <main class="glass-card rounded-3xl border border-white/70 p-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xs font-semibold text-slate-500">本章目标</div>
              <h2 class="mt-2 text-xl font-extrabold text-slate-900">你将学会什么</h2>
            </div>
            <div class="text-xs text-slate-500 font-semibold">内容可后续逐章完善</div>
          </div>

          <div class="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div
              v-for="goal in currentLesson.goals"
              :key="goal"
              class="rounded-2xl border border-white/70 bg-white/60 p-4"
            >
              <div class="text-sm font-extrabold text-slate-900">{{ goal }}</div>
              <div class="mt-2 text-xs text-slate-500 font-semibold">建议：看完后在 Studio 里跟做一遍</div>
            </div>
          </div>

          <div class="mt-6 rounded-3xl border border-white/70 bg-white/55 p-5">
            <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <i class="ph-bold ph-info text-amber-600"></i>
              提示
            </div>
            <div class="mt-2 text-sm text-slate-600 leading-relaxed">
              这里先提供教程框架与导航结构；具体图文/视频内容你确认目录与章节命名后，我再按你的素材逐章补全。
            </div>
          </div>
        </main>
      </section>
    </div>
  </div>
</template>
