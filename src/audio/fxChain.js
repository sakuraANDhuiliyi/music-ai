import { getIrBuffer } from './irCache.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const DEFAULT_FX = Object.freeze({
  enabled: false,
  quality: 'low',
  master: {
    eq: { enabled: false, low: 0, mid: 0, high: 0 },
    compressor: {
      enabled: false,
      threshold: -18,
      ratio: 2.5,
      attack: 0.003,
      release: 0.25,
      knee: 18,
      makeup: 0,
    },
    delay: { enabled: false, time: 0.28, feedback: 0.25, mix: 0.2 },
    reverb: { enabled: false, mix: 0.22, seconds: 1.6, decay: 2.2, preDelay: 0.012, irUrl: '' },
  },
});

export const normalizeFxSettings = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const master = src.master && typeof src.master === 'object' ? src.master : {};
  const eq = master.eq && typeof master.eq === 'object' ? master.eq : {};
  const compressor = master.compressor && typeof master.compressor === 'object' ? master.compressor : {};
  const delay = master.delay && typeof master.delay === 'object' ? master.delay : {};
  const reverb = master.reverb && typeof master.reverb === 'object' ? master.reverb : {};

  return {
    enabled: Boolean(src.enabled ?? DEFAULT_FX.enabled),
    quality: String(src.quality || DEFAULT_FX.quality),
    master: {
      eq: {
        enabled: Boolean(eq.enabled ?? DEFAULT_FX.master.eq.enabled),
        low: clamp(Number(eq.low ?? DEFAULT_FX.master.eq.low), -18, 18),
        mid: clamp(Number(eq.mid ?? DEFAULT_FX.master.eq.mid), -18, 18),
        high: clamp(Number(eq.high ?? DEFAULT_FX.master.eq.high), -18, 18),
      },
      compressor: {
        enabled: Boolean(compressor.enabled ?? DEFAULT_FX.master.compressor.enabled),
        threshold: clamp(Number(compressor.threshold ?? DEFAULT_FX.master.compressor.threshold), -60, 0),
        ratio: clamp(Number(compressor.ratio ?? DEFAULT_FX.master.compressor.ratio), 1, 20),
        attack: clamp(Number(compressor.attack ?? DEFAULT_FX.master.compressor.attack), 0.001, 0.2),
        release: clamp(Number(compressor.release ?? DEFAULT_FX.master.compressor.release), 0.02, 1.2),
        knee: clamp(Number(compressor.knee ?? DEFAULT_FX.master.compressor.knee), 0, 40),
        makeup: clamp(Number(compressor.makeup ?? DEFAULT_FX.master.compressor.makeup), -6, 12),
      },
      delay: {
        enabled: Boolean(delay.enabled ?? DEFAULT_FX.master.delay.enabled),
        time: clamp(Number(delay.time ?? DEFAULT_FX.master.delay.time), 0.02, 1.2),
        feedback: clamp(Number(delay.feedback ?? DEFAULT_FX.master.delay.feedback), 0, 0.92),
        mix: clamp(Number(delay.mix ?? DEFAULT_FX.master.delay.mix), 0, 1),
      },
      reverb: {
        enabled: Boolean(reverb.enabled ?? DEFAULT_FX.master.reverb.enabled),
        mix: clamp(Number(reverb.mix ?? DEFAULT_FX.master.reverb.mix), 0, 1),
        seconds: clamp(Number(reverb.seconds ?? DEFAULT_FX.master.reverb.seconds), 0.3, 8),
        decay: clamp(Number(reverb.decay ?? DEFAULT_FX.master.reverb.decay), 0.1, 10),
        preDelay: clamp(Number(reverb.preDelay ?? DEFAULT_FX.master.reverb.preDelay), 0, 0.15),
        irUrl: String(reverb.irUrl || ''),
      },
    },
  };
};

export const getProjectFxSettings = (project) => {
  const fx = project?.fx || project?.meta?.fx || {};
  return normalizeFxSettings(fx);
};

const qualityScale = (quality) => {
  const q = String(quality || '').toLowerCase();
  if (q === 'high') return 1.15;
  if (q === 'mid' || q === 'medium') return 1;
  return 0.7;
};

