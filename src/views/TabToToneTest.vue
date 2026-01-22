<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import * as Tone from 'tone';
import UiButton from '../components/UiButton.vue';

const inputText = ref('');
const errorMsg = ref('');
const parsed = ref(null);
const isPlaying = ref(false);
const synths = new Set();

const defaultExample = `{
  "title": "晴天",
  "bpm": 60,
  "timeSignature": [4, 4],
  "tracks": [
    {
      "name": "Guitar",
      "instrument": "pluck",
      "notes": [
        { "time": 0, "duration": 0.5, "note": "E4", "velocity": 0.8 },
        { "time": 0.5, "duration": 0.5, "note": "G4", "velocity": 0.8 },
        { "time": 1, "duration": 1, "note": ["C4","E4","G4"], "velocity": 0.75 }
      ]
    }
  ]
}`;

const clearSynths = () => {
  for (const s of Array.from(synths)) {
    try { s.dispose?.(); } catch { }
  }
  synths.clear();
};

const stopPlayback = async () => {
  try {
    Tone.Transport.stop();
    Tone.Transport.cancel();
  } catch { }
  clearSynths();
  isPlaying.value = false;
};

const parseInput = () => {
  errorMsg.value = '';
  parsed.value = null;
  const text = String(inputText.value || '').trim();
  if (!text) {
    errorMsg.value = '请输入 JSON。';
    return null;
  }
  try {
    const obj = JSON.parse(text);
    parsed.value = obj;
    return obj;
  } catch (e) {
    errorMsg.value = 'JSON 解析失败，请检查格式。';
    return null;
  }
};

const resolveBpm = (obj) => {
  const bpm = Math.max(20, Math.min(300, Number(obj?.bpm) || 120));
  return bpm;
};

const createInstrument = (kind) => {
  const key = String(kind || '').toLowerCase();
  if (key === 'pluck') {
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.18, sustain: 0.1, release: 0.2 },
    }).toDestination();
    synth.volume.value = -8;
    return synth;
  }
  if (key === 'fm') {
    const synth = new Tone.PolySynth(Tone.FMSynth).toDestination();
    synth.volume.value = -10;
    return synth;
  }
  if (key === 'am') {
    const synth = new Tone.PolySynth(Tone.AMSynth).toDestination();
    synth.volume.value = -10;
    return synth;
  }
  if (key === 'sine') {
    const synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' } }).toDestination();
    synth.volume.value = -10;
    return synth;
  }
  const synth = new Tone.PolySynth(Tone.Synth).toDestination();
  synth.volume.value = -8;
  return synth;
};

const normalizeNote = (note) => {
  if (Array.isArray(note)) return note;
  return note;
};

const playParsed = async () => {
  const obj = parsed.value || parseInput();
  if (!obj) return;

  await Tone.start();
  await stopPlayback();

  const bpm = resolveBpm(obj);
  Tone.Transport.bpm.value = bpm;

  const tracks = Array.isArray(obj?.tracks) ? obj.tracks : [];
  if (!tracks.length) {
    errorMsg.value = 'tracks 为空。';
    return;
  }

  for (const track of tracks) {
    const synth = createInstrument(track?.instrument);
    synths.add(synth);

    const notes = Array.isArray(track?.notes) ? track.notes : [];
    for (const n of notes) {
      const timeBeats = Math.max(0, Number(n?.time) || 0);
      const durBeats = Math.max(0.05, Number(n?.duration) || 0.25);
      const velocity = Math.max(0.05, Math.min(1, Number(n?.velocity) || 0.8));
      const rawNote = normalizeNote(n?.note ?? n?.midi);

      const timeSec = (60 / bpm) * timeBeats;
      const durSec = (60 / bpm) * durBeats;

      if (Array.isArray(rawNote)) {
        const chord = rawNote.map((x) => x);
        Tone.Transport.scheduleOnce((t) => {
          synth.triggerAttackRelease(chord, durSec, t, velocity);
        }, timeSec);
      } else if (rawNote != null) {
        Tone.Transport.scheduleOnce((t) => {
          synth.triggerAttackRelease(rawNote, durSec, t, velocity);
        }, timeSec);
      }
    }
  }

  Tone.Transport.start();
  isPlaying.value = true;
};

const fillExample = () => {
  inputText.value = defaultExample;
  parseInput();
};

const metaText = computed(() => {
  const obj = parsed.value;
  if (!obj) return '';
  const title = String(obj?.title || '').trim();
  const bpm = resolveBpm(obj);
  return title ? `${title} · bpm ${bpm}` : `bpm ${bpm}`;
});

onBeforeUnmount(() => {
  stopPlayback();
});
</script>

<template>
  <div class="page pb-12">
    <div class="page-container max-w-5xl">
      <div class="flex items-center justify-between mb-8">
        <div class="flex items-center gap-4">
          <UiButton @click="$router.back()" variant="ghost" class="px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-semibold">
            <i class="ph-bold ph-arrow-left"></i> 返回
          </UiButton>
          <h2 class="text-2xl font-extrabold text-slate-900">吉他谱 → Tone.js 测试页</h2>
        </div>
      </div>

      <div class="glass-card rounded-2xl border border-white/70 p-6 space-y-4">
        <div>
          <label class="text-sm font-semibold text-slate-700">粘贴大模型输出 JSON</label>
          <textarea
            v-model="inputText"
            class="w-full mt-2 input-glass rounded-xl py-3 px-4 text-sm min-h-[180px]"
            placeholder="粘贴 JSON..."
          ></textarea>
        </div>
        <div class="flex items-center gap-2">
          <UiButton @click="parseInput" class="px-4 py-2 rounded-lg text-sm font-semibold">解析</UiButton>
          <UiButton @click="playParsed" variant="secondary" class="px-4 py-2 rounded-lg text-sm font-semibold">播放</UiButton>
          <UiButton @click="stopPlayback" variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold">停止</UiButton>
          <UiButton @click="fillExample" variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold">填入示例</UiButton>
        </div>

        <div v-if="errorMsg" class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-700 text-sm flex items-center gap-2">
          <i class="ph-bold ph-warning-circle"></i>
          {{ errorMsg }}
        </div>
      </div>

      <div v-if="parsed" class="mt-6 glass-card rounded-2xl border border-white/70 p-6 space-y-2">
        <div class="text-sm font-semibold text-slate-700">解析结果</div>
        <div class="text-xs text-slate-500">{{ metaText }}</div>
        <div class="text-xs text-slate-500" v-if="parsed?.tracks?.length">tracks: {{ parsed.tracks.length }}</div>
        <div class="text-xs text-slate-500" v-if="isPlaying">播放中...</div>
      </div>
    </div>
  </div>
</template>