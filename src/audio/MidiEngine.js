const dbToGain = (db) => Math.pow(10, (Number(db) || 0) / 20);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Minimal MIDI-note playback engine.
 *
 * - Uses a shared AudioContext (recommended: the one from AudioEngine)
 * - Schedules simple synth notes (oscillator + ADSR-like envelope)
 * - Respects track mute/solo/gain/pan
 *
 * Notes format (stored on asset.data.notes):
 * { id: string, midi: number, start: number, dur: number, velocity?: number }
 * where start/dur are in seconds in the asset's own timebase.
 */
export default class MidiEngine {
  /**
   * @param {{ context: AudioContext, masterGain?: number, outputNode?: AudioNode }=} options
   */
  constructor(options = {}) {
    this._ctx = options.context || null;

    this._outputNode = options.outputNode || null;

    this._master = null;
    this._masterGainValue = clamp(Number(options.masterGain ?? 0.22), 0, 1);

    this._trackNodes = new Map(); // trackId -> { gain: GainNode, pan: StereoPannerNode|null }
    this._activeVoices = new Set(); // { osc, gain, trackId }
    this._activeBuses = new Set(); // { gain: GainNode, pan: StereoPannerNode|null }

    this._isPlaying = false;
    this._startCtxTime = 0;
    this._fromTimeSec = 0;
  }

  setContext(ctx) {
    this._ctx = ctx;
    // Recreate graph on next play.
    this._master = null;
    this._trackNodes.clear();
  }

  setOutputNode(node) {
    this._outputNode = node || null;
    this._master = null;
    this._trackNodes.clear();
  }

  get isPlaying() {
    return this._isPlaying;
  }

  applyTrackMix(project) {
    const ctx = this._ctx;
    if (!ctx) return;
    this._applyTrackMix(project, ctx.currentTime);
  }

  _ensureGraph() {
    const ctx = this._ctx;
    if (!ctx) throw new Error('MidiEngine: missing AudioContext');
    if (this._master) return;

    this._master = ctx.createGain();
    this._master.gain.value = this._masterGainValue;
    if (this._outputNode) {
      this._master.connect(this._outputNode);
    } else {
      this._master.connect(ctx.destination);
    }
  }

  _ensureTrackNodes(trackId, track) {
    const id = String(trackId || '');
    if (!id) return null;
    const ctx = this._ctx;
    if (!ctx || !this._master) return null;

    const existing = this._trackNodes.get(id);
    if (existing) return existing;

    const gain = ctx.createGain();
    gain.gain.value = 1;

    const canPan = typeof ctx.createStereoPanner === 'function';
    const pan = canPan ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = 0;
      gain.connect(pan);
      pan.connect(this._master);
    } else {
      gain.connect(this._master);
    }

    const nodes = { gain, pan };
    this._trackNodes.set(id, nodes);

    // Apply initial mix.
    const g = dbToGain(Number(track?.gain) || 0);
    gain.gain.value = g;
    if (pan && typeof track?.pan === 'number') pan.pan.value = clamp(track.pan, -1, 1);

