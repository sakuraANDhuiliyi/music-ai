<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import UiButton from '../components/UiButton.vue';
import { useUser } from '../composables/useUser.js';
import { ensureSharedAudioRunning, getSharedAudioContext } from '../audio/sharedAudioContext.js';
import { notifyPlaybackStop, registerPlaybackSource, requestPlaybackStart } from '../audio/playbackCoordinator.js';

const router = useRouter();
const { user } = useUser();

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOURCE_ID = 'piano';

const audioCtx = ref(null);
const masterGain = ref(null);
const mediaDest = ref(null);
const activeNotes = reactive(new Map());
const activeSet = ref(new Set());
const keyToMidi = ref(new Map());
let unregisterPlayback = null;

const sheets = ref([]);
const sheetTitle = ref('');
const sheetContent = ref('');

const isRecording = ref(false);
const recorder = ref(null);
const recordChunks = ref([]);
const recordings = ref([]);

const whiteKeys = ref([]);
const blackKeys = ref([]);

const canPlay = computed(() => Boolean(user.value));

const ensureAudio = async () => {
  if (!audioCtx.value) {
    const ctx = getSharedAudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    gain.connect(ctx.destination);
    const dest = ctx.createMediaStreamDestination();
    gain.connect(dest);
    audioCtx.value = ctx;
    masterGain.value = gain;
    mediaDest.value = dest;
  }
  await ensureSharedAudioRunning();
};

const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

const noteLabel = (midi) => {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
};

const getWhiteKeyStyle = (index) => {
  const total = Math.max(1, whiteKeys.value.length);
  const whiteKeyWidth = 100 / total;
  return {
    width: `${whiteKeyWidth}%`,
    left: `${index * whiteKeyWidth}%`
  };
};

const getBlackKeyStyle = (parentWhiteIndex) => {
  const total = Math.max(1, whiteKeys.value.length);
  const whiteKeyWidth = 100 / total;
  const blackKeyWidth = whiteKeyWidth * 0.7;
  const left = (parentWhiteIndex + 1) * whiteKeyWidth - blackKeyWidth / 2;
  return {
    width: `${blackKeyWidth}%`,
    left: `${left}%`
  };
};

const buildKeys = () => {
  const white = [];
  const black = [];
  const map = new Map();

  // v3 的键盘映射（只映射部分白键：C2 ~ C7）
  const customKeyMap = {
    C2: '1',
    D2: '2',
    E2: '3',
    F2: '4',
    G2: '5',
    A2: '6',
    B2: '7',
    C3: '8',
    D3: '9',
    E3: '0',
    F3: 'Q',
    G3: 'W',
    A3: 'E',
    B3: 'R',
    C4: 'T',
    D4: 'Y',
    E4: 'U',
    F4: 'I',
    G4: 'O',
    A4: 'P',
    B4: 'A',
    C5: 'S',
    D5: 'D',
    E5: 'F',
    F5: 'G',
    G5: 'H',
    A5: 'J',
    B5: 'K',
    C6: 'L',
    D6: 'Z',
    E6: 'X',
    F6: 'C',
    G6: 'V',
    A6: 'B',
    B6: 'N',
    C7: 'M'
  };

  // 88 键：A0 (midi 21) ~ C8 (midi 108)
  let whiteIndex = 0;
  let lastWhiteIndex = -1;
  for (let midi = 21; midi <= 108; midi += 1) {
    const noteName = noteLabel(midi);
    const isWhiteKey = !NOTE_NAMES[midi % 12].includes('#');
    const mappedLabel = customKeyMap[noteName] || '';

    if (isWhiteKey) {
      const key = {
        midi,
        noteName,
        label: mappedLabel,
        index: whiteIndex
      };
      white.push(key);
      lastWhiteIndex = whiteIndex;
      whiteIndex += 1;
    } else {
      const key = {
        midi,
        noteName,
        label: mappedLabel,
        parentIndex: Math.max(0, lastWhiteIndex)
      };
      black.push(key);
    }

    if (mappedLabel) {
      map.set(mappedLabel.toLowerCase(), midi);
    }
  }

  whiteKeys.value = white;
  blackKeys.value = black;
  keyToMidi.value = map;
};

