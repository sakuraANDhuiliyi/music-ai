const dbToGain = (db) => Math.pow(10, (Number(db) || 0) / 20);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const isFiniteNumber = (v) => Number.isFinite(Number(v));

const getProjectDurationSec = (project) => {
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  const end = Math.max(
    0,
    ...clips.map((c) => Math.max(0, Number(c?.start) || 0) + Math.max(0, Number(c?.length) || 0))
  );
  return Math.max(0, end);
};

const floatToI16 = (v) => {
  const x = clamp(Number(v) || 0, -1, 1);
  return x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff);
};

export function audioBufferToWavBlob(audioBuffer, options = {}) {
  if (!audioBuffer) throw new Error('missing AudioBuffer');
  const format = String(options.format || 'wav');
  if (format !== 'wav') throw new Error('only wav supported');

  const channels = Math.max(1, Number(audioBuffer.numberOfChannels || 1));
  const sampleRate = Math.max(1, Number(audioBuffer.sampleRate || 44100));
  const length = Math.max(0, Number(audioBuffer.length || 0));

  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  let offset = 0;
  const writeAscii = (s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
    offset += s.length;
  };

  writeAscii('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeAscii('WAVE');
  writeAscii('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true); // PCM
  offset += 2;
  view.setUint16(offset, channels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeAscii('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;

  const chData = Array.from({ length: channels }, (_, ch) => audioBuffer.getChannelData(ch));
  for (let i = 0; i < length; i += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      view.setInt16(offset, floatToI16(chData[ch][i] || 0), true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

const buildTrackGraph = (ctx, track, audible) => {
  const trackGain = ctx.createGain();
  trackGain.gain.value = dbToGain(Number(track?.gain) || 0) * (audible ? 1 : 0);

  const canPan = typeof ctx.createStereoPanner === 'function';
  const pan = canPan ? ctx.createStereoPanner() : null;
  if (pan) {
    pan.pan.value = clamp(Number(track?.pan) || 0, -1, 1);
    trackGain.connect(pan);
    return { input: trackGain, output: pan };
  }
  return { input: trackGain, output: trackGain };
};

const applyFade = (gainNode, clip, t0, durSec) => {
  const inSec = clamp(Number(clip?.fadeIn) || 0, 0, durSec * 0.5);
  const outSec = clamp(Number(clip?.fadeOut) || 0, 0, durSec * 0.5);
  const t1 = t0 + durSec;

  const inCurve = String(clip?.fadeInCurve || 'linear');
  const outCurve = String(clip?.fadeOutCurve || 'linear');
  const eps = 0.0001;

  if (inSec <= 1e-6) {
    gainNode.gain.setValueAtTime(1, t0);
  } else if (inCurve === 'exp') {
    gainNode.gain.setValueAtTime(eps, t0);
    gainNode.gain.exponentialRampToValueAtTime(1, t0 + inSec);
  } else {
    gainNode.gain.setValueAtTime(0, t0);
    gainNode.gain.linearRampToValueAtTime(1, t0 + inSec);
  }

  const steadyAt = Math.max(t0, t1 - outSec);
  gainNode.gain.setValueAtTime(1, steadyAt);

  if (outSec <= 1e-6) {
    gainNode.gain.setValueAtTime(0, t1);
  } else if (outCurve === 'exp') {
    gainNode.gain.exponentialRampToValueAtTime(eps, t1);
    gainNode.gain.setValueAtTime(0, t1);
  } else {
    gainNode.gain.linearRampToValueAtTime(0, t1);
  }
};

const midiToFreq = (midi) => 440 * Math.pow(2, (Number(midi) - 69) / 12);

const scheduleMidiNote = (ctx, outputNode, note, when, durSec, velocityScale = 1) => {
  if (!outputNode) return;
  const t0 = clamp(Number(when) || 0, 0, Number.MAX_SAFE_INTEGER);
  const d = clamp(Number(durSec) || 0.12, 0.03, 30);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  const baseVel = clamp(Number(note?.velocity ?? 0.85), 0.05, 1);
  const vel = clamp(baseVel * clamp(Number(velocityScale) || 1, 0, 8), 0.02, 1);

  osc.type = 'triangle';
  osc.frequency.value = midiToFreq(note?.midi);

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
};

const loadAssetAudioBuffer = async (ctx, asset, filesByAssetId) => {
  const id = String(asset?.id || '');
  const file = filesByAssetId?.get?.(id) || null;
  if (file) {
    const ab = await file.arrayBuffer();
    return await ctx.decodeAudioData(ab.slice(0));
  }

  const url = String(asset?.url || '');
  if (!url) throw new Error('missing asset.url');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const ab = await res.arrayBuffer();
  return await ctx.decodeAudioData(ab.slice(0));
};

export async function renderProjectToAudioBuffer(project, options = {}) {
  const sampleRate = Math.max(8000, Math.min(96000, Number(options.sampleRate) || 44100));
  const filesByAssetId = options.filesByAssetId || null;

  const durationSec = clamp(getProjectDurationSec(project), 0, Number(options.maxDurationSec ?? 600));
  if (!(durationSec > 0.02)) throw new Error('工程为空，无法导出试听音频');

  const length = Math.ceil(durationSec * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);

  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  const assets = Array.isArray(project?.assets) ? project.assets : [];
  const clips = Array.isArray(project?.clips) ? project.clips : [];

  const anySolo = tracks.some((t) => Boolean(t?.solo));
  const assetById = new Map();
  for (const a of assets) assetById.set(String(a?.id || ''), a);

  const trackGraphById = new Map();
  for (const t of tracks) {
    const id = String(t?.id || '');
    if (!id) continue;
    const audible = !t.mute && (!anySolo || Boolean(t.solo));
    const graph = buildTrackGraph(ctx, t, audible);
    graph.output.connect(master);
    trackGraphById.set(id, graph);
  }

  // Pre-decode audio assets we actually need.
  const audioAssetIds = new Set();
  for (const c of clips) {
    const asset = assetById.get(String(c?.assetId || ''));
    if (String(asset?.type || '') === 'audio') audioAssetIds.add(String(asset?.id || ''));
  }

  const audioBuffers = new Map();
  for (const id of audioAssetIds) {
    const asset = assetById.get(id);
    if (!asset) continue;
    try {
      const buf = await loadAssetAudioBuffer(ctx, asset, filesByAssetId);
      audioBuffers.set(id, buf);
    } catch (e) {
      throw new Error(`无法加载音频素材：${String(asset?.url || asset?.hash || id)}`);
    }
  }

  for (const clip of clips) {
    const trackId = String(clip?.trackId || '');
    const track = tracks.find((t) => String(t?.id || '') === trackId) || null;
    if (!track) continue;
    const audible = !track.mute && (!anySolo || Boolean(track.solo));
    if (!audible) continue;

    const graph = trackGraphById.get(trackId);
    if (!graph) continue;

    const clipStart = Math.max(0, Number(clip?.start) || 0);
    const clipLen = Math.max(0, Number(clip?.length) || 0);
    if (!(clipLen > 0.01)) continue;

    const asset = assetById.get(String(clip?.assetId || ''));
    if (!asset) continue;

    const clipGainLin = dbToGain(Number(clip?.gain) || 0);
    const clipPanVal = clamp(Number(clip?.pan) || 0, -1, 1);

    if (String(asset?.type || '') === 'audio') {
      const buffer = audioBuffers.get(String(asset.id));
      if (!buffer) continue;

      const rate = clamp(Number(clip?.playbackRate) || 1, 0.25, 4);
      const offset = Math.max(0, Number(clip?.offset) || 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      try {
        source.playbackRate.setValueAtTime(rate, clipStart);
      } catch {
        // ignore
      }

      const env = ctx.createGain();
      const trim = ctx.createGain();
      trim.gain.value = clamp(clipGainLin, 0, 8);

      const canPan = typeof ctx.createStereoPanner === 'function';
      const pan = canPan ? ctx.createStereoPanner() : null;
      if (pan) pan.pan.value = clipPanVal;

      applyFade(env, clip, clipStart, clipLen);

      source.connect(env);
      env.connect(trim);
      if (pan) {
        trim.connect(pan);
        pan.connect(graph.input);
      } else {
        trim.connect(graph.input);
      }

      const bufferDur = clipLen * Math.max(1e-6, rate);
      try {
        source.start(clipStart, offset, bufferDur);
      } catch {
        // ignore
      }
      continue;
    }

    if (String(asset?.type || '') === 'midi') {
      const notes = Array.isArray(asset?.data?.notes) ? asset.data.notes : [];
      if (!notes.length) continue;

      const rate = clamp(Number(clip?.playbackRate) || 1, 0.25, 4);
      const offset = Math.max(0, Number(clip?.offset) || 0);
      const clipGain = clamp(clipGainLin, 0, 8);

      const busGain = ctx.createGain();
      busGain.gain.value = clipGain;
      const canPan = typeof ctx.createStereoPanner === 'function';
      const busPan = canPan ? ctx.createStereoPanner() : null;
      if (busPan) {
        busPan.pan.value = clipPanVal;
        busGain.connect(busPan);
        busPan.connect(graph.input);
      } else {
        busGain.connect(graph.input);
      }

      for (const n of notes) {
        const assetNoteStart = Math.max(0, Number(n?.start) || 0);
        const assetNoteDur = Math.max(0.03, Number(n?.dur) || 0.12);

        const localStart = (assetNoteStart - offset) / Math.max(1e-6, rate);
        const localEnd = (assetNoteStart + assetNoteDur - offset) / Math.max(1e-6, rate);
        if (localEnd <= 0) continue;
        if (localStart >= clipLen) continue;

        const noteStartOnTimeline = clipStart + Math.max(0, localStart);
        const noteDurOnTimeline = Math.max(0.03, assetNoteDur / Math.max(1e-6, rate));

        scheduleMidiNote(ctx, busGain, n, noteStartOnTimeline, noteDurOnTimeline, clipGain);
      }
    }
  }

  return await ctx.startRendering();
}

export async function renderProjectToWavFile(project, options = {}) {
  const buffer = await renderProjectToAudioBuffer(project, options);
  const blob = audioBufferToWavBlob(buffer);
  const name = String(options.filename || 'preview.wav').trim() || 'preview.wav';
  return new File([blob], name, { type: 'audio/wav' });
}

