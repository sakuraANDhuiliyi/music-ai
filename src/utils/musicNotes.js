const NOTE_TO_PC = Object.freeze({
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
});

const PC_TO_SHARP = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

export function parseNoteString(noteStr) {
  const s = String(noteStr || '').trim();
  const m = s.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2] || '';
  const octave = Number(m[3]);
  const name = `${letter}${accidental}`;
  const pc = NOTE_TO_PC[name];
  if (pc == null || Number.isNaN(octave)) return null;
  return { name, octave, pc };
}

export function noteToMidi(noteStr) {
  const parsed = parseNoteString(noteStr);
  if (!parsed) return null;
  const midi = (parsed.octave + 1) * 12 + parsed.pc;
  return midi;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function pcToName(pc) {
  const p = ((pc % 12) + 12) % 12;
  return PC_TO_SHARP[p];
}

export function uniquePitchClasses(notes) {
  const set = new Set();
  (notes || []).forEach((n) => {
    if (!n) return;
    const parsed = typeof n === 'string' ? parseNoteString(n) : n;
    const pc = parsed?.pc;
    if (pc == null) return;
    set.add(((pc % 12) + 12) % 12);
  });
  return Array.from(set).sort((a, b) => a - b);
}

