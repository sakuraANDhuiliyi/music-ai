let sharedCtx = null;

export function getSharedAudioContext() {
  if (sharedCtx) return sharedCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('Web Audio API not supported');
  sharedCtx = new Ctx();
  return sharedCtx;
}

export async function ensureSharedAudioRunning() {
  const ctx = getSharedAudioContext();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // ignore
    }
  }
  return ctx;
}

export function closeSharedAudioContext() {
  const ctx = sharedCtx;
  sharedCtx = null;
  if (!ctx) return;
  try {
    ctx.close?.();
  } catch {
    // ignore
  }
}

