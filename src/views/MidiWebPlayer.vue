<script setup>
import { computed, markRaw, onBeforeUnmount, ref, toRaw } from 'vue';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import UiButton from '../components/UiButton.vue';

const errorMsg = ref('');
const fileName = ref('');
const midiData = ref(null);
const isPlaying = ref(false);
const isLoading = ref(false);
const bpm = ref(120);

const midiAccess = ref(null);
const midiInputs = ref([]);
const selectedInputId = ref('');
const liveEnabled = ref(false);

const activeSynths = new Set();
let liveSynth = null;

const FLUTE_SAMPLE_BASE = '/Flute/';
const FLUTE_SAMPLE_URLS = Object.freeze({
  A4: 'Flute.vib.ff.A4.stereo.wav',
  A5: 'Flute.vib.ff.A5.stereo.wav',
  A6: 'Flute.vib.ff.A6.stereo.wav',
  Ab4: 'Flute.vib.ff.Ab4.stereo.wav',
  Ab5: 'Flute.vib.ff.Ab5.stereo.wav',
  Ab6: 'Flute.vib.ff.Ab6.stereo.wav',
  B3: 'Flute.vib.ff.B3.stereo.wav',
  B4: 'Flute.vib.ff.B4.stereo.wav',
  B5: 'Flute.vib.ff.B5.stereo.wav',
  B6: 'Flute.vib.ff.B6.stereo.wav',
  Bb4: 'Flute.vib.ff.Bb4.stereo.wav',
  Bb5: 'Flute.vib.ff.Bb5.stereo.wav',
  Bb6: 'Flute.vib.ff.Bb6.stereo.wav',
  C4: 'Flute.vib.ff.C4.stereo.wav',
  C5: 'Flute.vib.ff.C5.stereo.wav',
  C6: 'Flute.vib.ff.C6.stereo.wav',
  D4: 'Flute.vib.ff.D4.stereo.wav',
  D5: 'Flute.vib.ff.D5.stereo.wav',
  D6: 'Flute.vib.ff.D6.stereo.wav',
  Db4: 'Flute.vib.ff.Db4.stereo.wav',
  Db5: 'Flute.vib.ff.Db5.stereo.wav',
  Db6: 'Flute.vib.ff.Db6.stereo.wav',
  Db7: 'Flute.vib.ff.Db7.stereo.wav',
  E4: 'Flute.vib.ff.E4.stereo.wav',
  E5: 'Flute.vib.ff.E5.stereo.wav',
  E6: 'Flute.vib.ff.E6.stereo.wav',
  Eb4: 'Flute.vib.ff.Eb4.stereo.wav',
  Eb5: 'Flute.vib.ff.Eb5.stereo.wav',
  Eb6: 'Flute.vib.ff.Eb6.stereo.wav',
  F4: 'Flute.vib.ff.F4.stereo.wav',
  F5: 'Flute.vib.ff.F5.stereo.wav',
  F6: 'Flute.vib.ff.F6.stereo.wav',
  G4: 'Flute.vib.ff.G4.stereo.wav',
  G5: 'Flute.vib.ff.G5.stereo.wav',
  G6: 'Flute.vib.ff.G6.stereo.wav',
  Gb4: 'Flute.vib.ff.Gb4.stereo.wav',
  Gb5: 'Flute.vib.ff.Gb5.stereo.wav',
  Gb6: 'Flute.vib.ff.Gb6.stereo.wav',
});

