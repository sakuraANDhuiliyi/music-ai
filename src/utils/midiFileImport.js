import { Midi } from '@tonejs/midi';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const guessInstrumentIdFromProgram = (programNumber) => {
  const p = Math.max(0, Math.min(127, Math.round(Number(programNumber) || 0)));

  // GM families (rough).
  // 0-7: Piano
  if (p >= 0 && p <= 7) return 'piano_soft';

  // 24-31: Guitar (use pluck-like synth)
  if (p >= 24 && p <= 31) return 'pluck_glass';

  // 32-39: Bass
  if (p >= 32 && p <= 39) return 'bass_sub';

  // 80-95: Synth Lead/Pad (split into pad vs lead)
  if (p >= 88 && p <= 95) return 'pad_warm';
  if (p >= 80 && p <= 87) return 'lead_clean';

  // 48-55: Strings/Ensemble → pad
  if (p >= 48 && p <= 55) return 'pad_warm';

  return 'piano_soft';
};

const safeTrackName = (raw, index) => {
  const t = String(raw || '').trim();
  if (t) return t;
  return `Track ${index + 1}`;
};

const computeNotesDuration = (notes) => {
  const list = Array.isArray(notes) ? notes : [];
  let maxEnd = 0;
  for (const n of list) {
    const s = Math.max(0, Number(n?.start) || 0);
    const d = Math.max(0, Number(n?.dur) || 0);
    maxEnd = Math.max(maxEnd, s + d);
  }
  return Math.max(0.1, maxEnd);
};

export const parseMidiArrayBuffer = (arrayBuffer) => {
  if (!arrayBuffer) throw new Error('MIDI 数据为空');
  const midi = new Midi(arrayBuffer);

  const firstTempo = Array.isArray(midi?.header?.tempos) ? midi.header.tempos[0] : null;
  const bpm = clamp(Math.round(Number(firstTempo?.bpm) || 120), 40, 240);

  const tracks = (Array.isArray(midi?.tracks) ? midi.tracks : [])
    .map((t, idx) => {
      const rawNotes = Array.isArray(t?.notes) ? t.notes : [];
      const notes = rawNotes
        .map((n, ni) => ({
          id: `note_mid_${idx}_${ni}_${Math.random().toString(16).slice(2, 8)}`,
          midi: clamp(Math.round(Number(n?.midi)), 0, 127),
          start: Math.max(0, Number(n?.time) || 0),
          dur: Math.max(0.03, Number(n?.duration) || 0),
          velocity: clamp(Number(n?.velocity ?? 0.85), 0.05, 1),
        }))
        .filter((n) => Number.isFinite(n.midi) && Number.isFinite(n.start) && Number.isFinite(n.dur));

      const program = Number(t?.instrument?.number);
      const instrumentId = guessInstrumentIdFromProgram(program);
      const name = safeTrackName(t?.name, idx);
      const duration = computeNotesDuration(notes);
      return { name, program: Number.isFinite(program) ? program : null, instrumentId, notes, duration };
    })
    .filter((t) => Array.isArray(t.notes) && t.notes.length > 0);

  const duration = Math.max(0.1, ...tracks.map((t) => Math.max(0, Number(t?.duration) || 0)));
  return { bpm, duration, tracks };
};

