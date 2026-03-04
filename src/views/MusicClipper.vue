<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import UiButton from '../components/UiButton.vue';
import { apiUrl } from '../config/appConfig.js';

const API_BASE = apiUrl('/api/mg-music');
const buildStreamUrl = (url) => apiUrl(`/api/mg-music/stream?url=${encodeURIComponent(url)}`);

const query = ref('');
const isSearching = ref(false);
const searchError = ref('');
const results = ref([]);

const selected = ref(null);
const detailError = ref('');
const isLoadingDetail = ref(false);

const audioRef = ref(null);
const audioReady = ref(false);
const isPlaying = ref(false);

const startAt = ref(0);
const endAt = ref(30);
const duration = ref(0);

const isReadyToClip = computed(() => {
  return selected.value?.music_url && endAt.value > startAt.value && duration.value > 0;
});

const sanitizeFileName = (name) => String(name || 'clip')
  .replace(/[\\/:*?"<>|]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const fetchJson = async (url) => {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('请求失败');
  return await res.json();
};

const search = async () => {
  const q = query.value.trim();
  if (!q) return;
  isSearching.value = true;
  searchError.value = '';
  results.value = [];
  selected.value = null;
  detailError.value = '';
  try {
    const url = `${API_BASE}?gm=${encodeURIComponent(q)}`;
    const data = await fetchJson(url);
    const list = Array.isArray(data?.songs) ? data.songs : [];
    results.value = list.map((item) => ({
      id: item?.ID ?? item?.id,
      title: item?.title || '未知标题',
      singer: item?.singer || '未知歌手',
    }));
  } catch (e) {
    searchError.value = e?.message || '搜索失败，请稍后重试';
  } finally {
    isSearching.value = false;
  }
};

const selectSong = async (item) => {
  if (!item?.id) return;
  isLoadingDetail.value = true;
  detailError.value = '';
  selected.value = null;
  audioReady.value = false;
  isPlaying.value = false;
  startAt.value = 0;
  endAt.value = 30;
  duration.value = 0;
  try {
    const q = query.value.trim();
    const url = `${API_BASE}?gm=${encodeURIComponent(q)}&id=${encodeURIComponent(item.id)}`;
    const data = await fetchJson(url);
    if (Number(data?.code) !== 200) throw new Error('获取详情失败');
    const rawUrl = String(data?.music_url || '');
    selected.value = {
      id: item.id,
      title: data?.title || item.title,
      singer: data?.singer || item.singer,
      cover: data?.cover || '',
      link: data?.link || '',
      music_url: rawUrl ? buildStreamUrl(rawUrl) : '',
      raw_music_url: rawUrl,
      lrc_url: data?.lrc_url || '',
    };
  } catch (e) {
    detailError.value = e?.message || '获取详情失败';
  } finally {
    isLoadingDetail.value = false;
  }
};

const onAudioLoaded = () => {
  const audio = audioRef.value;
  if (!audio) return;
  duration.value = Number(audio.duration || 0);
  if (!(endAt.value > 0)) endAt.value = Math.min(30, duration.value || 30);
  audioReady.value = true;
};

const togglePlay = () => {
  const audio = audioRef.value;
  if (!audio || !audioReady.value) return;
  if (isPlaying.value) {
    audio.pause();
    isPlaying.value = false;
    return;
  }
  if (audio.currentTime < startAt.value || audio.currentTime > endAt.value) {
    audio.currentTime = startAt.value;
  }
  audio.play();
  isPlaying.value = true;
};

const onTimeUpdate = () => {
  const audio = audioRef.value;
  if (!audio) return;
  if (audio.currentTime >= endAt.value) {
    audio.pause();
    isPlaying.value = false;
  }
};

const markStart = () => {
  const audio = audioRef.value;
  if (!audio) return;
  startAt.value = Math.max(0, Math.min(audio.currentTime, duration.value || audio.currentTime));
  if (startAt.value >= endAt.value) {
    endAt.value = Math.min(startAt.value + 5, duration.value || startAt.value + 5);
  }
};

const markEnd = () => {
  const audio = audioRef.value;
  if (!audio) return;
  endAt.value = Math.max(startAt.value + 0.1, Math.min(audio.currentTime, duration.value || audio.currentTime));
};

const seekToStart = () => {
  const audio = audioRef.value;
  if (!audio) return;
  audio.currentTime = startAt.value;
};

const onRangeInput = () => {
  if (endAt.value > duration.value && duration.value > 0) endAt.value = duration.value;
  if (startAt.value < 0) startAt.value = 0;
  if (endAt.value <= startAt.value) endAt.value = Math.min(startAt.value + 0.1, duration.value || startAt.value + 0.1);
};

const downloadUrl = (url, name) => {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = name || '';
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.click();
};

const encodeWav = (audioBuffer) => {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  const writeString = (str) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
    offset += str.length;
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let i = 0; i < samples; i += 1) {
    for (let ch = 0; ch < numChannels; ch += 1) {
      const sample = audioBuffer.getChannelData(ch)[i] || 0;
      const s = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return buffer;
};

const downloadClip = async () => {
  if (!isReadyToClip.value) return;
  const url = selected.value?.music_url;
  if (!url) return;
  const start = Math.max(0, startAt.value);
  const end = Math.min(endAt.value, duration.value || endAt.value);
  if (!(end > start)) return;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('音频下载失败');
    const arrayBuffer = await res.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor(end * sampleRate);
    const length = Math.max(1, endSample - startSample);

    const clipBuffer = audioCtx.createBuffer(buffer.numberOfChannels, length, sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
      const channel = buffer.getChannelData(ch).slice(startSample, endSample);
      clipBuffer.copyToChannel(channel, ch, 0);
    }

    const wavArrayBuffer = encodeWav(clipBuffer);
    const blob = new Blob([wavArrayBuffer], { type: 'audio/wav' });
    const blobUrl = URL.createObjectURL(blob);
    const baseName = sanitizeFileName(`${selected.value?.title || 'clip'}-${start.toFixed(1)}-${end.toFixed(1)}s.wav`);
    downloadUrl(blobUrl, baseName || 'clip.wav');
    URL.revokeObjectURL(blobUrl);

    audioCtx.close();
  } catch (e) {
    detailError.value = e?.message || '片段导出失败（可能是跨域限制）';
  }
};

const downloadFull = () => {
  const url = selected.value?.music_url;
  if (!url) return;
  const baseName = sanitizeFileName(`${selected.value?.title || 'track'}-${selected.value?.singer || ''}.mp3`);
  downloadUrl(url, baseName || 'track.mp3');
};

onBeforeUnmount(() => {
  const audio = audioRef.value;
  if (audio) {
    audio.pause();
  }
});
</script>

<template>
  <div class="page pb-16">
    <div class="page-container max-w-6xl space-y-6">
      <div v-reveal class="glass-card rounded-2xl p-6 border border-white/70">
        <div class="text-lg font-extrabold text-slate-900 flex items-center gap-2">
          <i class="ph-bold ph-music-notes text-teal-600"></i>
          歌曲案例音频截取
        </div>
        <div class="text-xs text-slate-500 font-semibold mt-1">
          搜索歌曲 → 选择版本 → 试听并裁剪 → 下载片段（WAV）。
        </div>

        <div class="mt-5 flex flex-col md:flex-row gap-3">
          <input
            v-model="query"
            type="text"
            placeholder="输入歌曲名，例如：晴天"
            class="flex-1 input-glass rounded-xl px-4 py-2 text-sm"
            @keyup.enter="search"
          />
          <UiButton
            variant="primary"
            class="px-5 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50"
            :disabled="isSearching || !query.trim()"
            @click="search"
          >
            <i v-if="isSearching" class="ph-bold ph-spinner animate-spin"></i>
            搜索
          </UiButton>
        </div>
        <div v-if="searchError" class="mt-2 text-sm text-rose-600 font-semibold">{{ searchError }}</div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="glass-card rounded-2xl p-5 border border-white/70 lg:col-span-1">
          <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <i class="ph-bold ph-list-magnifying-glass text-teal-600"></i>
            搜索结果
          </div>
          <div class="mt-4 space-y-3">
            <div v-if="!results.length" class="text-xs text-slate-500">暂无结果</div>
            <button
              v-for="item in results"
              :key="item.id"
              class="w-full text-left px-4 py-3 rounded-xl border border-white/70 bg-white/60 hover:bg-white/80 transition"
              @click="selectSong(item)"
            >
              <div class="text-sm font-bold text-slate-900">{{ item.title }}</div>
              <div class="text-xs text-slate-500">{{ item.singer }} · ID {{ item.id }}</div>
            </button>
          </div>
        </div>

        <div class="glass-card rounded-2xl p-5 border border-white/70 lg:col-span-2">
          <div class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <i class="ph-bold ph-waveform text-teal-600"></i>
            片段裁剪
          </div>

          <div v-if="isLoadingDetail" class="mt-4 text-sm text-slate-500">正在加载歌曲详情...</div>
          <div v-else-if="detailError" class="mt-4 text-sm text-rose-600 font-semibold">{{ detailError }}</div>

          <div v-else-if="selected" class="mt-4 space-y-5">
            <div class="flex flex-col md:flex-row gap-4">
              <div class="w-28 h-28 rounded-xl overflow-hidden border border-white/70 bg-white/70 flex items-center justify-center">
                <img v-if="selected.cover" :src="selected.cover" class="w-full h-full object-cover" alt="cover" />
                <i v-else class="ph-bold ph-music-notes text-3xl text-slate-400"></i>
              </div>
              <div class="flex-1">
                <div class="text-lg font-extrabold text-slate-900">{{ selected.title }}</div>
                <div class="text-sm text-slate-600 font-semibold">{{ selected.singer }}</div>
                <div class="mt-2 flex flex-wrap gap-2">
                  <UiButton variant="light" class="px-3 py-1.5 rounded-lg text-sm" @click="downloadFull">下载原曲</UiButton>
                  <a v-if="selected.link" :href="selected.link" target="_blank" rel="noreferrer" class="px-3 py-1.5 rounded-lg text-sm bg-white/70 border border-white/70 hover:bg-white/90">打开详情页</a>
                  <a v-if="selected.lrc_url" :href="selected.lrc_url" target="_blank" rel="noreferrer" class="px-3 py-1.5 rounded-lg text-sm bg-white/70 border border-white/70 hover:bg-white/90">歌词</a>
                </div>
              </div>
            </div>

            <div class="glass-card rounded-2xl p-4 border border-white/70">
              <audio
                ref="audioRef"
                :src="selected.music_url"
                preload="metadata"
                crossorigin="anonymous"
                @loadedmetadata="onAudioLoaded"
                @timeupdate="onTimeUpdate"
                @pause="isPlaying = false"
              ></audio>

              <div class="flex items-center gap-3">
                <UiButton variant="primary" class="px-4 py-2 rounded-xl text-white" :disabled="!audioReady" @click="togglePlay">
                  {{ isPlaying ? '暂停' : '播放区间' }}
                </UiButton>
                <UiButton variant="light" class="px-4 py-2 rounded-xl" :disabled="!audioReady" @click="seekToStart">回到开始</UiButton>
                <div class="text-xs text-slate-500">时长：{{ duration.toFixed(1) }}s</div>
              </div>

              <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div class="text-[11px] font-bold text-slate-600 mb-1">开始时间（秒）</div>
                  <div class="flex items-center gap-2">
                    <input v-model.number="startAt" type="number" min="0" :max="duration" class="w-full input-glass rounded-xl px-3 py-2 text-sm" @input="onRangeInput" />
                    <UiButton variant="light" class="px-3 py-2 rounded-xl text-sm" :disabled="!audioReady" @click="markStart">取当前</UiButton>
                  </div>
                </div>
                <div>
                  <div class="text-[11px] font-bold text-slate-600 mb-1">结束时间（秒）</div>
                  <div class="flex items-center gap-2">
                    <input v-model.number="endAt" type="number" min="0" :max="duration" class="w-full input-glass rounded-xl px-3 py-2 text-sm" @input="onRangeInput" />
                    <UiButton variant="light" class="px-3 py-2 rounded-xl text-sm" :disabled="!audioReady" @click="markEnd">取当前</UiButton>
                  </div>
                </div>
              </div>

              <div class="mt-4 flex flex-wrap items-center gap-3">
                <UiButton
                  variant="primary"
                  class="px-5 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50"
                  :disabled="!isReadyToClip"
                  @click="downloadClip"
                >
                  下载片段（WAV）
                </UiButton>
                <div class="text-xs text-slate-500">
                  若提示跨域失败，可先下载原曲再本地裁剪。
                </div>
              </div>
            </div>
          </div>

          <div v-else class="mt-4 text-sm text-slate-500">请选择左侧结果加载详情。</div>
        </div>
      </div>
    </div>
  </div>
</template>