const GUITAR_SAMPLE_BASE = '/guitar/';
const GUITAR_SAMPLE_URLS_PIANO_NORMAL = Object.freeze({
  E2: 'guitar_E2_very-long_piano_normal.mp3',
  F2: 'guitar_F2_very-long_piano_normal.mp3',
  'F#2': 'guitar_Fs2_very-long_piano_normal.mp3',
  G2: 'guitar_G2_very-long_piano_normal.mp3',
  'G#2': 'guitar_Gs2_very-long_piano_normal.mp3',
  A2: 'guitar_A2_very-long_piano_normal.mp3',
  'A#2': 'guitar_As2_very-long_piano_normal.mp3',
  B2: 'guitar_B2_very-long_piano_normal.mp3',
  C3: 'guitar_C3_very-long_piano_normal.mp3',
  'C#3': 'guitar_Cs3_very-long_piano_normal.mp3',
  D3: 'guitar_D3_very-long_piano_normal.mp3',
  'D#3': 'guitar_Ds3_very-long_piano_normal.mp3',
  E3: 'guitar_E3_very-long_piano_normal.mp3',
  F3: 'guitar_F3_very-long_piano_normal.mp3',
  'F#3': 'guitar_Fs3_very-long_piano_normal.mp3',
  G3: 'guitar_G3_very-long_piano_normal.mp3',
  'G#3': 'guitar_Gs3_very-long_piano_normal.mp3',
  A3: 'guitar_A3_very-long_piano_normal.mp3',
  'A#3': 'guitar_As3_very-long_piano_normal.mp3',
  B3: 'guitar_B3_very-long_piano_normal.mp3',
  C4: 'guitar_C4_very-long_piano_normal.mp3',
  'C#4': 'guitar_Cs4_very-long_piano_normal.mp3',
  D4: 'guitar_D4_very-long_piano_normal.mp3',
  'D#4': 'guitar_Ds4_very-long_piano_normal.mp3',
  E4: 'guitar_E4_very-long_piano_normal.mp3',
  F4: 'guitar_F4_very-long_piano_normal.mp3',
  'F#4': 'guitar_Fs4_very-long_piano_normal.mp3',
  G4: 'guitar_G4_very-long_piano_normal.mp3',
  'G#4': 'guitar_Gs4_very-long_piano_normal.mp3',
  A4: 'guitar_A4_very-long_piano_normal.mp3',
  'A#4': 'guitar_As4_very-long_piano_normal.mp3',
  B4: 'guitar_B4_very-long_piano_normal.mp3',
  D5: 'guitar_D5_very-long_piano_normal.mp3',
  'D#5': 'guitar_Ds5_very-long_piano_normal.mp3',
  E5: 'guitar_E5_very-long_piano_normal.mp3',
  C6: 'guitar_C6_very-long_piano_normal.mp3',
});

const GUITAR_SAMPLE_URLS_PIANO_HARMONICS = Object.freeze({
  A3: 'guitar_A3_very-long_piano_harmonics.mp3',
  A4: 'guitar_A4_very-long_piano_harmonics.mp3',
  B3: 'guitar_B3_very-long_piano_harmonics.mp3',
  B4: 'guitar_B4_very-long_piano_harmonics.mp3',
  B5: 'guitar_B5_very-long_piano_harmonics.mp3',
  C4: 'guitar_C4_very-long_piano_harmonics.mp3',
  C5: 'guitar_C5_very-long_piano_harmonics.mp3',
  D4: 'guitar_D4_very-long_piano_harmonics.mp3',
  D5: 'guitar_D5_very-long_piano_harmonics.mp3',
  E3: 'guitar_E3_very-long_piano_harmonics.mp3',
  E4: 'guitar_E4_very-long_piano_harmonics.mp3',
  E5: 'guitar_E5_very-long_piano_harmonics.mp3',
  E6: 'guitar_E6_very-long_piano_harmonics.mp3',
  F4: 'guitar_F4_very-long_piano_harmonics.mp3',
  'F#4': 'guitar_Fs4_very-long_piano_harmonics.mp3',
  'F#5': 'guitar_Fs5_very-long_piano_harmonics.mp3',
  G3: 'guitar_G3_very-long_piano_harmonics.mp3',
  G4: 'guitar_G4_very-long_piano_harmonics.mp3',
  G5: 'guitar_G5_very-long_piano_harmonics.mp3',
});

const GUITAR_SAMPLE_URLS_PIANO_HARMONICS_MIXED = Object.freeze({
  ...GUITAR_SAMPLE_URLS_PIANO_NORMAL,
  ...GUITAR_SAMPLE_URLS_PIANO_HARMONICS,
});

const INSTRUMENT_LIBRARY = Object.freeze([
  { id: 'guitar_piano_normal', label: '原声吉他（piano normal）', type: 'sampler', volumeDb: -6, baseUrl: GUITAR_SAMPLE_BASE, urls: GUITAR_SAMPLE_URLS_PIANO_NORMAL },
  { id: 'guitar_piano_harmonics', label: '原声吉他（piano harmonics）', type: 'sampler', volumeDb: -6, baseUrl: GUITAR_SAMPLE_BASE, urls: GUITAR_SAMPLE_URLS_PIANO_HARMONICS_MIXED },
  { id: 'flute_vib', label: '长笛（采样）', type: 'sampler', volumeDb: -6, baseUrl: FLUTE_SAMPLE_BASE, urls: FLUTE_SAMPLE_URLS },
  { id: 'piano_soft', label: '柔和钢琴', voice: 'Synth', poly: true, volumeDb: -8, options: { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.16, sustain: 0.28, release: 0.22 } } },
  { id: 'pad_warm', label: '温暖 Pad', voice: 'FMSynth', poly: true, volumeDb: -12, options: { harmonicity: 1.5, modulationIndex: 6, envelope: { attack: 0.12, decay: 0.5, sustain: 0.75, release: 0.9 } } },
  { id: 'lead_clean', label: '清晰 Lead', voice: 'MonoSynth', poly: true, volumeDb: -10, options: { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, decay: 0.12, sustain: 0.35, release: 0.1 } } },
  { id: 'bass_sub', label: '低频 Bass', voice: 'MonoSynth', poly: true, volumeDb: -8, options: { oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.18, sustain: 0.6, release: 0.12 } } },
  { id: 'pluck_glass', label: '玻璃拨弦', voice: 'Synth', poly: true, volumeDb: -8, options: { oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.18, sustain: 0.1, release: 0.2 } } },
]);

