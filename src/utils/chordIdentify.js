import { pcToName, uniquePitchClasses } from './musicNotes.js';

const TEMPLATES = [
  // More specific first
  { name: 'maj7', intervals: [0, 4, 7, 11] },
  { name: '7', intervals: [0, 4, 7, 10] },
  { name: 'min7', intervals: [0, 3, 7, 10] },
  { name: 'm7b5', intervals: [0, 3, 6, 10] },
  { name: 'dim7', intervals: [0, 3, 6, 9] },
  { name: 'sus4', intervals: [0, 5, 7] },
  { name: 'sus2', intervals: [0, 2, 7] },
  { name: 'aug', intervals: [0, 4, 8] },
  { name: 'dim', intervals: [0, 3, 6] },
  { name: 'min', intervals: [0, 3, 7] },
  { name: '', intervals: [0, 4, 7] }, // major triad
];

const SUFFIX_DISPLAY = Object.freeze({
  '': '',
  min: 'm',
  maj7: 'maj7',
  7: '7',
  min7: 'm7',
  m7b5: 'm7b5',
  dim: 'dim',
  dim7: 'dim7',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
});

function intervalsFromRoot(pcs, rootPc) {
  const set = new Set(pcs);
  const rel = [];
  for (let i = 0; i < 12; i++) {
    const pc = (rootPc + i) % 12;
    if (set.has(pc)) rel.push(i);
  }
  return rel;
}

function matchTemplate(rel, template) {
  const want = template.intervals;
  // allow extra tones, but must contain all template tones
  return want.every((x) => rel.includes(x));
}

export function identifyChordName(noteStrings) {
  const pcs = uniquePitchClasses(noteStrings);
  if (!pcs.length) return null;

  let best = null;

  for (const rootPc of pcs) {
    const rel = intervalsFromRoot(pcs, rootPc);

    for (const tpl of TEMPLATES) {
      if (!matchTemplate(rel, tpl)) continue;

      // score: fewer extra notes is better; prefer 7th chords over triads if both fit
      const extra = rel.length - tpl.intervals.length;
      const complexity = tpl.intervals.length;
      const score = extra * 10 - complexity; // lower is better

      if (!best || score < best.score) {
        best = { rootPc, tpl, score };
      }
    }
  }

  if (!best) return null;
  const rootName = pcToName(best.rootPc);
  const suf = SUFFIX_DISPLAY[best.tpl.name] ?? best.tpl.name;
  return `${rootName}${suf}`;
}
