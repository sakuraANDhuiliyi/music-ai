<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps({
  text: { type: String, required: true },
  density: { type: Number, default: 3 }, // smaller = more particles
  radius: { type: Number, default: 100 },
  repelStrength: { type: Number, default: 2.4 },
  particleSize: { type: Number, default: 1.0 },
  glow: { type: Boolean, default: true },
  glowIntensity: { type: Number, default: 0.14 }, // 0..1
  swirl: { type: Number, default: 0.18 }, // subtle sideways drift when hovering
  snapOnLeave: { type: Boolean, default: true },
});

const wrapRef = ref(null);
const canvasRef = ref(null);
const measureRef = ref(null);

const pad = computed(() => Math.max(18, Math.ceil(props.radius * 0.65)));

const canAnimate = computed(() => {
  if (typeof window === 'undefined') return false;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const hoverFine = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches ?? false;
  return !reduced && hoverFine;
});

let ctx = null;
let gradient = null;
let rafId = null;
let resizeObserver = null;
let isRunning = false;
let lastW = 0;
let lastH = 0;

const pointer = { x: 0, y: 0, tx: 0, ty: 0, active: false };
let particles = [];
const glowX = [];
const glowY = [];
const glowA = [];
const glowS = [];
let glowCount = 0;
const TAU = Math.PI * 2;

function getTextFont() {
  const el = measureRef.value;
  if (!el) return null;
  const style = window.getComputedStyle(el);
  const fontWeight = style.fontWeight || '700';
  const fontSize = style.fontSize || '48px';
  const fontFamily = style.fontFamily || 'ui-sans-serif';
  return `${fontWeight} ${fontSize} ${fontFamily}`;
}

