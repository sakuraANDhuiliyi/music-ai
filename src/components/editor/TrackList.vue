<script setup>
import { computed, ref } from 'vue';
import UiButton from '../UiButton.vue';

const props = defineProps({
  tracks: { type: Array, required: true },
  selectedClip: { type: Object, default: null },
  selectedAsset: { type: Object, default: null },
  selectedTrack: { type: Object, default: null },
  selectedTrackId: { type: [String, Number], default: null },
});

const emit = defineEmits(['updateTrack', 'updateClip', 'deleteClip', 'addTrack', 'selectTrack', 'normalizeClip']);

const typeLabel = (t) => (t === 'midi' ? 'MIDI' : 'AUDIO');
const typeIcon = (t) => (t === 'midi' ? 'ph-bold ph-piano-keys' : 'ph-bold ph-waveform');

const trackCountLabel = computed(() => `${props.tracks?.length || 0} tracks`);

const toggle = (track, key) => emit('updateTrack', track.id, { [key]: !track[key] });
const setGain = (track, value, commit = false) => emit('updateTrack', track.id, { gain: Number(value) }, { commit });
const setPan = (track, value, commit = false) => emit('updateTrack', track.id, { pan: Number(value) }, { commit });

const isAddOpen = ref(false);
const addTrack = (type) => {
  isAddOpen.value = false;
  emit('addTrack', type);
};

const panLabel = (pan) => {
  const p = Number(pan) || 0;
  if (Math.abs(p) < 0.01) return 'C';
  if (p < 0) return `L${Math.round(Math.abs(p) * 100)}`;
  return `R${Math.round(Math.abs(p) * 100)}`;
};

const clipPanLabel = (pan) => panLabel(pan);

const clipName = computed(() => {
  const url = props.selectedAsset?.url;
  if (!url) return props.selectedClip?.id || 'clip';
  try {
    const raw = String(url);
    const last = raw.split('/').pop() || raw;
    return decodeURIComponent(last);
  } catch {
    return String(url);
  }
});

const setClipGain = (value, commit = false) => {
  const clip = props.selectedClip;
  if (!clip) return;
  emit('updateClip', clip.id, { gain: Number(value) }, { commit });
};

const setClipPan = (value, commit = false) => {
  const clip = props.selectedClip;
  if (!clip) return;
  emit('updateClip', clip.id, { pan: Number(value) }, { commit });
};

const setClipPlaybackRate = (value, commit = false) => {
  const clip = props.selectedClip;
  if (!clip) return;
  emit('updateClip', clip.id, { playbackRate: Number(value) }, { commit });
};

const setClipFadeIn = (value, commit = true) => {
  const clip = props.selectedClip;
  if (!clip) return;
  emit('updateClip', clip.id, { fadeIn: Number(value) }, { commit });
};

const setClipFadeOut = (value, commit = true) => {
  const clip = props.selectedClip;
  if (!clip) return;
  emit('updateClip', clip.id, { fadeOut: Number(value) }, { commit });
};

const setClipFadeInCurve = (curve) => {
  const clip = props.selectedClip;
  if (!clip) return;
  emit('updateClip', clip.id, { fadeInCurve: String(curve || 'linear') }, { commit: true });
};

const setClipFadeOutCurve = (curve) => {
  const clip = props.selectedClip;
  if (!clip) return;
  emit('updateClip', clip.id, { fadeOutCurve: String(curve || 'linear') }, { commit: true });
};

const nudgeClipGain = (deltaDb) => {
  const clip = props.selectedClip;
  if (!clip) return;
  const next = Number(clip.gain || 0) + Number(deltaDb || 0);
  emit('updateClip', clip.id, { gain: next }, { commit: true });
};

const normalizeSelectedClip = () => {
  const clip = props.selectedClip;
  if (!clip) return;
  emit('normalizeClip', clip.id);
};

const deleteSelectedClip = () => {
  const clip = props.selectedClip;
  if (!clip) return;
  emit('deleteClip', clip.id);
};
</script>