const startNote = async (midi) => {
  if (!canPlay.value) return router.push('/login');
  requestPlaybackStart(SOURCE_ID);
  await ensureAudio();
  if (activeNotes.has(midi)) return;

  const ctx = audioCtx.value;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.value = midiToFreq(midi);

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.6, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.3, now + 0.18);

  osc.connect(gain);
  gain.connect(masterGain.value);
  osc.start();

  activeNotes.set(midi, { osc, gain });
  activeSet.value = new Set(activeSet.value).add(midi);
};

const stopNote = (midi) => {
  const node = activeNotes.get(midi);
  if (!node || !audioCtx.value) return;
  const now = audioCtx.value.currentTime;
  node.gain.gain.cancelScheduledValues(now);
  node.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  node.osc.stop(now + 0.1);
  activeNotes.delete(midi);
  const next = new Set(activeSet.value);
  next.delete(midi);
  activeSet.value = next;
  if (activeNotes.size === 0) notifyPlaybackStop(SOURCE_ID);
};

const onKeyDown = (e) => {
  if (e.repeat) return;
  const tag = document.activeElement?.tagName || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  const midi = keyToMidi.value.get(String(e.key).toLowerCase());
  if (midi) {
    e.preventDefault();
    startNote(midi);
  }
};

const onKeyUp = (e) => {
  const midi = keyToMidi.value.get(String(e.key).toLowerCase());
  if (midi) {
    e.preventDefault();
    stopNote(midi);
  }
};

const onPointerDown = (midi) => startNote(midi);
const onPointerUp = (midi) => stopNote(midi);

const stopAllNotes = () => {
  for (const midi of Array.from(activeNotes.keys())) {
    try {
      stopNote(midi);
    } catch {
      // ignore
    }
  }
  activeNotes.clear();
  activeSet.value = new Set();
  notifyPlaybackStop(SOURCE_ID);
};

const loadSheets = () => {
  try {
    const raw = localStorage.getItem('pianoSheets');
    sheets.value = raw ? JSON.parse(raw) : [];
  } catch {
    sheets.value = [];
  }
};

const persistSheets = () => {
  localStorage.setItem('pianoSheets', JSON.stringify(sheets.value));
};

const saveSheet = () => {
  const content = sheetContent.value.trim();
  if (!content) return;
  const title = sheetTitle.value.trim() || `乐谱 ${new Date().toLocaleString()}`;
  const item = { id: `${Date.now()}`, title, content, updatedAt: Date.now() };
  sheets.value = [item, ...sheets.value];
  persistSheets();
};

const loadSheet = (item) => {
  sheetTitle.value = item.title;
  sheetContent.value = item.content;
};

const removeSheet = (id) => {
  sheets.value = sheets.value.filter((s) => s.id !== id);
  persistSheets();
};

const startRecording = async () => {
  if (!canPlay.value) return router.push('/login');
  await ensureAudio();

  if (isRecording.value) return;
  recordChunks.value = [];

  try {
    const rec = new MediaRecorder(mediaDest.value.stream);
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordChunks.value.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(recordChunks.value, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      recordings.value = [
        {
          id: `${Date.now()}`,
          name: `录音 ${new Date().toLocaleTimeString()}`,
          url,
          blob
        },
        ...recordings.value
      ];
    };
    recorder.value = rec;
    rec.start();
    isRecording.value = true;
  } catch {
    isRecording.value = false;
  }
};

const stopRecording = () => {
  if (!isRecording.value || !recorder.value) return;
  recorder.value.stop();
  isRecording.value = false;
};

const downloadRecording = (rec) => {
  const a = document.createElement('a');
  a.href = rec.url;
  a.download = `${rec.name}.webm`;
  a.click();
};