const instrumentId = ref('piano_soft');

const createSynth = (presetId) => {
  const preset = INSTRUMENT_LIBRARY.find((p) => p.id === presetId) || INSTRUMENT_LIBRARY[0];
  if (preset.type === 'sampler') {
    const sampler = new Tone.Sampler({
      urls: preset.urls || {},
      baseUrl: String(preset.baseUrl || '/'),
      release: 0.8,
    }).toDestination();
    sampler.volume.value = Number(preset.volumeDb ?? -6);
    activeSynths.add(sampler);
    return sampler;
  }
  const voice = preset.voice;
  let VoiceClass = Tone.Synth;
  if (voice === 'FMSynth') VoiceClass = Tone.FMSynth;
  if (voice === 'AMSynth') VoiceClass = Tone.AMSynth;
  if (voice === 'MonoSynth') VoiceClass = Tone.MonoSynth;

  const synth = new Tone.PolySynth(VoiceClass, preset.options || {});
  synth.volume.value = Number(preset.volumeDb ?? -8);
  synth.toDestination();
  activeSynths.add(synth);
  return synth;
};

const clearSynths = () => {
  for (const s of Array.from(activeSynths)) {
    try { s.dispose?.(); } catch { }
  }
  activeSynths.clear();
};

const stopPlayback = async () => {
  try {
    Tone.Transport.stop();
    Tone.Transport.cancel();
  } catch { }
  clearSynths();
  isPlaying.value = false;
};

const parseMidiFile = async (file) => {
  errorMsg.value = '';
  if (!file) return;
  const name = String(file.name || '').toLowerCase();
  if (!name.endsWith('.mid') && !name.endsWith('.midi')) {
    errorMsg.value = '仅支持 .mid / .midi 文件';
    return;
  }
  isLoading.value = true;
  try {
    const ab = await file.arrayBuffer();
    const midi = new Midi(ab);
    midiData.value = markRaw(midi);
    fileName.value = file.name || '';
    const t = midi.header?.tempos?.[0]?.bpm;
    bpm.value = Number.isFinite(t) ? Math.round(t) : 120;
  } catch (e) {
    console.error(e);
    errorMsg.value = 'MIDI 解析失败';
  } finally {
    isLoading.value = false;
  }
};

const onPickMidi = (e) => {
  const file = e?.target?.files?.[0];
  if (!file) return;
  parseMidiFile(file);
  e.target.value = '';
};

const playMidi = async () => {
  if (!midiData.value) {
    errorMsg.value = '请先上传 MIDI 文件';
    return;
  }
  await Tone.start();
  await stopPlayback();

  const synth = createSynth(instrumentId.value);
  const midi = toRaw(midiData.value);
  const tracks = midi?.tracks || [];

  for (const track of tracks) {
    for (const note of track.notes || []) {
      const timeSec = Math.max(0, Number(note.time) || 0);
      const durSec = Math.max(0.03, Number(note.duration) || 0.1);
      const velocity = Math.max(0.05, Math.min(1, Number(note.velocity) || 0.8));
      const noteName = note.name || Tone.Frequency(note.midi, 'midi').toNote();
      Tone.Transport.scheduleOnce((t) => {
        synth.triggerAttackRelease(noteName, durSec, t, velocity);
      }, timeSec);
    }
  }

  Tone.Transport.start();
  isPlaying.value = true;
};

const stopMidi = async () => {
  await stopPlayback();
};

const requestMidiAccess = async () => {
  errorMsg.value = '';
  if (!navigator.requestMIDIAccess) {
    errorMsg.value = '当前浏览器不支持 Web MIDI API';
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    midiAccess.value = access;
    const inputs = Array.from(access.inputs.values());
    midiInputs.value = inputs.map((input) => ({ id: input.id, name: input.name || 'MIDI Input' }));
    if (!selectedInputId.value && inputs[0]) selectedInputId.value = inputs[0].id;
    access.onstatechange = () => {
      const nextInputs = Array.from(access.inputs.values());
      midiInputs.value = nextInputs.map((input) => ({ id: input.id, name: input.name || 'MIDI Input' }));
    };
  } catch (e) {
    console.error(e);
    if (String(e?.name || '') === 'NotAllowedError') {
      errorMsg.value = '未授权使用 Web MIDI，请在浏览器弹窗中允许权限';
      return;
    }
    errorMsg.value = '获取 MIDI 设备失败';
  }
};