function setCanvasSize(width, height) {
  const canvas = canvasRef.value;
  if (!canvas || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.ceil(width * dpr));
  canvas.height = Math.max(1, Math.ceil(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, 'rgba(56, 189, 248, 0.95)');  // sky
  gradient.addColorStop(0.52, 'rgba(99, 102, 241, 0.95)'); // indigo
  gradient.addColorStop(1, 'rgba(34, 211, 238, 0.95)'); // cyan
}

function buildParticles(textWidth, textHeight, padding) {
  const font = getTextFont();
  if (!font) return;

  const density = Math.max(2, Math.floor(props.density));
  const sampleScale = 2; // higher sampling => denser, cleaner edges

  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.ceil((textWidth + padding * 2) * sampleScale));
  off.height = Math.max(1, Math.ceil((textHeight + padding * 2) * sampleScale));

  const offCtx = off.getContext('2d', { willReadFrequently: true });
  if (!offCtx) return;

  offCtx.clearRect(0, 0, off.width, off.height);
  offCtx.setTransform(sampleScale, 0, 0, sampleScale, 0, 0);
  offCtx.fillStyle = '#000';
  offCtx.textAlign = 'left';
  offCtx.textBaseline = 'top';
  offCtx.font = font;
  offCtx.fillText(props.text, padding, padding);

  const data = offCtx.getImageData(0, 0, off.width, off.height).data;
  const nextParticles = [];
  const step = density * sampleScale;
  const alphaThreshold = 10; // include anti-aliased edges for a more “real text” silhouette

  for (let y = 0; y < off.height; y += step) {
    for (let x = 0; x < off.width; x += step) {
      const alpha = data[(y * off.width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        const a = alpha / 255;
        // Less randomness => closer to crisp text
        const jitterX = (Math.random() - 0.5) * 0.22;
        const jitterY = (Math.random() - 0.5) * 0.22;
        const baseX = x / sampleScale + jitterX;
        const baseY = y / sampleScale + jitterY;

        // Edge-aware size (keep edges visible but not chunky)
        const edge = Math.pow(a, 1.15);
        const size = props.particleSize * (0.55 + edge * 0.75) * (0.97 + Math.random() * 0.06);
        nextParticles.push({ x: baseX, y: baseY, baseX, baseY, vx: 0, vy: 0, a, size });
      }
    }
  }

  particles = nextParticles;
}

function drawFrame(width, height) {
  if (!ctx || !gradient) return;

  ctx.clearRect(0, 0, width, height);
  lastW = width;
  lastH = height;
  // Smooth pointer movement (prettier dispersion)
  pointer.x += (pointer.tx - pointer.x) * 0.18;
  pointer.y += (pointer.ty - pointer.y) * 0.18;

  ctx.globalCompositeOperation = 'source-over';

  const r = props.radius;
  const r2 = r * r;
  const strength = props.repelStrength;
  glowCount = 0;

  for (const particle of particles) {
    let influence = 0;
    let nx = 0;
    let ny = 0;
    if (pointer.active) {
      const dx = particle.x - pointer.x;
      const dy = particle.y - pointer.y;
      const d2 = dx * dx + dy * dy;

      if (d2 < r2) {
        const dist = Math.sqrt(d2);
        influence = 1 - dist / r;
        const inv = 1 / (dist || 1);
        nx = dx * inv;
        ny = dy * inv;
        const force = influence * influence * strength;
        particle.vx += nx * force * 2.15;
        particle.vy += ny * force * 2.15;

        // Add a subtle swirl so the breakup feels “alive” instead of purely radial
        const swirl = props.swirl * force;
        particle.vx += (-ny) * swirl;
        particle.vy += (nx) * swirl;
      }

      // Soft "magnetic" return to shape while hovering
      particle.vx += (particle.baseX - particle.x) * 0.02;
      particle.vy += (particle.baseY - particle.y) * 0.02;

      particle.vx *= 0.82;
      particle.vy *= 0.82;
      particle.x += particle.vx;
      particle.y += particle.vy;
    } else {
      // If we didn't snap (snapOnLeave=false), quickly converge back
      particle.x += (particle.baseX - particle.x) * 0.35;
      particle.y += (particle.baseY - particle.y) * 0.35;
      particle.vx *= 0.5;
      particle.vy *= 0.5;
    }

    // Halo near the cursor (only when interacting)
    if (props.glow && pointer.active && influence > 0.45 && glowCount < 1400) {
      glowX[glowCount] = particle.x;
      glowY[glowCount] = particle.y;
      glowA[glowCount] = (0.22 + particle.a * 0.88) * influence;
      glowS[glowCount] = particle.size;
      glowCount += 1;
    }
  }

  // Draw base in ONE fill call (much faster than per-particle fill)
  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.96;
  ctx.beginPath();
  for (const particle of particles) {
    ctx.moveTo(particle.x + particle.size, particle.y);
    ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
  }
  ctx.fill();

  // Glow pass (limited count)
  if (props.glow && pointer.active && glowCount > 0) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < glowCount; i += 1) {
      ctx.globalAlpha = Math.min(0.55, props.glowIntensity * glowA[i]);
      ctx.beginPath();
      ctx.arc(glowX[i], glowY[i], glowS[i] * 2.0, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.globalAlpha = 1;
}

function rebuild() {
  const measure = measureRef.value;
  if (!measure || !canvasRef.value) return;

  const rect = measure.getBoundingClientRect();
  const textWidth = Math.max(1, Math.ceil(rect.width));
  const textHeight = Math.max(1, Math.ceil(rect.height));
  const padding = pad.value;
  const width = textWidth + padding * 2;
  const height = textHeight + padding * 2;

  setCanvasSize(width, height);
  buildParticles(textWidth, textHeight, padding);
  drawFrame(width, height);
}

function start() {
  if (isRunning) return;
  isRunning = true;
  const tick = () => {
    const canvas = canvasRef.value;
    if (!canvas || !ctx) {
      isRunning = false;
      rafId = null;
      return;
    }

    drawFrame(canvas.clientWidth, canvas.clientHeight);

    // Stop when idle to avoid burning CPU/GPU
    if (!pointer.active && props.snapOnLeave) {
      isRunning = false;
      rafId = null;
      return;
    }

    rafId = window.requestAnimationFrame(tick);
  };
  rafId = window.requestAnimationFrame(tick);
}

function stop() {
  if (rafId) window.cancelAnimationFrame(rafId);
  rafId = null;
  isRunning = false;
}

function snapBack() {
  for (const particle of particles) {
    particle.x = particle.baseX;
    particle.y = particle.baseY;
    particle.vx = 0;
    particle.vy = 0;
  }
}

function onPointerMove(event) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  pointer.tx = event.clientX - rect.left;
  pointer.ty = event.clientY - rect.top;
}

function onPointerEnter(event) {
  pointer.active = true;
  onPointerMove(event);
  pointer.x = pointer.tx;
  pointer.y = pointer.ty;
  start();
}

function onPointerLeave() {
  pointer.active = false;
  pointer.tx = pointer.x;
  pointer.ty = pointer.y;
  if (props.snapOnLeave) snapBack();
  if (lastW && lastH) drawFrame(lastW, lastH);
  stop();
}

function cleanup() {
  stop();
  resizeObserver?.disconnect();
  resizeObserver = null;

  const wrap = wrapRef.value;
  if (wrap) {
    wrap.removeEventListener('pointermove', onPointerMove);
    wrap.removeEventListener('pointerenter', onPointerEnter);
    wrap.removeEventListener('pointerleave', onPointerLeave);
  }
}

onMounted(async () => {
  if (!canAnimate.value) return;
  await nextTick();

  const canvas = canvasRef.value;
  if (!canvas) return;
  ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return;

  const wrap = wrapRef.value;
  if (wrap) {
    wrap.addEventListener('pointermove', onPointerMove, { passive: true });
    wrap.addEventListener('pointerenter', onPointerEnter, { passive: true });
    wrap.addEventListener('pointerleave', onPointerLeave, { passive: true });
  }

  resizeObserver = new ResizeObserver(() => rebuild());
  if (wrap) resizeObserver.observe(wrap);

  rebuild();
});

onUnmounted(() => {
  cleanup();
});

watch(
  () => props.text,
  async () => {
    if (!canAnimate.value) return;
    await nextTick();
    rebuild();
  }
);
</script>

<template>
  <!-- Canvas mode: only enable on hover-capable devices -->
  <span
    v-if="canAnimate"
    ref="wrapRef"
    class="particle-title relative inline-block align-baseline select-none overflow-visible"
    :style="{ '--pt-pad': `${pad}px` }"
  >
    <span ref="measureRef" class="particle-title__layout" aria-hidden="true">{{ text }}</span>
    <canvas ref="canvasRef" class="particle-title__canvas"></canvas>
    <span class="sr-only">{{ text }}</span>
  </span>

  <!-- Fallback: keep it pretty on touch / reduced-motion -->
  <span v-else class="bg-clip-text text-transparent bg-gradient-to-r from-sky-500 via-indigo-500 to-cyan-500">
    {{ text }}
  </span>
</template>

<style scoped>
.particle-title canvas {
  filter:
    drop-shadow(0 16px 18px rgba(2, 132, 199, 0.16))
    drop-shadow(0 8px 12px rgba(99, 102, 241, 0.10));
}

.particle-title__layout {
  display: inline-block;
  white-space: pre;
  line-height: 1;
  color: transparent;
  -webkit-text-fill-color: transparent;
  pointer-events: none;
}

.particle-title__canvas {
  position: absolute;
  top: calc(var(--pt-pad) * -1);
  left: calc(var(--pt-pad) * -1);
  pointer-events: none;
  white-space: pre;
}
</style>
