import { midiToFreq, noteToMidi } from './musicNotes.js';
import { ensureSharedAudioRunning, getSharedAudioContext } from '../audio/sharedAudioContext.js';
import { notifyPlaybackStop, registerPlaybackSource, requestPlaybackStart } from '../audio/playbackCoordinator.js';

const SOURCE_ID = 'webaudio-chords';

let audioCtx = null;
let masterGain = null;
let playbackController = new AbortController();
const activeOscillators = new Set();

async function ensureAudio() {
  if (!audioCtx) {
    audioCtx = getSharedAudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.28;
    masterGain.connect(audioCtx.destination);
  }
  await ensureSharedAudioRunning();
}

export function stopPlayback() {
  try {
    playbackController.abort();
  } catch { }
  playbackController = new AbortController();

  for (const osc of Array.from(activeOscillators)) {
    try {
      osc.onended = null;
      osc.stop();
    } catch { }
  }
  activeOscillators.clear();
  notifyPlaybackStop(SOURCE_ID);
}

const resolveSignal = (signal) => signal || playbackController.signal;

const abortableSleep = (ms, signal) => {
  const s = resolveSignal(signal);
  if (s.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      cleanup();
      resolve(true);
    }, ms);
    const onAbort = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      clearTimeout(t);
      try {
        s.removeEventListener('abort', onAbort);
      } catch { }
    };
    s.addEventListener('abort', onAbort, { once: true });
  });
};

export async function playChordNotes(noteStrings, durationSec = 1.1, options = {}) {
  const signal = resolveSignal(options?.signal);
  requestPlaybackStart(SOURCE_ID);
  await ensureAudio();
  if (signal.aborted) return;
  const ctx = audioCtx;
  const now = ctx.currentTime;

  const mids = (noteStrings || [])
    .map((s) => noteToMidi(s))
    .filter((m) => typeof m === 'number');

  if (!mids.length) return;

  mids.forEach((midi) => {
    if (signal.aborted) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.55, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.22, now + Math.min(0.18, durationSec * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);

    activeOscillators.add(osc);
    osc.onended = () => {
      activeOscillators.delete(osc);
    };
  });
}

export async function playProgression(chords, perChordSec = 1.1, options = {}) {
  const signal = resolveSignal(options?.signal);
  requestPlaybackStart(SOURCE_ID);
  const list = Array.isArray(chords) ? chords : [];
  for (let i = 0; i < list.length; i++) {
    if (signal.aborted) break;
    const notes = list[i]?.notes || list[i]?.value || list[i];
    await playChordNotes(notes, perChordSec, { signal });
    // simple spacing (abortable)
    const ok = await abortableSleep(perChordSec * 1000, signal);
    if (!ok) break;
  }
}

export async function playMelody(melody, bpm = 120, options = {}) {
  const signal = resolveSignal(options?.signal);
  requestPlaybackStart(SOURCE_ID);
  const list = Array.isArray(melody) ? melody : [];
  const safeBpm = Math.max(40, Math.min(240, Number(bpm) || 120));

  for (let i = 0; i < list.length; i++) {
    if (signal.aborted) break;
    const note = String(list[i]?.note ?? list[i] ?? '').trim();
    const durBeatsNum = Number(list[i]?.durBeats);
    const durBeats = Number.isFinite(durBeatsNum) ? Math.max(0.125, Math.min(16, durBeatsNum)) : 1;
    const durSec = (60 / safeBpm) * durBeats;

    if (note && note.toUpperCase() !== 'REST') {
      await playChordNotes([note], durSec, { signal });
    }
    const ok = await abortableSleep(durSec * 1000, signal);
    if (!ok) break;
  }
}

// Register once so other sources can stop us.
try {
  registerPlaybackSource(SOURCE_ID, { stop: stopPlayback });
} catch {
  // ignore
}