onMounted(() => {
  buildKeys();
  loadSheets();
  try {
    unregisterPlayback = registerPlaybackSource(SOURCE_ID, { stop: stopAllNotes });
  } catch {
    unregisterPlayback = null;
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  stopAllNotes();
  unregisterPlayback?.();
});
</script>

<template>
  <div class="page pt-4 pb-16">
    <div class="page-container space-y-6">
      <div class="glass-card rounded-2xl border border-white/70 overflow-hidden">
        <div class="piano-topbar flex flex-col md:flex-row md:items-center md:justify-between gap-4 px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="text-2xl font-bold text-white tracking-wide">Auto Piano</div>
            <div class="text-xs font-semibold text-white/70">Aurora Edition</div>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-xs font-semibold text-white/80">
            <div class="px-3 py-1.5 rounded-full bg-white/10 border border-white/20">C4</div>
            <div class="px-3 py-1.5 rounded-full bg-white/10 border border-white/20">高音立式钢琴</div>
            <div class="px-3 py-1.5 rounded-full bg-white/10 border border-white/20">Standard</div>
            <UiButton
              v-if="!user"
              variant="secondary"
              class="px-3 py-1.5 rounded-full text-xs font-semibold"
              @click="router.push('/login')"
            >
              登录后弹奏
            </UiButton>
          </div>
        </div>

        <div class="piano-shell px-4 pb-6">
          <div class="piano-board overflow-x-auto">
            <div class="piano-container">
              <div class="piano">
                <div
                  v-for="key in whiteKeys"
                  :key="`white-${key.midi}`"
                  :class="['key', 'white', { active: activeSet.has(key.midi) }]"
                  :style="getWhiteKeyStyle(key.index)"
                  @mousedown.stop.prevent="onPointerDown(key.midi)"
                  @mouseup.stop.prevent="onPointerUp(key.midi)"
                  @mouseleave.stop.prevent="onPointerUp(key.midi)"
                >
                  <div class="labels">
                    <span class="key-note">{{ key.noteName }}</span>
                    <span class="key-mapping">{{ key.label }}</span>
                  </div>
                </div>

                <div
                  v-for="key in blackKeys"
                  :key="`black-${key.midi}`"
                  :class="['key', 'black', { active: activeSet.has(key.midi) }]"
                  :style="getBlackKeyStyle(key.parentIndex)"
                  @mousedown.stop.prevent="onPointerDown(key.midi)"
                  @mouseup.stop.prevent="onPointerUp(key.midi)"
                  @mouseleave.stop.prevent="onPointerUp(key.midi)"
                >
                  <div class="labels">
                    <span class="key-note">{{ key.noteName }}</span>
                    <span class="key-mapping">{{ key.label }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-4 flex items-center gap-2 text-xs text-slate-600 font-semibold">
            <i class="ph-bold ph-keyboard"></i>
            你可以用键盘直接弹奏（按键与图示一致）
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="glass-card rounded-2xl border border-white/70 p-6">
          <div class="flex items-center justify-between gap-4">
            <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <i class="ph-bold ph-file-text text-sky-600"></i>
              乐谱存放区
            </div>
            <UiButton variant="primary" class="px-4 py-2 rounded-xl text-white text-xs font-semibold" @click="saveSheet">
              保存乐谱
            </UiButton>
          </div>

          <div class="mt-4 space-y-3">
            <input v-model="sheetTitle" type="text" class="w-full input-glass rounded-xl px-4 py-2 text-sm" placeholder="乐谱标题（可选）" />
            <textarea v-model="sheetContent" class="w-full h-40 input-glass rounded-xl px-4 py-3 text-sm font-mono" placeholder="粘贴/输入你的文字谱..." />
          </div>

          <div class="mt-4 space-y-2">
            <div v-if="!sheets.length" class="text-xs text-slate-500 font-semibold">还没有保存任何乐谱</div>
            <div v-for="item in sheets" :key="item.id" class="flex items-center justify-between gap-3 bg-white/55 border border-white/70 rounded-xl px-3 py-2">
              <div class="min-w-0">
                <div class="text-sm font-extrabold text-slate-900 truncate">{{ item.title }}</div>
                <div class="text-[11px] text-slate-500 font-semibold">保存于 {{ new Date(item.updatedAt).toLocaleString() }}</div>
              </div>
              <div class="flex items-center gap-2">
                <UiButton variant="ghost" class="px-2 py-1 rounded text-xs font-semibold" @click="loadSheet(item)">载入</UiButton>
                <UiButton variant="ghost" class="px-2 py-1 rounded text-xs font-semibold text-rose-600" @click="removeSheet(item.id)">删除</UiButton>
              </div>
            </div>
          </div>
        </div>

        <div class="glass-card rounded-2xl border border-white/70 p-6">
          <div class="flex items-center justify-between gap-4">
            <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <i class="ph-bold ph-microphone-stage text-sky-600"></i>
              录音素材
            </div>
            <div class="flex items-center gap-2">
              <UiButton
                v-if="!isRecording"
                variant="primary"
                class="px-4 py-2 rounded-xl text-white text-xs font-semibold"
                @click="startRecording"
              >
                开始录音
              </UiButton>
              <UiButton
                v-else
                variant="secondary"
                class="px-4 py-2 rounded-xl text-xs font-semibold text-rose-600"
                @click="stopRecording"
              >
                停止录音
              </UiButton>
            </div>
          </div>

          <div class="mt-4 space-y-3">
            <div v-if="!recordings.length" class="text-xs text-slate-500 font-semibold">
              录音会保存为素材，可直接试听或下载。
            </div>

            <div v-for="rec in recordings" :key="rec.id" class="bg-white/55 border border-white/70 rounded-xl px-3 py-3">
              <div class="flex items-center justify-between gap-2 mb-2">
                <div class="text-sm font-extrabold text-slate-900">{{ rec.name }}</div>
                <UiButton variant="ghost" class="px-2 py-1 rounded text-xs font-semibold" @click="downloadRecording(rec)">下载</UiButton>
              </div>
              <audio :src="rec.url" controls class="w-full"></audio>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.piano-topbar {
  background: linear-gradient(120deg, #0f172a 0%, #111827 45%, #1f2937 100%);
}

.piano-shell {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.12), rgba(255, 255, 255, 0.02));
}

.piano-board {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.25), rgba(255, 255, 255, 0.1));
  border-radius: 20px;
  padding: 14px 16px 20px;
  border: 1px solid rgba(255, 255, 255, 0.6);
}

