import { noteToMidi, pcToName } from './musicNotes.js';

export function midiToNoteString(midi) {
  const m = Number(midi);
  if (!Number.isFinite(m)) return null;
  const rounded = Math.round(m);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${pcToName(pc)}${octave}`;
}

export function transposeNoteString(noteStr, semitones) {
  const raw = String(noteStr || '').trim();
  if (!raw) return raw;
  if (raw.toUpperCase() === 'REST') return 'REST';
  const midi = noteToMidi(raw);
  if (midi == null) return raw;
  const shifted = midi + Number(semitones || 0);
  return midiToNoteString(shifted) || raw;
}

export function transposeChordNotes(notes, semitones) {
  const list = Array.isArray(notes) ? notes : [];
  return list.map((n) => transposeNoteString(n, semitones));
}

