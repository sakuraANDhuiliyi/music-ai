<script setup>
/**
 * SoundLab - 教程用「声音实验室」
 * 目标：用 Web Audio API + Canvas 提供可视/可听/可交互的基础声学实验。
 *
 * mode:
 * - frequency: 频率/音高 + 示波器 + 频谱
 * - loudness: 振幅/响度（Gain + dB 显示）+ 示波器
 * - timbre: 波形/泛音（波形选择 + 低通滤波）+ 频谱
 * - phase: 相位与干涉（双振荡器 + 延时模拟相位差）+ 示波器
 * - envelope: ADSR（触发式）+ 包络曲线
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ensureSharedAudioRunning, getSharedAudioContext } from '../../audio/sharedAudioContext.js';

const props = defineProps({
  mode: { type: String, default: 'frequency' },
  initialFrequency: { type: Number, default: 440 },
  initialWaveform: { type: String, default: 'sine' },
  initialGain: { type: Number, default: 0.25 },
  initialDetune: { type: Number, default: 0 },
});

const isPlaying = ref(false);
const frequency = ref(Math.max(20, Math.min(2000, Number(props.initialFrequency) || 440)));
const detune = ref(Math.max(-1200, Math.min(1200, Number(props.initialDetune) || 0)));
const waveform = ref(String(props.initialWaveform || 'sine'));
const gainValue = ref(Math.max(0, Math.min(1, Number(props.initialGain) || 0.25)));

const phaseDeg = ref(0); // 0-180
const filterCutoff = ref(24000); // Hz

const adsr = ref({ a: 0.02, d: 0.12, s: 0.55, r: 0.25 });
const envPreviewRef = ref(null);

const oscCanvasRef = ref(null);
const specCanvasRef = ref(null);

const audioCtx = ref(null);
const analyser = ref(null);
const mainGain = ref(null);
const master = ref(null);
const oscA = ref(null);
const oscB = ref(null);
const filter = ref(null);
const rafId = ref(0);

const waveformOptions = [
  { key: 'sine', label: 'Sine' },
  { key: 'triangle', label: 'Triangle' },
  { key: 'sawtooth', label: 'Saw' },
  { key: 'square', label: 'Square' },
];

const modeTitle = computed(() => {
  const m = String(props.mode || '');
  if (m === 'loudness') return '振幅与响度';
  if (m === 'timbre') return '音色与泛音';
  if (m === 'phase') return '相位与干涉';
  if (m === 'envelope') return '包络（ADSR）';
  return '频率与音高';
});

const gainDb = computed(() => {
  const g = Math.max(0.0001, Number(gainValue.value) || 0.0001);
  const db = 20 * Math.log10(g);
  return Number.isFinite(db) ? db : -120;
});

const nearestNote = computed(() => {
  // A4=440Hz, MIDI 69
  const f = Number(frequency.value) || 440;
  if (!Number.isFinite(f) || f <= 0) return null;
  const midi = Math.round(69 + 12 * Math.log2(f / 440));
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = names[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const ideal = 440 * Math.pow(2, (midi - 69) / 12);
  const cents = Math.round(1200 * Math.log2(f / ideal));
  return { midi, label: `${name}${octave}`, cents };
});

const ensureAudio = async () => {
  if (!audioCtx.value) audioCtx.value = getSharedAudioContext();
  await ensureSharedAudioRunning();
  return audioCtx.value;
};

const buildGraph = () => {
  const ctx = audioCtx.value;
  if (!ctx) return;

  analyser.value = ctx.createAnalyser();
  analyser.value.fftSize = 2048;
  analyser.value.smoothingTimeConstant = 0.85;

  master.value = ctx.createGain();
  master.value.gain.value = 1;

  mainGain.value = ctx.createGain();
  mainGain.value.gain.value = gainValue.value;

  // 输出链：source -> (filter?) -> gain -> analyser -> master -> destination
  filter.value = null;
  if (props.mode === 'timbre') {
    const biquad = ctx.createBiquadFilter();
    biquad.type = 'lowpass';
    biquad.frequency.value = filterCutoff.value;
    biquad.Q.value = 0.7;
    filter.value = biquad;
  }

  analyser.value.connect(master.value);
  master.value.connect(ctx.destination);

  if (props.mode === 'phase') {
    // 双振荡器：B 通过 DelayNode 模拟相位差
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    const delay = ctx.createDelay(0.05);

    a.type = waveform.value;
    b.type = waveform.value;
    a.frequency.value = frequency.value;
    b.frequency.value = frequency.value;
    a.detune.value = detune.value;
    b.detune.value = detune.value;

    // 相位差 -> 时间延迟：phase(°)/360 * 周期
    const period = 1 / Math.max(1, Number(frequency.value) || 440);
    delay.delayTime.value = (Math.max(0, Math.min(180, phaseDeg.value)) / 360) * period;

    a.connect(mainGain.value);
    b.connect(delay);
    delay.connect(mainGain.value);

    mainGain.value.connect(analyser.value);

    oscA.value = a;
    oscB.value = b;
    return;
  }

  const osc = ctx.createOscillator();
  osc.type = waveform.value;
  osc.frequency.value = frequency.value;
  osc.detune.value = detune.value;

  if (filter.value) {
    osc.connect(filter.value);
    filter.value.connect(mainGain.value);
  } else {
    osc.connect(mainGain.value);
  }
  mainGain.value.connect(analyser.value);

  oscA.value = osc;
  oscB.value = null;
};

const teardownGraph = () => {
  try {
    if (rafId.value) cancelAnimationFrame(rafId.value);
  } catch {
    // ignore
  }
  rafId.value = 0;

  const stopOsc = (o) => {
    if (!o) return;
    try {
      o.stop();
    } catch {
      // ignore
    }
    try {
      o.disconnect();
    } catch {
      // ignore
    }
  };
  stopOsc(oscA.value);
  stopOsc(oscB.value);
  oscA.value = null;
  oscB.value = null;

  const disconnect = (n) => {
    if (!n) return;
    try {
      n.disconnect();
    } catch {
      // ignore
    }
  };
  disconnect(filter.value);
  disconnect(mainGain.value);
  disconnect(analyser.value);
  disconnect(master.value);
  filter.value = null;
  mainGain.value = null;
  analyser.value = null;
  master.value = null;
};

const start = async () => {
  if (isPlaying.value) return;
  await ensureAudio();
  teardownGraph();
  buildGraph();
  try {
    oscA.value?.start();
    oscB.value?.start?.();
  } catch {
    // ignore
  }
  isPlaying.value = true;
  tick();
};

const stop = () => {
  isPlaying.value = false;
  teardownGraph();
};

const toggle = () => {
  if (isPlaying.value) stop();
  else start();
};

const drawOscilloscope = (ctx2d, w, h) => {
  const a = analyser.value;
  if (!a) return;
  const buffer = new Uint8Array(a.fftSize);
  a.getByteTimeDomainData(buffer);

  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = 'rgba(255,255,255,0.65)';
  ctx2d.fillRect(0, 0, w, h);

  ctx2d.strokeStyle = 'rgba(15, 118, 110, 0.95)';
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();

  const slice = w / buffer.length;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i] / 128.0;
    const y = (v * h) / 2;
    const x = i * slice;
    if (i === 0) ctx2d.moveTo(x, y);
    else ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();

  ctx2d.strokeStyle = 'rgba(245, 158, 11, 0.55)';
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(0, h / 2);
  ctx2d.lineTo(w, h / 2);
  ctx2d.stroke();
};

const drawSpectrum = (ctx2d, w, h) => {
  const a = analyser.value;
  if (!a) return;
  const buffer = new Uint8Array(a.frequencyBinCount);
  a.getByteFrequencyData(buffer);

  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = 'rgba(255,255,255,0.65)';
  ctx2d.fillRect(0, 0, w, h);

  const barW = w / buffer.length;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i] / 255;
    const barH = Math.max(1, v * (h - 8));
    const x = i * barW;
    const y = h - barH;
    ctx2d.fillStyle = `rgba(34,199,184,${0.12 + v * 0.75})`;
    ctx2d.fillRect(x, y, Math.max(1, barW), barH);
  }
};

const drawEnvelopePreview = () => {
  const el = envPreviewRef.value;
  if (!el) return;
  const ctx2d = el.getContext('2d');
  if (!ctx2d) return;

  const w = el.width;
  const h = el.height;

  const a = Math.max(0.005, Math.min(1.2, Number(adsr.value.a) || 0.02));
  const d = Math.max(0.005, Math.min(1.2, Number(adsr.value.d) || 0.12));
  const s = Math.max(0, Math.min(1, Number(adsr.value.s) || 0.55));
  const r = Math.max(0.005, Math.min(1.5, Number(adsr.value.r) || 0.25));
  const total = a + d + 0.6 + r;

  const ax = (a / total) * w;
  const dx = ((a + d) / total) * w;
  const sx = ((a + d + 0.6) / total) * w;
  const rx = w;

  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = 'rgba(255,255,255,0.65)';
  ctx2d.fillRect(0, 0, w, h);

  ctx2d.strokeStyle = 'rgba(15, 118, 110, 0.95)';
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  ctx2d.moveTo(0, h);
  ctx2d.lineTo(ax, 0);
  ctx2d.lineTo(dx, h - s * h);
  ctx2d.lineTo(sx, h - s * h);
  ctx2d.lineTo(rx, h);
  ctx2d.stroke();
};

const tick = () => {
  if (!isPlaying.value) return;

  const oscEl = oscCanvasRef.value;
  if (oscEl) {
    const ctx2d = oscEl.getContext('2d');
    if (ctx2d) drawOscilloscope(ctx2d, oscEl.width, oscEl.height);
  }
  const specEl = specCanvasRef.value;
  if (specEl) {
    const ctx2d = specEl.getContext('2d');
    if (ctx2d) drawSpectrum(ctx2d, specEl.width, specEl.height);
  }

  rafId.value = requestAnimationFrame(tick);
};

const triggerEnvelope = async () => {
  await ensureAudio();
  const ctx = audioCtx.value;
  if (!ctx) return;

  const now = ctx.currentTime;
  const a = Math.max(0.005, Math.min(1.2, Number(adsr.value.a) || 0.02));
  const d = Math.max(0.005, Math.min(1.2, Number(adsr.value.d) || 0.12));
  const s = Math.max(0, Math.min(1, Number(adsr.value.s) || 0.55));
  const r = Math.max(0.005, Math.min(1.5, Number(adsr.value.r) || 0.25));

  const osc = ctx.createOscillator();
  osc.type = waveform.value;
  osc.frequency.value = frequency.value;
  osc.detune.value = detune.value;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue.value), now + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue.value * s), now + a + d);
  // sustain 0.6s then release
  g.gain.setValueAtTime(Math.max(0.0002, gainValue.value * s), now + a + d + 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, now + a + d + 0.6 + r);

  // 为了可视化，接入 analyser
  teardownGraph();
  analyser.value = ctx.createAnalyser();
  analyser.value.fftSize = 2048;
  analyser.value.smoothingTimeConstant = 0.85;
  master.value = ctx.createGain();
  master.value.gain.value = 1;
  analyser.value.connect(master.value);
  master.value.connect(ctx.destination);

  osc.connect(g);
  g.connect(analyser.value);

  try {
    osc.start(now);
    osc.stop(now + a + d + 0.6 + r + 0.05);
  } catch {
    // ignore
  }

  isPlaying.value = true;
  tick();
  setTimeout(() => {
    isPlaying.value = false;
    teardownGraph();
  }, (a + d + 0.6 + r + 0.1) * 1000);
};

watch([frequency, detune, waveform, gainValue], () => {
  if (!isPlaying.value) return;
  try {
    if (oscA.value) {
      oscA.value.frequency.value = frequency.value;
      oscA.value.detune.value = detune.value;
      oscA.value.type = waveform.value;
    }
    if (oscB.value) {
      oscB.value.frequency.value = frequency.value;
      oscB.value.detune.value = detune.value;
      oscB.value.type = waveform.value;
    }
    if (mainGain.value) mainGain.value.gain.value = gainValue.value;
  } catch {
    // ignore
  }
});

watch([phaseDeg, frequency], () => {
  if (!isPlaying.value) return;
  if (props.mode !== 'phase') return;
  try {
    teardownGraph();
    buildGraph();
    oscA.value?.start();
    oscB.value?.start?.();
    tick();
  } catch {
    // ignore
  }
});

watch(filterCutoff, () => {
  if (!isPlaying.value) return;
  try {
    if (filter.value) filter.value.frequency.value = filterCutoff.value;
  } catch {
    // ignore
  }
});

watch(
  () => adsr.value,
  () => {
    if (props.mode === 'envelope') drawEnvelopePreview();
  },
  { deep: true }
);

onMounted(() => {
  if (props.mode === 'envelope') drawEnvelopePreview();
});

onBeforeUnmount(() => {
  stop();
});
</script>

<template>
  <div class="sound-lab">
    <div class="header">
      <div>
        <div class="title">{{ modeTitle }}</div>
        <div class="subtitle">
          <template v-if="mode === 'frequency'">拖动频率，观察示波器与频谱如何变化。</template>
          <template v-else-if="mode === 'loudness'">调整 Gain，感受“物理振幅”和“主观响度”的区别。</template>
          <template v-else-if="mode === 'timbre'">切换波形/滤波，观察泛音结构与音色变化。</template>
          <template v-else-if="mode === 'phase'">调相位差，观察叠加后的波形如何增强/抵消。</template>
          <template v-else>用 ADSR 雕刻“声音的时间形态”。</template>
        </div>
      </div>
      <button class="play" :class="{ playing: isPlaying }" @click="toggle" v-if="mode !== 'envelope'">
        <i :class="isPlaying ? 'ph-bold ph-pause' : 'ph-bold ph-play'"></i>
        <span>{{ isPlaying ? '停止' : '播放' }}</span>
      </button>
      <button class="play" @click="triggerEnvelope" v-else>
        <i class="ph-bold ph-sparkle"></i>
        <span>触发声音</span>
      </button>
    </div>

    <div class="controls">
      <div class="ctrl">
        <div class="label">频率</div>
        <div class="row">
          <input v-model.number="frequency" type="range" min="20" max="2000" step="1" />
          <div class="value">{{ Math.round(frequency) }} Hz</div>
        </div>
        <div v-if="nearestNote" class="hint">
          最近音高：<span class="mono">{{ nearestNote.label }}</span>
          <span class="sep">·</span>
          偏差 <span class="mono">{{ nearestNote.cents }} cents</span>
        </div>
      </div>

      <div class="ctrl">
        <div class="label">波形</div>
        <div class="row">
          <select v-model="waveform">
            <option v-for="o in waveformOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
          </select>
          <div class="value mono">{{ waveform }}</div>
        </div>
      </div>

      <div class="ctrl">
        <div class="label">Detune</div>
        <div class="row">
          <input v-model.number="detune" type="range" min="-1200" max="1200" step="1" />
          <div class="value">{{ detune }} cents</div>
        </div>
      </div>

      <div class="ctrl">
        <div class="label">Gain</div>
        <div class="row">
          <input v-model.number="gainValue" type="range" min="0" max="1" step="0.01" />
          <div class="value">{{ gainValue.toFixed(2) }}</div>
        </div>
        <div class="hint">
          约 <span class="mono">{{ gainDb.toFixed(1) }} dB</span>
        </div>
      </div>

      <div class="ctrl" v-if="mode === 'phase'">
        <div class="label">相位差</div>
        <div class="row">
          <input v-model.number="phaseDeg" type="range" min="0" max="180" step="1" />
          <div class="value">{{ Math.round(phaseDeg) }}°</div>
        </div>
        <div class="hint">0° 叠加增强 · 180° 叠加抵消</div>
      </div>

      <div class="ctrl" v-if="mode === 'timbre'">
        <div class="label">低通滤波</div>
        <div class="row">
          <input v-model.number="filterCutoff" type="range" min="80" max="24000" step="10" />
          <div class="value">{{ Math.round(filterCutoff) }} Hz</div>
        </div>
        <div class="hint">向左移动会削掉高频泛音，音色更“暖”。</div>
      </div>

      <div class="ctrl" v-if="mode === 'envelope'">
        <div class="label">ADSR</div>
        <div class="grid">
          <label class="pair">
            <span>A</span>
            <input v-model.number="adsr.a" type="range" min="0.005" max="1.2" step="0.005" />
            <span class="mono">{{ adsr.a.toFixed(2) }}s</span>
          </label>
          <label class="pair">
            <span>D</span>
            <input v-model.number="adsr.d" type="range" min="0.005" max="1.2" step="0.005" />
            <span class="mono">{{ adsr.d.toFixed(2) }}s</span>
          </label>
          <label class="pair">
            <span>S</span>
            <input v-model.number="adsr.s" type="range" min="0" max="1" step="0.01" />
            <span class="mono">{{ adsr.s.toFixed(2) }}</span>
          </label>
          <label class="pair">
            <span>R</span>
            <input v-model.number="adsr.r" type="range" min="0.005" max="1.5" step="0.005" />
            <span class="mono">{{ adsr.r.toFixed(2) }}s</span>
          </label>
        </div>
        <canvas ref="envPreviewRef" width="560" height="120" class="env-canvas"></canvas>
      </div>
    </div>

    <div class="viz">
      <div class="panel">
        <div class="panel-title">示波器</div>
        <canvas ref="oscCanvasRef" width="560" height="140" class="canvas"></canvas>
      </div>
      <div class="panel" v-if="mode !== 'loudness' && mode !== 'envelope'">
        <div class="panel-title">频谱</div>
        <canvas ref="specCanvasRef" width="560" height="140" class="canvas"></canvas>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sound-lab {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.8);
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.title {
  font-size: 14px;
  font-weight: 800;
  color: rgb(17, 20, 24);
}

.subtitle {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(91, 101, 110);
  max-width: 560px;
  line-height: 1.45;
}

.play {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, rgb(34, 199, 184), rgb(245, 178, 74));
  color: white;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.play.playing {
  background: linear-gradient(135deg, rgb(240, 106, 90), rgb(245, 178, 74));
}

.controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.ctrl {
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.label {
  font-size: 12px;
  font-weight: 800;
  color: rgb(17, 20, 24);
  margin-bottom: 8px;
}

.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}

input[type='range'] {
  width: 100%;
}

select {
  width: 100%;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(255, 255, 255, 0.9);
  font-weight: 700;
  color: rgb(91, 101, 110);
}

.value {
  font-size: 12px;
  font-weight: 800;
  color: rgb(17, 20, 24);
  min-width: 72px;
  text-align: right;
}

.hint {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 650;
  color: rgb(91, 101, 110);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-weight: 800;
  color: rgb(15, 118, 110);
}

.sep {
  margin: 0 6px;
  color: rgba(0, 0, 0, 0.25);
}

.viz {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.panel {
  border-radius: 16px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.65);
  padding: 12px;
}

.panel-title {
  font-size: 12px;
  font-weight: 800;
  color: rgb(91, 101, 110);
  margin-bottom: 8px;
}

.canvas,
.env-canvas {
  width: 100%;
  height: auto;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.65);
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.pair {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  font-weight: 800;
  color: rgb(17, 20, 24);
}
</style>

