<script setup>
import { computed, useAttrs } from 'vue';

const props = defineProps({
  as: { type: String, default: 'button' },
});

const attrs = useAttrs();
const resolvedType = computed(() => {
  if (props.as !== 'button') return undefined;
  return attrs.type ?? 'button';
});
</script>

<template>
  <component :is="as" class="aurora-btn" v-bind="$attrs" :type="resolvedType">
    <slot />
  </component>
</template>

<style scoped>
.aurora-btn {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: linear-gradient(
    90deg,
    rgb(56, 189, 248),
    rgb(236, 72, 153),
    rgb(250, 204, 21),
    rgb(56, 189, 248)
  );
  background-size: 400% 100%;
  background-position: 0% 50%;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.55);
  text-shadow: 0 1px 0 rgba(2, 6, 23, 0.12);
  box-shadow:
    0 20px 55px -34px rgba(2, 132, 199, 0.72),
    0 1px 0 rgba(255, 255, 255, 0.85) inset;
  transition: transform 140ms ease, box-shadow 220ms ease, filter 220ms ease, border-color 220ms ease;
  will-change: background-position, filter, transform;
  transform: translateZ(0);
}

.aurora-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(
    120deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.55) 22%,
    rgba(255, 255, 255, 0) 46%
  );
  transform: translateX(-120%) skewX(-12deg);
  mix-blend-mode: overlay;
}

.aurora-btn:hover {
  animation: aurora-flow 7.5s linear infinite;
  transform: translateY(-1px) scale(1.01);
  filter: saturate(1.28) contrast(1.07) brightness(1.03);
  border-color: rgba(255, 255, 255, 0.7);
  box-shadow:
    0 34px 80px -44px rgba(2, 132, 199, 0.92),
    0 22px 60px -38px rgba(168, 85, 247, 0.45),
    0 1px 0 rgba(255, 255, 255, 0.9) inset;
}

.aurora-btn:hover::after {
  opacity: 0.85;
  animation: aurora-shine 1.15s ease-in-out infinite;
}

.aurora-btn:active {
  animation-duration: 10s;
  transform: translateY(0) scale(0.992);
  filter: saturate(1.18) contrast(1.04) brightness(1.02);
}

.aurora-btn:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 4px rgba(var(--accent), 0.22),
    0 34px 80px -44px rgba(2, 132, 199, 0.92);
}

@keyframes aurora-flow {
  from { background-position: 0% 50%; }
  to { background-position: 400% 50%; }
}

@keyframes aurora-shine {
  0% { transform: translateX(-120%) skewX(-12deg); }
  55% { transform: translateX(20%) skewX(-12deg); }
  100% { transform: translateX(140%) skewX(-12deg); }
}

@media (prefers-reduced-motion: reduce) {
  .aurora-btn:hover,
  .aurora-btn:active {
    animation: none !important;
    transform: none;
  }
  .aurora-btn:hover::after {
    animation: none !important;
  }
}
</style>
