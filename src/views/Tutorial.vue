<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';
import SoundLab from '../components/Tutorial/SoundLab.vue';
import DualViewTranslator from '../components/Tutorial/DualViewTranslator.vue';
import PulseReactor from '../components/Tutorial/PulseReactor.vue';
import StepSequencer from '../components/Tutorial/StepSequencer.vue';
import IntervalTrainer from '../components/Tutorial/IntervalTrainer.vue';
import MiniPiano from '../components/Tutorial/MiniPiano.vue';
import ChordTrainer from '../components/Tutorial/ChordTrainer.vue';
import ProgressionBuilder from '../components/Tutorial/ProgressionBuilder.vue';
import ChordColorLab from '../components/Tutorial/ChordColorLab.vue';
import ReharmonizerLab from '../components/Tutorial/ReharmonizerLab.vue';
import { tutorialChapters, tutorialLevels } from '../data/tutorialData.js';

const route = useRoute();
const router = useRouter();

const slug = computed(() => String(route.params?.slug || tutorialChapters[0].slug).trim() || tutorialChapters[0].slug);
const currentChapter = computed(() => tutorialChapters.find((item) => item.slug === slug.value) || tutorialChapters[0]);

const chaptersByLevel = computed(() => {
  return tutorialLevels.map((level) => ({
    ...level,
    chapters: tutorialChapters.filter((chapter) => chapter.level === level.key),
  }));
});

const componentMap = {
  'sound-lab': SoundLab,
  'dual-view-translator': DualViewTranslator,
  'pulse-reactor': PulseReactor,
  'step-sequencer': StepSequencer,
  'interval-trainer': IntervalTrainer,
  'mini-piano': MiniPiano,
  'chord-trainer': ChordTrainer,
  'progression-builder': ProgressionBuilder,
  'chord-color-lab': ChordColorLab,
  'reharmonizer-lab': ReharmonizerLab,
};

const goToChapter = (key) => router.push(`/tutorial/${key}`);

const currentIndex = computed(() => tutorialChapters.findIndex((item) => item.slug === currentChapter.value.slug));
const prevChapter = computed(() => tutorialChapters[currentIndex.value - 1] || null);
const nextChapter = computed(() => tutorialChapters[currentIndex.value + 1] || null);
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
              {{ currentChapter.title }}
            </h1>
            <p class="mt-3 text-slate-600 text-sm sm:text-base leading-relaxed">
              {{ currentChapter.summary }}
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

      <section class="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-6 items-start">
        <aside class="glass-card rounded-3xl border border-white/70 p-5">
          <div class="flex items-center justify-between">
            <div class="text-sm font-extrabold text-slate-900">目录</div>
            <div class="text-xs text-slate-500 font-semibold">共 {{ tutorialChapters.length }} 篇</div>
          </div>

          <div class="mt-4 space-y-4">
            <div v-for="group in chaptersByLevel" :key="group.key" class="space-y-2">
              <div class="text-xs font-semibold text-slate-500">{{ group.label }}</div>
              <button
                v-for="item in group.chapters"
                :key="item.slug"
                type="button"
                class="w-full text-left px-4 py-3 rounded-2xl border border-white/70 bg-white/55 hover:bg-white/70 transition"
                :class="item.slug === slug ? 'ring-4 ring-teal-300/25' : ''"
                @click="goToChapter(item.slug)"
              >
                <div class="text-sm font-extrabold text-slate-900">{{ item.title }}</div>
                <div class="mt-1 text-xs text-slate-500 font-semibold leading-snug">{{ item.summary }}</div>
              </button>
            </div>
          </div>
        </aside>

        <main class="glass-card rounded-3xl border border-white/70 p-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xs font-semibold text-slate-500">本章目标</div>
              <h2 class="mt-2 text-xl font-extrabold text-slate-900">你将学会什么</h2>
            </div>
            <div class="text-xs text-slate-500 font-semibold">建议结合 Studio 实践</div>
          </div>

          <div class="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div
              v-for="goal in currentChapter.goals"
              :key="goal"
              class="rounded-2xl border border-white/70 bg-white/60 p-4"
            >
              <div class="text-sm font-extrabold text-slate-900">{{ goal }}</div>
              <div class="mt-2 text-xs text-slate-500 font-semibold">建议：在 Studio 里对应操作一次</div>
            </div>
          </div>

          <div class="mt-8 space-y-8">
            <section v-for="section in currentChapter.sections" :key="section.title" class="space-y-3">
              <h3 class="text-lg font-extrabold text-slate-900">{{ section.title }}</h3>
              <div class="space-y-3 text-sm text-slate-600 leading-relaxed">
                <p v-for="(p, idx) in section.paragraphs" :key="`${section.title}-p-${idx}`">{{ p }}</p>
                <ul v-if="section.bullets" class="list-disc pl-5 space-y-1">
                  <li v-for="(b, idx) in section.bullets" :key="`${section.title}-b-${idx}`">{{ b }}</li>
                </ul>
              </div>

              <div v-if="section.widget" class="mt-4 rounded-3xl border border-white/70 bg-white/70 p-4">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="text-sm font-extrabold text-slate-900">{{ section.widget.title }}</div>
                    <div v-if="section.widget.description" class="mt-1 text-xs text-slate-500 font-semibold">
                      {{ section.widget.description }}
                    </div>
                  </div>
                  <div class="text-xs text-slate-400 font-semibold">交互实验</div>
                </div>

                <div class="mt-4">
                  <component
                    :is="componentMap[section.widget.type]"
                    v-if="componentMap[section.widget.type]"
                    v-bind="section.widget.props"
                  />
                </div>
              </div>
            </section>

          </div>

          <div class="mt-8 flex flex-wrap items-center justify-between gap-3">
            <UiButton
              v-if="prevChapter"
              variant="secondary"
              class="px-5 py-2 rounded-full text-sm font-semibold"
              @click="goToChapter(prevChapter.slug)"
            >
              <i class="ph-bold ph-arrow-left"></i>
              上一章：{{ prevChapter.title }}
            </UiButton>
            <UiButton
              v-if="nextChapter"
              variant="primary"
              class="px-5 py-2 rounded-full text-sm font-semibold text-white"
              @click="goToChapter(nextChapter.slug)"
            >
              下一章：{{ nextChapter.title }}
              <i class="ph-bold ph-arrow-right"></i>
            </UiButton>
          </div>
        </main>
      </section>
    </div>
  </div>
</template>