<template>
  <aside class="w-72 xl:w-80 glass-card border border-white/70 border-r-white/70 flex flex-col shrink-0 overflow-hidden">
    <div class="px-4 py-3 border-b border-slate-200/70 bg-white/30 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-extrabold text-slate-900">Tracks</div>
        <div class="text-[11px] text-slate-500 font-mono truncate">{{ trackCountLabel }}</div>
      </div>
      <div class="relative">
        <UiButton
          variant="ghost"
          class="px-2 py-2 rounded-lg"
          aria-label="添加轨道"
          @click="isAddOpen = !isAddOpen"
        >
          <i class="ph-bold ph-plus"></i>
        </UiButton>
        <div
          v-if="isAddOpen"
          class="absolute right-0 mt-2 w-44 glass-card border border-white/70 shadow-lg rounded-xl overflow-hidden z-50"
        >
          <button
            class="w-full px-3 py-2 text-left text-sm font-semibold text-slate-800 hover:bg-white/40 transition"
            @click="addTrack('audio')"
          >
            + Audio Track
          </button>
          <button
            class="w-full px-3 py-2 text-left text-sm font-semibold text-slate-800 hover:bg-white/40 transition"
            @click="addTrack('midi')"
          >
            + MIDI Track
          </button>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div
        v-for="track in tracks"
        :key="track.id"
        class="h-24 border-b border-slate-200/70 px-3 py-3 flex flex-col justify-between hover:bg-white/35 transition cursor-pointer"
        :class="String(selectedTrackId) === String(track.id) ? 'bg-white/45 ring-4 ring-sky-300/20' : ''"
        @click="emit('selectTrack', track.id)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-xl bg-white/60 border border-white/70 backdrop-blur-xl flex items-center justify-center text-slate-700 shadow-sm">
                <i :class="typeIcon(track.type)"></i>
              </div>
              <div class="min-w-0">
                <div class="text-sm font-extrabold text-slate-900 truncate">{{ track.name }}</div>
                <div class="text-[10px] font-bold text-slate-500">
                  <span class="px-2 py-0.5 rounded-full bg-white/55 border border-white/70">{{ typeLabel(track.type) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <UiButton
              variant="ghost"
              class="px-2 py-1 rounded-lg text-[11px] font-extrabold"
              :class="track.mute ? 'text-rose-700 bg-rose-500/10 border border-rose-500/20' : ''"
              @click="toggle(track, 'mute')"
              aria-label="Mute"
            >
              M
            </UiButton>
            <UiButton
              variant="ghost"
              class="px-2 py-1 rounded-lg text-[11px] font-extrabold"
              :class="track.solo ? 'text-amber-800 bg-amber-500/10 border border-amber-500/20' : ''"
              @click="toggle(track, 'solo')"
              aria-label="Solo"
            >
              S
            </UiButton>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 items-end">
          <div class="bg-white/55 border border-white/70 rounded-xl px-3 py-2 backdrop-blur-xl">
            <div class="text-[10px] font-bold text-slate-500 flex items-center justify-between gap-2">
              <span>GAIN</span>
              <span class="font-mono text-slate-700">{{ Number(track.gain || 0).toFixed(1) }} dB</span>
            </div>
            <input
              type="range"
              min="-60"
              max="6"
              step="0.5"
              :value="track.gain ?? 0"
              class="w-full"
              @input="setGain(track, $event.target.value, false)"
              @change="setGain(track, $event.target.value, true)"
            />
          </div>

          <div class="bg-white/55 border border-white/70 rounded-xl px-3 py-2 backdrop-blur-xl">
            <div class="text-[10px] font-bold text-slate-500 flex items-center justify-between gap-2">
              <span>PAN</span>
              <span class="font-mono text-slate-700">{{ panLabel(track.pan) }}</span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              :value="track.pan ?? 0"
              class="w-full"
              @input="setPan(track, $event.target.value, false)"
              @change="setPan(track, $event.target.value, true)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Clip inspector -->
    <div class="border-t border-slate-200/70 bg-white/20">
      <div class="px-4 py-3">
        <div class="text-[11px] font-extrabold text-slate-900">素材</div>
        <div v-if="selectedClip" class="mt-2 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-extrabold text-slate-900 truncate">{{ clipName }}</div>
            <UiButton
              variant="ghost"
              class="px-2 py-1 rounded-lg text-rose-700 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20"
              aria-label="删除素材"
              @click="deleteSelectedClip"
            >
              <i class="ph-bold ph-trash"></i>
            </UiButton>
          </div>
          <div class="text-[10px] text-slate-500 font-mono truncate">
            track {{ selectedTrack?.name || selectedClip.trackId }} · start {{ Number(selectedClip.start || 0).toFixed(2) }}s ·
            len {{ Number(selectedClip.length || 0).toFixed(2) }}s
          </div>

          <div class="grid grid-cols-2 gap-2 items-end mt-2">
            <div class="bg-white/55 border border-white/70 rounded-xl px-3 py-2 backdrop-blur-xl">
              <div class="text-[10px] font-bold text-slate-500 flex items-center justify-between gap-2">
                <span>GAIN</span>
                <span class="font-mono text-slate-700">{{ Number(selectedClip.gain || 0).toFixed(1) }} dB</span>
              </div>
              <input
                type="range"
                min="-60"
                max="6"
                step="0.5"
                :value="selectedClip.gain ?? 0"
                class="w-full"
                @input="setClipGain($event.target.value, false)"
                @change="setClipGain($event.target.value, true)"
              />
            </div>

            <div class="bg-white/55 border border-white/70 rounded-xl px-3 py-2 backdrop-blur-xl">
              <div class="text-[10px] font-bold text-slate-500 flex items-center justify-between gap-2">
                <span>PAN</span>
                <span class="font-mono text-slate-700">{{ clipPanLabel(selectedClip.pan) }}</span>
              </div>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                :value="selectedClip.pan ?? 0"
                class="w-full"
                @input="setClipPan($event.target.value, false)"
                @change="setClipPan($event.target.value, true)"
              />
            </div>
          </div>

          <div class="bg-white/55 border border-white/70 rounded-xl px-3 py-2 backdrop-blur-xl mt-2">
            <div class="text-[10px] font-bold text-slate-500 flex items-center justify-between gap-2">
              <span>SPEED</span>
              <span class="font-mono text-slate-700">{{ Number(selectedClip.playbackRate || 1).toFixed(2) }}x</span>
            </div>
            <input
              type="range"
              min="0.25"
              max="4"
              step="0.01"
              :value="selectedClip.playbackRate ?? 1"
              class="w-full"
              @input="setClipPlaybackRate($event.target.value, false)"
              @change="setClipPlaybackRate($event.target.value, true)"
            />
          </div>

          <div class="grid grid-cols-2 gap-2 items-end mt-2">
            <div class="bg-white/55 border border-white/70 rounded-xl px-3 py-2 backdrop-blur-xl">
              <div class="text-[10px] font-bold text-slate-500 flex items-center justify-between gap-2">
                <span>FADE IN</span>
                <span class="font-mono text-slate-700">{{ Number(selectedClip.fadeIn || 0).toFixed(2) }}s</span>
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  :value="selectedClip.fadeIn ?? 0"
                  class="w-16 bg-transparent text-sm text-center text-slate-900 focus:outline-none border border-white/60 rounded-lg px-2 py-1"
                  @change="setClipFadeIn($event.target.value, true)"
                  @blur="setClipFadeIn($event.target.value, true)"
                />
                <select
                  :value="selectedClip.fadeInCurve || 'linear'"
                  class="flex-1 bg-transparent text-sm text-slate-900 focus:outline-none border border-white/60 rounded-lg px-2 py-1"
                  @change="setClipFadeInCurve($event.target.value)"
                >
                  <option value="linear">linear</option>
                  <option value="exp">exp</option>
                </select>
              </div>
            </div>

            <div class="bg-white/55 border border-white/70 rounded-xl px-3 py-2 backdrop-blur-xl">
              <div class="text-[10px] font-bold text-slate-500 flex items-center justify-between gap-2">
                <span>FADE OUT</span>
                <span class="font-mono text-slate-700">{{ Number(selectedClip.fadeOut || 0).toFixed(2) }}s</span>
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  :value="selectedClip.fadeOut ?? 0"
                  class="w-16 bg-transparent text-sm text-center text-slate-900 focus:outline-none border border-white/60 rounded-lg px-2 py-1"
                  @change="setClipFadeOut($event.target.value, true)"
                  @blur="setClipFadeOut($event.target.value, true)"
                />
                <select
                  :value="selectedClip.fadeOutCurve || 'linear'"
                  class="flex-1 bg-transparent text-sm text-slate-900 focus:outline-none border border-white/60 rounded-lg px-2 py-1"
                  @change="setClipFadeOutCurve($event.target.value)"
                >
                  <option value="linear">linear</option>
                  <option value="exp">exp</option>
                </select>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 mt-2">
            <UiButton
              variant="ghost"
              class="px-3 py-2 rounded-xl text-xs font-extrabold"
              aria-label="增益 -3dB"
              @click="nudgeClipGain(-3)"
            >
              -3 dB
            </UiButton>
            <UiButton
              variant="ghost"
              class="px-3 py-2 rounded-xl text-xs font-extrabold"
              aria-label="增益重置"
              @click="emit('updateClip', selectedClip.id, { gain: 0 }, { commit: true })"
            >
              0 dB
            </UiButton>
            <UiButton
              variant="ghost"
              class="px-3 py-2 rounded-xl text-xs font-extrabold"
              aria-label="增益 +3dB"
              @click="nudgeClipGain(3)"
            >
              +3 dB
            </UiButton>
            <UiButton
              variant="secondary"
              class="ml-auto px-3 py-2 rounded-xl text-xs font-extrabold"
              aria-label="归一化"
              @click="normalizeSelectedClip"
            >
              Normalize
            </UiButton>
          </div>
        </div>

        <div v-else class="mt-2 text-[11px] text-slate-500">
          点击右侧时间轴中的素材（clip）以调整参数
        </div>
      </div>
    </div>
  </aside>
</template>
