import { buildFxChain, getProjectFxSettings } from './fxChain.js';

const dbToGain = (db) => Math.pow(10, (Number(db) || 0) / 20);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Minimal multi-clip audio playback engine (schedule-ahead).
 *
 * - Caches AudioBuffer per assetId.
 * - Schedules clips ~100-200ms ahead to reduce jitter.
 * - Uses requestAnimationFrame onTick for UI playhead updates.
 */
export default class AudioEngine {
  /**
   * @param {{
   *  scheduleAheadSec?: number,
   *  lookAheadMs?: number,
   *  startDelaySec?: number,
   *  onTick?: (playheadSec: number) => void,
   *  context?: AudioContext,
  *  masterGain?: number,
  *  fileProvider?: (assetId: string) => Promise<File|null> | File | null,
   * }=} options
   */
  constructor(options = {}) {
    this._scheduleAheadSec = clamp(Number(options.scheduleAheadSec ?? 0.18), 0.08, 0.5);
    this._lookAheadMs = clamp(Number(options.lookAheadMs ?? 50), 15, 200);
    this._startDelaySec = clamp(Number(options.startDelaySec ?? 0.03), 0, 0.2);

    this._onTick = typeof options.onTick === 'function' ? options.onTick : null;

    this._ctx = options.context || null;
    this._ownsContext = !this._ctx;
    this._master = null;
    this._masterGainValue = clamp(Number(options.masterGain ?? 1), 0, 2);
    this._fxGraph = null;
    this._fxKey = '';
    this._fxActive = false;
    this._fileProvider = typeof options.fileProvider === 'function' ? options.fileProvider : null;

    this._buffers = new Map(); // assetId -> AudioBuffer
    this._loading = new Map(); // assetId -> Promise<AudioBuffer>

    this._trackNodes = new Map(); // trackId -> { gain: GainNode, pan: StereoPannerNode|null }

    this._isPlaying = false;
    this._project = null;
    this._startCtxTime = 0;
    this._fromTimeSec = 0;
    this._pausedPlayheadSec = 0;
    this._projectEndSec = 0;

    this._scheduledClipIds = new Set();
    this._activeSources = new Set();

    this._schedulerTimer = null;
    this._rafId = null;

    this._isLoopSeeking = false;
  }

  get context() {
    return this._ensureContext();
  }

  get masterInput() {
    this._ensureContext();
    return this._master;
  }

  get isPlaying() {
    return this._isPlaying;
  }

  get playhead() {
    if (this._isPlaying) return this._computePlayheadAt(this.context.currentTime);
    return this._pausedPlayheadSec;
  }

  setOnTick(cb) {
    this._onTick = typeof cb === 'function' ? cb : null;
  }

  setFileProvider(fn) {
    this._fileProvider = typeof fn === 'function' ? fn : null;
  }

  async applyMasterFx(project, options = {}) {
    if (!project) return;
    await this._ensureFxGraph(project, {
      active: options.active ?? this._isPlaying,
      quality: options.quality,
    });
  }