const buildEqStage = (ctx, eq) => {
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 160;
  low.gain.value = eq.low;

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 0.8;
  mid.gain.value = eq.mid;

  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 6000;
  high.gain.value = eq.high;

  low.connect(mid);
  mid.connect(high);
  return { input: low, output: high, nodes: [low, mid, high] };
};

const buildCompressorStage = (ctx, comp) => {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = comp.threshold;
  node.ratio.value = comp.ratio;
  node.attack.value = comp.attack;
  node.release.value = comp.release;
  node.knee.value = comp.knee;
  const makeup = ctx.createGain();
  makeup.gain.value = Math.pow(10, comp.makeup / 20);
  node.connect(makeup);
  return { input: node, output: makeup, nodes: [node, makeup] };
};

const buildDelayStage = (ctx, delay, quality) => {
  const mix = clamp(delay.mix, 0, 1);
  const dry = ctx.createGain();
  dry.gain.value = 1 - mix;
  const wet = ctx.createGain();
  wet.gain.value = mix;

  const maxDelay = 2.5;
  const delayNode = ctx.createDelay(maxDelay);
  const time = clamp(delay.time, 0.02, 1.2);
  delayNode.delayTime.value = time;

  const fb = ctx.createGain();
  const fbVal = clamp(delay.feedback * (quality === 'low' ? 0.85 : 1), 0, 0.92);
  fb.gain.value = fbVal;
  delayNode.connect(fb);
  fb.connect(delayNode);

  const sum = ctx.createGain();
  return {
    input: (input) => {
      input.connect(dry);
      input.connect(delayNode);
    },
    output: sum,
    nodes: [dry, wet, delayNode, fb, sum],
    connectWet: () => {
      dry.connect(sum);
      delayNode.connect(wet);
      wet.connect(sum);
    },
  };
};

const buildReverbStage = async (ctx, reverb, quality) => {
  const mix = clamp(reverb.mix, 0, 1);
  const dry = ctx.createGain();
  dry.gain.value = 1 - mix;
  const wet = ctx.createGain();
  wet.gain.value = mix;

  const preDelay = ctx.createDelay(0.2);
  preDelay.delayTime.value = clamp(reverb.preDelay, 0, 0.15);

  const scale = qualityScale(quality);
  const irSeconds = clamp(reverb.seconds * scale, 0.3, 8);
  const irDecay = clamp(reverb.decay * scale, 0.1, 10);

  const convolver = ctx.createConvolver();
  convolver.buffer = await getIrBuffer(ctx, {
    url: reverb.irUrl,
    seconds: irSeconds,
    decay: irDecay,
  });

  const sum = ctx.createGain();
  return {
    input: (input) => {
      input.connect(dry);
      input.connect(preDelay);
    },
    output: sum,
    nodes: [dry, wet, preDelay, convolver, sum],
    connectWet: () => {
      dry.connect(sum);
      preDelay.connect(convolver);
      convolver.connect(wet);
      wet.connect(sum);
    },
  };
};

export async function buildFxChain(ctx, rawSettings, options = {}) {
  const settings = normalizeFxSettings(rawSettings);
  if (!settings.enabled || options.active === false) {
    return { input: null, output: null, nodes: [], settings, bypass: true };
  }

  const quality = String(options.quality || settings.quality || 'low');
  const nodes = [];

  const input = ctx.createGain();
  let current = input;

  if (settings.master.eq.enabled) {
    const eqStage = buildEqStage(ctx, settings.master.eq);
    current.connect(eqStage.input);
    current = eqStage.output;
    nodes.push(...eqStage.nodes);
  }

  if (settings.master.compressor.enabled) {
    const compStage = buildCompressorStage(ctx, settings.master.compressor);
    current.connect(compStage.input);
    current = compStage.output;
    nodes.push(...compStage.nodes);
  }

  if (settings.master.delay.enabled) {
    const delayStage = buildDelayStage(ctx, settings.master.delay, quality);
    delayStage.input(current);
    delayStage.connectWet();
    current = delayStage.output;
    nodes.push(...delayStage.nodes);
  }

  if (settings.master.reverb.enabled) {
    const reverbStage = await buildReverbStage(ctx, settings.master.reverb, quality);
    reverbStage.input(current);
    reverbStage.connectWet();
    current = reverbStage.output;
    nodes.push(...reverbStage.nodes);
  }

  return { input, output: current, nodes, settings, bypass: false };
}