    return nodes;
  }

  _applyTrackMix(project, whenCtxTime) {
    const ctx = this._ctx;
    if (!ctx) return;
    this._ensureGraph();

    const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
    const anySolo = tracks.some((t) => Boolean(t?.solo));
    const when = Number.isFinite(whenCtxTime) ? whenCtxTime : ctx.currentTime;

    for (const t of tracks) {
      if (String(t?.type || 'audio') !== 'midi') continue;
      this._ensureTrackNodes(String(t?.id || ''), t);
    }

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

  _stopAllVoices() {
    for (const v of Array.from(this._activeVoices)) {
      try {
        v?.osc?.stop?.();
      } catch {
        // ignore
      }
      this._activeVoices.delete(v);
    }

    for (const b of Array.from(this._activeBuses)) {
      try {
        b?.pan?.disconnect?.();
      } catch {
        // ignore
      }
      try {
        b?.gain?.disconnect?.();
      } catch {
        // ignore
      }
      this._activeBuses.delete(b);
    }
  }

  _midiToFreq(midi) {
    const m = Number(midi);
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  _scheduleNote(outputNode, note, whenCtxTime, durSec, velocityScale = 1) {
    const ctx = this._ctx;
    if (!ctx || !outputNode) return;

    const t0 = Math.max(ctx.currentTime, Number(whenCtxTime) || ctx.currentTime);
    const d = clamp(Number(durSec) || 0.12, 0.03, 30);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseVel = clamp(Number(note?.velocity ?? 0.85), 0.05, 1);
    const vel = clamp(baseVel * clamp(Number(velocityScale) || 1, 0, 8), 0.02, 1);

    osc.type = 'triangle';
    osc.frequency.value = this._midiToFreq(note?.midi);

    // Simple envelope.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vel * 0.65, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(vel * 0.32, t0 + Math.min(0.18, d * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d);

    osc.connect(gain);
    gain.connect(outputNode);

    try {
      osc.start(t0);
      osc.stop(t0 + d + 0.02);
    } catch {
      // ignore
    }

    const voice = { osc, gain };
    this._activeVoices.add(voice);

    osc.onended = () => {
      this._activeVoices.delete(voice);
      try {
        gain.disconnect();
      } catch {
        // ignore
      }
    };
  }

  _getMidiNotesFromAsset(asset) {
    const notes = asset?.data?.notes;
    if (Array.isArray(notes)) return notes;
    return [];
  }

  /**
   * Start MIDI playback aligned to a timeline playhead.
   *
   * @param {any} project
   * @param {number} fromTimeSec
   * @param {{ startDelaySec?: number }=} options
   */
  play(project, fromTimeSec = 0, options = {}) {
    const ctx = this._ctx;
    if (!ctx) return;

    this.pause();
    this._ensureGraph();

    this._fromTimeSec = Math.max(0, Number(fromTimeSec) || 0);
    const delay = clamp(Number(options.startDelaySec ?? 0.03), 0, 0.2);
    this._startCtxTime = ctx.currentTime + delay;
    this._isPlaying = true;

    this._applyTrackMix(project, this._startCtxTime);

    const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
    const clips = Array.isArray(project?.clips) ? project.clips : [];
    const assets = Array.isArray(project?.assets) ? project.assets : [];

    const anySolo = tracks.some((t) => Boolean(t?.solo));

    const assetById = new Map();
    for (const a of assets) assetById.set(String(a?.id || ''), a);

    const midiClips = clips
      .filter((c) => {
        const asset = assetById.get(String(c?.assetId || ''));
        return String(asset?.type || 'audio') === 'midi';
      })
      .map((c) => c);

    // Schedule all notes up front (good enough for AI-sized clips).
    for (const clip of midiClips) {
      const clipStart = Math.max(0, Number(clip?.start) || 0);
      const clipLen = Math.max(0, Number(clip?.length) || 0);
      const clipEnd = clipStart + clipLen;
      if (clipEnd <= this._fromTimeSec) continue;

      const rate = clamp(Number(clip?.playbackRate) || 1, 0.25, 4);
      const offset = Math.max(0, Number(clip?.offset) || 0);
      const clipGainDb = Number(clip?.gain) || 0;
      const clipGain = clamp(dbToGain(clipGainDb), 0, 8);
      const clipPan = clamp(Number(clip?.pan) || 0, -1, 1);

      const trackId = String(clip?.trackId || '');
      const track = tracks.find((t) => String(t?.id || '') === trackId);
      if (!track || String(track?.type || 'audio') !== 'midi') continue;

      const audible = !track.mute && (!anySolo || Boolean(track.solo));
      if (!audible) continue;

      const nodes = this._ensureTrackNodes(trackId, track);
      if (!nodes) continue;

      // Per-clip bus for gain/pan.
      const busGain = ctx.createGain();
      busGain.gain.value = clipGain;
      const canPan = typeof ctx.createStereoPanner === 'function';
      const busPan = canPan ? ctx.createStereoPanner() : null;
      if (busPan) {
        busPan.pan.value = clipPan;
        busGain.connect(busPan);
        busPan.connect(nodes.gain);
      } else {
        busGain.connect(nodes.gain);
      }
      this._activeBuses.add({ gain: busGain, pan: busPan });

      const asset = assetById.get(String(clip?.assetId || ''));
      const notes = this._getMidiNotesFromAsset(asset);

      for (const n of notes) {
        const assetNoteStart = Math.max(0, Number(n?.start) || 0);
        const assetNoteDur = Math.max(0.03, Number(n?.dur) || 0.12);

        // Clip-local time in seconds (respect offset + playback rate).
        const localStart = (assetNoteStart - offset) / Math.max(1e-6, rate);
        const localEnd = (assetNoteStart + assetNoteDur - offset) / Math.max(1e-6, rate);
        if (localEnd <= 0) continue;
        if (localStart >= clipLen) continue;

        const noteStartOnTimeline = clipStart + localStart;
        const noteDurOnTimeline = Math.max(0.03, (assetNoteDur / Math.max(1e-6, rate)));

        const startDelta = noteStartOnTimeline - this._fromTimeSec;
        if (startDelta < -0.05) continue;

        const when = this._startCtxTime + Math.max(0, startDelta);
        this._scheduleNote(busGain, n, when, noteDurOnTimeline, clipGain);
      }
    }
  }

  pause() {
    if (!this._isPlaying) return;
    this._isPlaying = false;
    this._stopAllVoices();
  }

  destroy() {
    this.pause();
    this._trackNodes.clear();
    try {
      this._master?.disconnect?.();
    } catch {
      // ignore
    }
    this._master = null;
  }
}