.piano-container {
  width: 100%;
  overflow-x: auto;
  box-sizing: border-box;
  padding: 10px 10px 10px 10px;
  background-color: #f5f5f5;
  user-select: none;
  position: relative;
}

.piano {
  position: relative;
  height: 200px;
  width: 100%;
  margin: 0 auto;
  background: linear-gradient(to bottom, #ddd, #bbb);
  border: 2px solid #333;
  border-radius: 10px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
}

.key.white {
  background: #fff;
  box-shadow: 0 4px 5px rgba(0, 0, 0, 0.2);
  border: 1px solid #000;
  border-radius: 0 0 5px 5px;
  position: absolute;
  bottom: 0;
  cursor: pointer;
  transition: background 0.1s, transform 0.1s;
  z-index: 1;
  height: 200px;
}

.key.white.active {
  background: #e6e6e6;
  transform: translateY(2px);
}

.key.black {
  background: #000;
  color: #fff;
  box-shadow: 0 4px 5px rgba(0, 0, 0, 0.5);
  border: 1px solid #333;
  border-radius: 0 0 3px 3px;
  position: absolute;
  cursor: pointer;
  transition: background 0.1s, transform 0.1s;
  z-index: 2;
  top: 0;
  height: 120px;
}

.key.black.active {
  background: #333;
  transform: translateY(2px);
}

.labels {
  position: absolute;
  bottom: 5px;
  width: 100%;
  text-align: center;
}

.key-note {
  font-size: 12px;
  display: block;
  user-select: none;
  pointer-events: none;
  color: inherit;
}

.key-mapping {
  font-size: 10px;
  display: block;
  user-select: none;
  pointer-events: none;
  color: #555;
}

.key.black .key-note {
  font-size: 10px;
}

.key.black .key-mapping {
  font-size: 8px;
}

.key {
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
}

@media (max-width: 600px) {
  .piano {
    height: 150px;
  }

  .key.white {
    height: 150px;
  }
}
</style>