  /**
   * Apply track mute/solo/gain/pan to the live node graph.
   * Can be called during playback for "instant" mixer response.
   *
   * @param {any} project
   * @param {number=} whenCtxTime
   */
  applyTrackMix(project, whenCtxTime) {
    const ctx = this._ctx;
    if (!ctx || !this._master) return;

    const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
    const anySolo = tracks.some((t) => Boolean(t?.solo));
    const when = Number.isFinite(whenCtxTime) ? whenCtxTime : ctx.currentTime;

    for (const t of tracks) this._ensureTrackNodes(String(t?.id || ''), t);

    for (const [id, nodes] of this._trackNodes.entries()) {
      const t = tracks.find((x) => String(x?.id || '') === id);
      if (!t) continue;

      const audible = !t.mute && (!anySolo || Boolean(t.solo));
      const g = dbToGain(Number(t.gain) || 0) * (audible ? 1 : 0);
      try {
        nodes.gain.gain.setValueAtTime(g, when);
      } catch {
        // ignore
      }

      if (nodes.pan && typeof t.pan === 'number') {
        try {
          nodes.pan.pan.setValueAtTime(clamp(t.pan, -1, 1), when);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Apply clip gain/pan to currently active sources.
   * This updates playback immediately without touching the scheduled fade envelope.
   *
   * @param {any} project
   * @param {number=} whenCtxTime
   */
  applyClipMix(project, whenCtxTime) {
    const ctx = this._ctx;
    if (!ctx || !this._master) return;

    const clips = Array.isArray(project?.clips) ? project.clips : [];
    const byId = new Map();
    for (const c of clips) {
      if (c?.id) byId.set(String(c.id), c);
    }

    const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
    const trackById = new Map();
    for (const t of tracks) {
      if (t?.id) trackById.set(String(t.id), t);
    }
    for (const t of tracks) this._ensureTrackNodes(String(t?.id || ''), t);

    const when = Number.isFinite(whenCtxTime) ? whenCtxTime : ctx.currentTime;

    for (const item of this._activeSources) {
      const clip = byId.get(String(item?.id || ''));
      if (!clip) continue;

      const rate = clamp(Number(clip?.playbackRate) || 1, 0.25, 4);
      try {
        item?.source?.playbackRate?.setValueAtTime?.(rate, when);
      } catch {
        // ignore
      }

      const desiredTrackId = String(clip?.trackId || '');
      if (desiredTrackId && desiredTrackId !== String(item?.trackId || '')) {
        const target = trackById.get(desiredTrackId);
        if (target && target.type === 'audio') {
          this._ensureTrackNodes(desiredTrackId, target);
          const nodes = this._trackNodes.get(desiredTrackId);
          const out = item?.pan || item?.trim;
          if (nodes && out) {
            try {
              out.disconnect();
            } catch {
              // ignore
            }
            try {
              out.connect(nodes.gain);
              item.trackId = desiredTrackId;
            } catch {
              // ignore
            }
          }
        }
      }

      const g = dbToGain(Number(clip?.gain) || 0);
      try {
        item?.trim?.gain?.setValueAtTime?.(g, when);
      } catch {
        // ignore
      }

      if (item?.pan && typeof clip?.pan === 'number') {
        try {
          item.pan.pan.setValueAtTime(clamp(clip.pan, -1, 1), when);
        } catch {
          // ignore
        }
      }
    }
  }

  async decodeAudioData(arrayBuffer) {
    const ctx = this._ensureContext();
    await this._ensureRunning();
    // Safari expects a *copy* sometimes if the buffer is detached elsewhere.
    const input = arrayBuffer?.slice ? arrayBuffer.slice(0) : arrayBuffer;
    return await ctx.decodeAudioData(input);
  }

  /**
   * Load + cache AudioBuffer for an asset.
   * - If `asset.audioBuffer` provided, it will be cached directly.
   * - Otherwise fetches `asset.url` and decodes.
   *
  * @param {{ id: string, url?: string, audioBuffer?: AudioBuffer, _file?: File }} asset
   * @returns {Promise<AudioBuffer>}
   */
  async loadAsset(asset) {
    const id = String(asset?.id || '');
    if (!id) throw new Error('AudioEngine.loadAsset: missing asset.id');

    // MIDI assets have no audio buffer to fetch/decode.
    if (String(asset?.type || '') === 'midi') {
      throw new Error('AudioEngine.loadAsset: MIDI asset is not loadable as audio');
    }

    if (asset?.audioBuffer) {
      this._buffers.set(id, asset.audioBuffer);
      return asset.audioBuffer;
    }

    const cached = this._buffers.get(id);
    if (cached) return cached;

    const existing = this._loading.get(id);
    if (existing) return existing;

    let file = asset?._file || null;
    if (!file && this._fileProvider) {
      try {
        const provided = await this._fileProvider(id);
        if (provided) file = provided;
      } catch {
        // ignore
      }
    }
    if (file && typeof file.arrayBuffer === 'function') {
      const ctx = this._ensureContext();
      await this._ensureRunning();
      const ab = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(ab.slice ? ab.slice(0) : ab);
      this._buffers.set(id, buffer);
      return buffer;
    }

    const url = String(asset?.url || '');
    if (!url) throw new Error('AudioEngine.loadAsset: missing asset.url');
    if (url.startsWith('blob:')) {
      throw new Error('AudioEngine.loadAsset: blob url missing local file');
    }

    const promise = (async () => {
      const ctx = this._ensureContext();
      await this._ensureRunning();
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const ab = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(ab);
        this._buffers.set(id, buffer);
        return buffer;
      } catch (err) {
        if (file && typeof file.arrayBuffer === 'function') {
          const ab = await file.arrayBuffer();
          const buffer = await ctx.decodeAudioData(ab.slice ? ab.slice(0) : ab);
          this._buffers.set(id, buffer);
          return buffer;
        }
        throw err;
      }
    })()
      .finally(() => this._loading.delete(id));

    this._loading.set(id, promise);
    return promise;
  }

  /**
   * Start playback.
   * @param {any} project
   * @param {number} fromTimeSec
   */
  async play(project, fromTimeSec = 0) {
    if (!project) return;
    const ctx = this._ensureContext();
    await this._ensureRunning();

    // Restart cleanly.
    this.pause();

    this._project = project;
    this._fromTimeSec = Math.max(0, Number(fromTimeSec) || 0);
    this._pausedPlayheadSec = this._fromTimeSec;

    this._projectEndSec = this._computeProjectEnd(project);
    this._startCtxTime = ctx.currentTime + this._startDelaySec;

    this._scheduledClipIds.clear();
    this._stopAllSources();

    this._isPlaying = true;
    await this._ensureFxGraph(project, { active: true });

    this.applyTrackMix(project, this._startCtxTime);
    this._startScheduler();
    this._startTicking();
  }

  pause() {
    if (!this._isPlaying) return this._pausedPlayheadSec;

    const ctx = this._ensureContext();
    this._pausedPlayheadSec = this._computePlayheadAt(ctx.currentTime);

    this._isPlaying = false;
    this._setFxActive(false);
    this._stopScheduler();
    this._stopTicking();
    this._stopAllSources();

    // Keep scheduled set so a later resume uses a fresh scheduling pass.
    this._scheduledClipIds.clear();
    return this._pausedPlayheadSec;
  }

  stopClip(clipId) {
    const id = String(clipId || '');
    if (!id) return;

    for (const item of Array.from(this._activeSources)) {
      if (String(item?.id || '') !== id) continue;
      try {
        item?.source?.stop?.();
      } catch {
        // ignore
      }
      this._activeSources.delete(item);
    }
    this._scheduledClipIds.delete(id);
  }

  async seek(timeSec) {
    const t = Math.max(0, Number(timeSec) || 0);
    if (!this._isPlaying) {
      this._pausedPlayheadSec = t;
      this._onTick?.(t);
      return;
    }

    const project = this._project;
    this.pause();
    await this.play(project, t);
  }

  destroy() {
    this.pause();
    this._buffers.clear();
    this._loading.clear();
    this._trackNodes.clear();

    this._disposeFxGraph();

    try {
      this._master?.disconnect?.();
    } catch {
      // ignore
    }

    // Closing AudioContext is optional; do it to free resources in SPA navigations.
    if (this._ownsContext) {
      try {
        this._ctx?.close?.();
      } catch {
        // ignore
      }
    }
    this._ctx = null;
    this._master = null;
  }

  // =========================
  // Internal
  // =========================

  _ensureContext() {
    if (this._ctx) {
      if (!this._master) {
        this._master = this._ctx.createGain();
        this._master.gain.value = this._masterGainValue;
        this._connectMasterOutput();
      }
      return this._ctx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio API not supported');

    this._ctx = new Ctx();
    this._ownsContext = true;
    this._master = this._ctx.createGain();
    this._master.gain.value = this._masterGainValue;
    this._connectMasterOutput();
    return this._ctx;
  }

  _connectMasterOutput() {
    if (!this._master || !this._ctx) return;
    try {
      this._master.disconnect();
    } catch {
      // ignore
    }

    try {
      this._fxGraph?.output?.disconnect?.();
    } catch {
      // ignore
    }

    if (this._fxGraph && !this._fxGraph.bypass && this._fxActive) {
      try {
        this._master.connect(this._fxGraph.input);
        this._fxGraph.output.connect(this._ctx.destination);
        return;
      } catch {
        // ignore
      }
    }

    try {
      this._master.connect(this._ctx.destination);
    } catch {
      // ignore
    }
  }

  _setFxActive(active) {
    this._fxActive = Boolean(active);
    this._connectMasterOutput();
  }

  _disposeFxGraph() {
    if (!this._fxGraph) return;
    try {
      this._fxGraph.output?.disconnect?.();
    } catch {
      // ignore
    }
    try {
      this._fxGraph.input?.disconnect?.();
    } catch {
      // ignore
    }
    this._fxGraph = null;
    this._fxKey = '';
  }

  async _ensureFxGraph(project, options = {}) {
    const ctx = this._ensureContext();
    const settings = getProjectFxSettings(project);
    const quality = String(options.quality || settings.quality || 'low');
    const nextKey = JSON.stringify({ settings, quality });

    if (nextKey === this._fxKey && this._fxGraph) {
      this._fxActive = Boolean(options.active);
      this._connectMasterOutput();
      return;
    }

    this._disposeFxGraph();
    this._fxActive = Boolean(options.active ?? true);
    this._fxGraph = await buildFxChain(ctx, settings, { quality, active: this._fxActive });
    this._fxKey = nextKey;
    this._connectMasterOutput();
  }

  async _ensureRunning() {
    const ctx = this._ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // ignore
      }
    }
  }

  _computePlayheadAt(ctxTime) {
    const t = Number(ctxTime) || 0;
    const anchor = Number(this._startCtxTime) || 0;
    const from = Number(this._fromTimeSec) || 0;
    if (t <= anchor) return Math.max(0, from);
    const dt = t - anchor;
    return Math.max(0, from + dt);
  }

  _computeProjectEnd(project) {
    const clips = Array.isArray(project?.clips) ? project.clips : [];
    const ends = clips.map((c) => (Number(c?.start) || 0) + (Number(c?.length) || 0));
    return Math.max(0, ...ends, 0);
  }

  _startScheduler() {
    this._stopScheduler();
    this._schedulerTimer = window.setInterval(() => this._schedulerTick(), this._lookAheadMs);
    this._schedulerTick();
  }

  _stopScheduler() {
    if (this._schedulerTimer) window.clearInterval(this._schedulerTimer);
    this._schedulerTimer = null;
  }

  _startTicking() {
    this._stopTicking();
    const tick = () => {
      if (!this._isPlaying) return;

      const t = this.playhead;
      this._onTick?.(t);

      const lr = this._project?.transport?.loopRange;
      const loopEnabled = Boolean(lr?.enabled);
      const loopStart = Math.max(0, Number(lr?.start) || 0);
      const loopEnd = Math.max(0, Number(lr?.end) || 0);
      if (loopEnabled && loopEnd > loopStart && t >= loopEnd - 1e-3) {
        if (!this._isLoopSeeking) {
          this._isLoopSeeking = true;
          const wrapped = loopStart + Math.max(0, t - loopEnd);
          this.seek(wrapped)
            .catch(() => {})
            .finally(() => {
              this._isLoopSeeking = false;
            });
        }
        return;
      }

      if (this._projectEndSec > 0 && t >= this._projectEndSec + 0.02) {
        // Auto stop at end (UI stays at end).
        this.pause();
        this._onTick?.(this._projectEndSec);
        return;
      }

      this._rafId = window.requestAnimationFrame(tick);
    };
    this._rafId = window.requestAnimationFrame(tick);
  }

  _stopTicking() {
    if (this._rafId) window.cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  _stopAllSources() {
    for (const item of this._activeSources) {
      try {
        item?.source?.stop?.();
      } catch {
        // ignore
      }
    }
    this._activeSources.clear();
  }

  _schedulerTick() {
    if (!this._isPlaying || !this._project) return;

    const ctx = this._ensureContext();
    const scheduleRef = Math.max(ctx.currentTime, this._startCtxTime);
    const windowStart = this._computePlayheadAt(scheduleRef);
    const windowEnd = windowStart + this._scheduleAheadSec;

    const project = this._project;

    const tracks = Array.isArray(project.tracks) ? project.tracks : [];
    const clips = Array.isArray(project.clips) ? project.clips : [];
    const assets = Array.isArray(project.assets) ? project.assets : [];

    const assetsById = new Map();
    for (const a of assets) {
      if (a?.id) assetsById.set(String(a.id), a);
    }

    // Track routing + mute/solo + gain/pan (mixer)
    this.applyTrackMix(project, scheduleRef);

    // Schedule clips (audio only for now)
    for (const clip of clips) {
      const clipId = String(clip?.id || '');
      if (!clipId || this._scheduledClipIds.has(clipId)) continue;

      const trackId = String(clip?.trackId || '');
      const track = tracks.find((t) => String(t?.id || '') === trackId);
      if (!track || track.type !== 'audio') continue;

      const assetId = String(clip?.assetId || '');
      const asset = assetsById.get(assetId);
      if (!asset || asset.type !== 'audio') continue;

      const clipStart = Math.max(0, Number(clip.start) || 0);
      const clipLen = Math.max(0, Number(clip.length) || 0);
      const clipEnd = clipStart + clipLen;
      if (!(clipLen > 0)) continue;

      const intersects = clipEnd > windowStart && clipStart < windowEnd;
      if (!intersects) continue;

      const rate = clamp(Number(clip?.playbackRate) || 1, 0.25, 4);

      const buffer = this._buffers.get(assetId);
      if (!buffer) {
        // Start async load; we'll schedule on a later tick.
        this.loadAsset(asset).catch(() => {});
        continue;
      }

      const startProjectTime = clipStart < windowStart ? windowStart : clipStart;
      const startCtxTime = this._startCtxTime + (startProjectTime - this._fromTimeSec);
      if (startCtxTime < scheduleRef - 0.01) continue;

      const offset =
        Math.max(0, Number(clip.offset) || 0) + (startProjectTime - clipStart) * Math.max(1e-6, rate);
      if (offset >= buffer.duration) {
        this._scheduledClipIds.add(clipId);
        continue;
      }

      const durationProject = Math.max(0, clipEnd - startProjectTime);
      const playableProject = Math.min(durationProject, (buffer.duration - offset) / Math.max(1e-6, rate));
      if (!(playableProject > 0.01)) {
        this._scheduledClipIds.add(clipId);
        continue;
      }

      this._scheduleClip({
        clipId,
        clip,
        buffer,
        trackId,
        startCtxTime,
        offset,
        durationProject: playableProject,
        rate,
      });

      this._scheduledClipIds.add(clipId);
    }
  }

  _ensureTrackNodes(trackId, track) {
    const id = String(trackId || '');
    if (!id) return;
    if (this._trackNodes.has(id)) return;

    const ctx = this._ensureContext();
    const gain = ctx.createGain();
    gain.gain.value = dbToGain(Number(track?.gain) || 0);

    let pan = null;
    if (typeof ctx.createStereoPanner === 'function') {
      pan = ctx.createStereoPanner();
      pan.pan.value = clamp(Number(track?.pan) || 0, -1, 1);
      gain.connect(pan);
      pan.connect(this._master);
    } else {
      gain.connect(this._master);
    }

    this._trackNodes.set(id, { gain, pan });
  }

  _scheduleClip({ clipId, clip, buffer, trackId, startCtxTime, offset, durationProject, rate }) {
    const ctx = this._ensureContext();
    const trackNodes = this._trackNodes.get(String(trackId || ''));
    if (!trackNodes) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const r = clamp(Number(rate) || 1, 0.25, 4);
    try {
      source.playbackRate.setValueAtTime(r, startCtxTime);
    } catch {
      // ignore
    }

    const clipDb = Number(clip?.gain) || 0;
    const clipLin = dbToGain(clipDb);

    // Envelope (fade) + trim (user gain)
    const envGain = ctx.createGain();
    const trimGain = ctx.createGain();
    trimGain.gain.value = clipLin;

    let clipPan = null;
    if (typeof ctx.createStereoPanner === 'function') {
      clipPan = ctx.createStereoPanner();
      clipPan.pan.value = clamp(Number(clip?.pan) || 0, -1, 1);
    }

    // Fade in/out
    const fadeIn = Math.max(0, Number(clip?.fadeIn) || 0);
    const fadeOut = Math.max(0, Number(clip?.fadeOut) || 0);
    const dur = Math.max(0, Number(durationProject) || 0);
    const t0 = startCtxTime;
    const t1 = startCtxTime + dur;

    const inSec = Math.min(fadeIn, dur * 0.5);
    const outSec = Math.min(fadeOut, dur * 0.5);

    const inCurve = String(clip?.fadeInCurve || 'linear');
    const outCurve = String(clip?.fadeOutCurve || 'linear');
    const eps = 0.0001;

    if (inSec <= 1e-6) {
      envGain.gain.setValueAtTime(1, t0);
    } else if (inCurve === 'exp') {
      envGain.gain.setValueAtTime(eps, t0);
      envGain.gain.exponentialRampToValueAtTime(1, t0 + inSec);
    } else {
      envGain.gain.setValueAtTime(0, t0);
      envGain.gain.linearRampToValueAtTime(1, t0 + inSec);
    }

    const steadyAt = Math.max(t0, t1 - outSec);
    envGain.gain.setValueAtTime(1, steadyAt);

    if (outSec <= 1e-6) {
      envGain.gain.setValueAtTime(0, t1);
    } else if (outCurve === 'exp') {
      envGain.gain.exponentialRampToValueAtTime(eps, t1);
      envGain.gain.setValueAtTime(0, t1);
    } else {
      envGain.gain.linearRampToValueAtTime(0, t1);
    }

    source.connect(envGain);
    envGain.connect(trimGain);
    if (clipPan) {
      trimGain.connect(clipPan);
      clipPan.connect(trackNodes.gain);
    } else {
      trimGain.connect(trackNodes.gain);
    }

    try {
      const bufferDuration = dur * Math.max(1e-6, r);
      source.start(t0, offset, bufferDuration);
    } catch {
      // If start fails (rare timing issues), skip.
      try { source.disconnect(); } catch {}
      try { envGain.disconnect(); } catch {}
      try { trimGain.disconnect(); } catch {}
      try { clipPan?.disconnect?.(); } catch {}
      return;
    }

    const item = { id: clipId, source, trim: trimGain, pan: clipPan, trackId: String(trackId || '') };
    this._activeSources.add(item);
    source.onended = () => this._activeSources.delete(item);
  }
}
