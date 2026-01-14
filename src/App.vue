<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Navbar from './components/Navbar.vue';
import LoadingOverlay from './components/LoadingOverlay.vue';
import AuroraBackground from './components/AuroraBackground.vue';
import MusicPlayer from '@/components/Music/index.vue';
import { useLoader } from './composables/useLoader.js';
const route = useRoute();
const { isLoading } = useLoader();
const showNavbar = computed(() => route.name !== 'Studio');
</script>
<template>
  <div class="app-container font-sans min-h-screen text-slate-900">
    <AuroraBackground />
    <LoadingOverlay :show="isLoading" />

    <Navbar v-if="showNavbar" />

    <main :class="showNavbar ? 'pt-16' : ''">
      <router-view v-slot="{ Component, route: r }">
        <transition name="page" mode="out-in">
          <component :is="Component" :key="r.fullPath" />
        </transition>
      </router-view>
    </main>
    <MusicPlayer />
  </div>
</template>
