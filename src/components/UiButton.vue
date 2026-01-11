<script setup>
import { computed, useAttrs } from 'vue';

const props = defineProps({
  as: { type: String, default: 'button' },
  variant: { type: String, default: 'primary' }, // primary | secondary | ghost
});

const attrs = useAttrs();
const resolvedType = computed(() => {
  if (props.as !== 'button') return undefined;
  return attrs.type ?? 'button';
});
</script>

<template>
  <component
    :is="as"
    class="ui-btn"
    :class="`ui-btn--${variant}`"
    v-bind="$attrs"
    :type="resolvedType"
  >
    <slot />
  </component>
</template>

<style scoped>
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 140ms ease,
    box-shadow 220ms ease,
    filter 220ms ease,
    background-color 220ms ease,
    border-color 220ms ease,
    color 220ms ease;
  transform: translateZ(0);
}

.ui-btn:disabled,
.ui-btn[aria-disabled='true'] {
  cursor: not-allowed;
}

.ui-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(var(--accent), 0.22);
}

.ui-btn--primary {
  background: linear-gradient(135deg, rgb(56, 189, 248), rgb(99, 102, 241));
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.65);
  box-shadow: 0 18px 45px -28px rgba(2, 132, 199, 0.75);
}
.ui-btn--primary:hover {
  transform: translateY(-1px);
  filter: saturate(1.07);
  box-shadow: 0 22px 55px -32px rgba(2, 132, 199, 0.85);
}
.ui-btn--primary:active {
  transform: translateY(0) scale(0.98);
}
.ui-btn--primary:focus-visible {
  box-shadow:
    0 0 0 4px rgba(var(--accent), 0.22),
    0 18px 45px -28px rgba(2, 132, 199, 0.75);
}

.ui-btn--secondary {
  background: rgba(255, 255, 255, 0.7);
  color: rgb(var(--fg));
  border: 1px solid rgba(148, 163, 184, 0.35);
  box-shadow: 0 14px 35px -30px rgba(2, 132, 199, 0.25);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.ui-btn--secondary:hover {
  transform: translateY(-1px);
  border-color: rgba(56, 189, 248, 0.45);
  box-shadow: 0 20px 55px -45px rgba(2, 132, 199, 0.45);
}
.ui-btn--secondary:active {
  transform: translateY(0) scale(0.98);
}
.ui-btn--secondary:focus-visible {
  box-shadow:
    0 0 0 4px rgba(var(--accent), 0.2),
    0 14px 35px -30px rgba(2, 132, 199, 0.25);
}

.ui-btn--ghost {
  color: rgba(var(--muted), 1);
  border: 1px solid transparent;
  background: transparent;
}
.ui-btn--ghost:hover {
  color: rgb(var(--fg));
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(148, 163, 184, 0.22);
}
.ui-btn--ghost:active {
  transform: scale(0.98);
}
.ui-btn--ghost:focus-visible {
  box-shadow: 0 0 0 4px rgba(var(--accent), 0.18);
}

@media (prefers-reduced-motion: reduce) {
  .ui-btn {
    transition: none;
  }
  .ui-btn--primary:hover,
  .ui-btn--secondary:hover,
  .ui-btn--primary:active,
  .ui-btn--secondary:active,
  .ui-btn--ghost:active {
    transform: none;
  }
}
</style>

