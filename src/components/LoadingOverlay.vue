<script setup>
// 接收一个 props 来控制显示（或者直接由父组件 v-if 控制）
defineProps({
  show: Boolean
});
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white/45 backdrop-blur-2xl">

      <div class="aurora-loader" aria-hidden="true">
        <div class="aurora-loader__ring"></div>
        <div class="aurora-loader__disc">
          <div class="aurora-loader__eq">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <div class="aurora-loader__center"></div>
        </div>
        <div class="aurora-loader__orbit">
          <i class="ph-fill ph-music-notes"></i>
        </div>
      </div>

      <div class="mt-5 text-slate-700 font-mono text-sm tracking-widest animate-pulse" role="status" aria-live="polite">
        SYNCING TRACKS...
      </div>

    </div>
  </transition>
</template>

<style scoped>
/* Aurora Vinyl Loader */
.aurora-loader {
  position: relative;
  width: 148px;
  height: 148px;
}

.aurora-loader__ring {
  position: absolute;
  inset: -18px;
  border-radius: 9999px;
  background: conic-gradient(
    from 0deg,
    rgba(56, 189, 248, 0),
    rgba(56, 189, 248, 0.55),
    rgba(99, 102, 241, 0.55),
    rgba(34, 211, 238, 0.55),
    rgba(56, 189, 248, 0)
  );
  filter: blur(14px);
  opacity: 0.9;
  animation: ring-rotate 2.8s linear infinite, ring-breathe 2.4s ease-in-out infinite;
}

.aurora-loader__disc {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.85);
  background:
    radial-gradient(circle at 30% 22%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.60) 38%, rgba(255, 255, 255, 0.45) 70%, rgba(255, 255, 255, 0.38) 100%),
    repeating-radial-gradient(circle at 50% 50%, rgba(2, 132, 199, 0.06) 0 2px, rgba(255, 255, 255, 0) 2px 6px);
  box-shadow:
    0 26px 60px -45px rgba(2, 132, 199, 0.75),
    0 1px 0 rgba(255, 255, 255, 0.92) inset;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.aurora-loader__disc::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.22), transparent);
  transform: translateX(-70%);
  filter: blur(10px);
  opacity: 0.7;
  animation: scan 1.55s ease-in-out infinite;
}

.aurora-loader__center {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.55) 55%, rgba(255, 255, 255, 0.35) 100%);
  border: 1px solid rgba(255, 255, 255, 0.75);
  box-shadow: 0 16px 35px -28px rgba(2, 132, 199, 0.7);
}

.aurora-loader__eq {
  position: absolute;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  display: flex;
  align-items: flex-end;
  gap: 5px;
  z-index: 2;
}

.aurora-loader__eq span {
  width: 6px;
  height: 10px;
  border-radius: 9999px;
  background: linear-gradient(to top, rgba(56, 189, 248, 0.95), rgba(99, 102, 241, 0.95));
  box-shadow: 0 14px 28px -20px rgba(2, 132, 199, 0.9);
  animation: equalize 0.95s ease-in-out infinite;
}
.aurora-loader__eq span:nth-child(2) { animation-delay: 0.10s; }
.aurora-loader__eq span:nth-child(3) { animation-delay: 0.20s; }
.aurora-loader__eq span:nth-child(4) { animation-delay: 0.30s; }
.aurora-loader__eq span:nth-child(5) { animation-delay: 0.40s; }

.aurora-loader__orbit {
  position: absolute;
  inset: 0;
  animation: orbit 1.65s linear infinite;
  z-index: 3;
}
.aurora-loader__orbit i {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) translateX(96px);
  font-size: 18px;
  background-image: linear-gradient(135deg, rgb(56, 189, 248), rgb(99, 102, 241));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 14px 20px rgba(2, 132, 199, 0.45));
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes ring-rotate {
  to { transform: rotate(360deg); }
}

@keyframes ring-breathe {
  0%, 100% { opacity: 0.75; transform: scale(0.98); }
  50% { opacity: 0.95; transform: scale(1.02); }
}

@keyframes scan {
  0% { transform: translateX(-70%); }
  50% { transform: translateX(20%); }
  100% { transform: translateX(75%); }
}

@keyframes orbit {
  to { transform: rotate(360deg); }
}

@keyframes equalize {
  0%, 100% { height: 10px; opacity: 0.6; }
  50% { height: 34px; opacity: 1; }
}
</style>
