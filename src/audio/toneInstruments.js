import * as Tone from 'tone';

export const DEFAULT_INSTRUMENT_ID = 'piano_soft';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const SYNTH_CLASS_BY_KEY = Object.freeze({
  Synth: Tone.Synth,
  MonoSynth: Tone.MonoSynth,
  AMSynth: Tone.AMSynth,
  FMSynth: Tone.FMSynth,
  PluckSynth: Tone.PluckSynth,
  MembraneSynth: Tone.MembraneSynth,
});

export const INSTRUMENT_PRESETS = Object.freeze({
  piano_soft: {
    label: '柔和钢琴',
    kind: 'poly',
    voice: 'Synth',
    polyphony: 8,
    volumeDb: -10,
    options: {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.16, sustain: 0.28, release: 0.22 },
    },
  },
  pad_warm: {
    label: '温暖 Pad',
    kind: 'poly',
    voice: 'FMSynth',
    polyphony: 6,
    volumeDb: -14,
    options: {
      harmonicity: 1.5,
      modulationIndex: 6,
      envelope: { attack: 0.12, decay: 0.5, sustain: 0.75, release: 0.9 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.2, decay: 0.25, sustain: 0.8, release: 0.7 },
    },
  },
  lead_clean: {
    label: '清晰 Lead',
    kind: 'mono',
    voice: 'MonoSynth',
    volumeDb: -12,
    options: {
      oscillator: { type: 'sawtooth' },
      filter: { Q: 1, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.12, sustain: 0.35, release: 0.1 },
      filterEnvelope: { attack: 0.01, decay: 0.08, sustain: 0.2, release: 0.08, baseFrequency: 220, octaves: 2.5 },
    },
  },
  bass_sub: {
    label: '低频 Bass',
    kind: 'mono',
    voice: 'MonoSynth',
    volumeDb: -10,
    options: {
      oscillator: { type: 'square' },
      filter: { Q: 1, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.18, sustain: 0.6, release: 0.12 },
      filterEnvelope: { attack: 0.01, decay: 0.12, sustain: 0.25, release: 0.1, baseFrequency: 80, octaves: 2 },
    },
  },
  pluck_glass: {
    label: '玻璃拨弦',
    kind: 'poly',
    voice: 'PluckSynth',
    polyphony: 6,
    volumeDb: -16,
    options: {
      attackNoise: 0.8,
      dampening: 5200,
      resonance: 0.88,
      release: 0.65,
    },
  },
});

export function getInstrumentPreset(id) {
  const key = String(id || '').trim();
  if (key && INSTRUMENT_PRESETS[key]) return INSTRUMENT_PRESETS[key];
  return INSTRUMENT_PRESETS[DEFAULT_INSTRUMENT_ID];
}

export function resolveInstrumentId(...candidates) {
  for (const c of candidates) {
    const key = String(c || '').trim();
    if (key && INSTRUMENT_PRESETS[key]) return key;
  }
  return DEFAULT_INSTRUMENT_ID;
}

export async function ensureToneContext(audioCtx) {
  if (!audioCtx) return;
  try {
    Tone.setContext(audioCtx);
  } catch {
    // ignore
  }
  try {
    await Tone.start();
  } catch {
    // ignore
  }
}

export function ctxTimeToToneTime(audioCtx, whenCtxTime) {
  const ctxNow = Number(audioCtx?.currentTime) || 0;
  const t = Number(whenCtxTime) || 0;
  return Tone.now() + Math.max(0, t - ctxNow);
}

export function createToneInstrument(instrumentId, options = {}) {
  const preset = getInstrumentPreset(instrumentId);
  const audioCtx = options.audioCtx || null;
  const outputNode = options.outputNode || null;

  const voiceKey = String(preset.voice || 'Synth');
  const VoiceClass = SYNTH_CLASS_BY_KEY[voiceKey] || Tone.Synth;

  let synth = null;
  if (preset.kind === 'poly') {
    const polyphony = clamp(Number(preset.polyphony ?? 8), 1, 32);
    synth = new Tone.PolySynth(VoiceClass, preset.options || {});
    try {
      synth.set({ maxPolyphony: polyphony });
    } catch {
      // ignore
    }
  } else {
    synth = new VoiceClass(preset.options || {});
  }

  try {
    synth.volume.value = Number(preset.volumeDb ?? 0) || 0;
  } catch {
    // ignore
  }

  if (outputNode) {
    try {
      synth.connect(outputNode);
    } catch {
      // ignore
    }
  }

  return {
    id: resolveInstrumentId(instrumentId),
    preset,
    synth,
    audioCtx,
    triggerAttackRelease(freqOrNote, durSec, whenCtxTime, velocity = 0.85) {
      if (!synth) return;
      const d = clamp(Number(durSec) || 0.12, 0.03, 30);
      const v = clamp(Number(velocity) || 0.85, 0.05, 1);
      const toneTime = audioCtx ? ctxTimeToToneTime(audioCtx, whenCtxTime) : Tone.now();
      try {
        synth.triggerAttackRelease(freqOrNote, d, toneTime, v);
      } catch {
        // ignore
      }
    },
    releaseAll() {
      if (!synth) return;
      try {
        synth.releaseAll?.();
      } catch {
        // ignore
      }
    },
    dispose() {
      if (!synth) return;
      try {
        synth.releaseAll?.();
      } catch {
        // ignore
      }
      try {
        synth.disconnect?.();
      } catch {
        // ignore
      }
      try {
        synth.dispose?.();
      } catch {
        // ignore
      }
      synth = null;
    },
  };
}