const handleMidiMessage = (message) => {
  if (!liveSynth) return;
  const data = message?.data || [];
  const status = data[0] & 0xf0;
  const midi = data[1];
  const velocity = data[2] ?? 0;
  const noteName = Tone.Frequency(midi, 'midi').toNote();
  if (status === 0x90 && velocity > 0) {
    liveSynth.triggerAttack(noteName, undefined, velocity / 127);
  } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
    liveSynth.triggerRelease(noteName);
  }
};

const enableLiveInput = async () => {
  errorMsg.value = '';
  if (!midiAccess.value) {
    await requestMidiAccess();
  }
  const access = midiAccess.value;
  if (!access) return;
  const input = access.inputs.get(selectedInputId.value);
  if (!input) {
    errorMsg.value = '未找到选中的 MIDI 设备';
    return;
  }

  await Tone.start();
  if (liveSynth) {
    try { liveSynth.dispose?.(); } catch { }
  }
  liveSynth = createSynth(instrumentId.value);
  input.onmidimessage = handleMidiMessage;
  liveEnabled.value = true;
};

const disableLiveInput = () => {
  const access = midiAccess.value;
  if (access) {
    const input = access.inputs.get(selectedInputId.value);
    if (input) input.onmidimessage = null;
  }
  liveEnabled.value = false;
  try { liveSynth?.dispose?.(); } catch { }
  liveSynth = null;
};

const trackCount = computed(() => toRaw(midiData.value)?.tracks?.length || 0);

onBeforeUnmount(() => {
  disableLiveInput();
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
          <h2 class="text-2xl font-extrabold text-slate-900">MIDI 播放器（Web MIDI + Web Audio）</h2>
        </div>
      </div>

      <div class="glass-card rounded-2xl border border-white/70 p-6 space-y-4">
        <div>
          <div class="text-sm font-semibold text-slate-700">上传 MIDI 文件</div>
          <input type="file" accept="audio/midi,audio/x-midi,.mid,.midi" class="mt-2 text-sm" @change="onPickMidi" />
          <div class="text-xs text-slate-500 mt-1" v-if="fileName">已选择：{{ fileName }}</div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div class="text-sm font-semibold text-slate-700">乐器</div>
            <select v-model="instrumentId" class="w-full input-glass rounded-lg px-3 py-2 text-sm mt-2">
              <option v-for="i in INSTRUMENT_LIBRARY" :key="i.id" :value="i.id">{{ i.label }}</option>
            </select>
          </div>
          <div>
            <div class="text-sm font-semibold text-slate-700">BPM</div>
            <input v-model.number="bpm" type="number" class="w-full input-glass rounded-lg px-3 py-2 text-sm mt-2" min="20" max="300" />
          </div>
        </div>

        <div class="flex items-center gap-2">
          <UiButton @click="playMidi" class="px-4 py-2 rounded-lg text-sm font-semibold">播放</UiButton>
          <UiButton @click="stopMidi" variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold">停止</UiButton>
        </div>

        <div class="text-xs text-slate-500" v-if="trackCount">tracks: {{ trackCount }}</div>
        <div v-if="errorMsg" class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-700 text-sm flex items-center gap-2">
          <i class="ph-bold ph-warning-circle"></i>
          {{ errorMsg }}
        </div>
      </div>

      <div class="glass-card rounded-2xl border border-white/70 p-6 space-y-4 mt-6">
        <div class="text-sm font-semibold text-slate-700">Web MIDI 设备输入</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <select v-model="selectedInputId" class="w-full input-glass rounded-lg px-3 py-2 text-sm">
            <option value="">选择设备…</option>
            <option v-for="d in midiInputs" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
          <div class="flex items-center gap-2">
            <UiButton @click="enableLiveInput" class="px-4 py-2 rounded-lg text-sm font-semibold">启用设备</UiButton>
            <UiButton @click="disableLiveInput" variant="ghost" class="px-4 py-2 rounded-lg text-sm font-semibold">停用</UiButton>
          </div>
        </div>
        <div class="text-xs text-slate-500" v-if="liveEnabled">设备已启用，按键可实时发声</div>
      </div>
    </div>
  </div>
</template>