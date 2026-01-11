import mongoose from 'mongoose';

const { Schema } = mongoose;

const ChordSchema = new Schema(
  {
    name: { type: String, default: '' },
    notes: { type: [String], default: [] },
  },
  { _id: false }
);

const MelodyNoteSchema = new Schema(
  {
    note: { type: String, default: '' },
    durBeats: { type: Number, default: 1 },
  },
  { _id: false }
);

const SongSectionSchema = new Schema(
  {
    name: { type: String, default: '' },
    label: { type: String, default: '' },
    bars: { type: Number, default: 8 },
    chords: { type: [ChordSchema], default: [] },
    melody: { type: [MelodyNoteSchema], default: [] },
  },
  { _id: false }
);

const AiChordCollectionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    prompt: { type: String, default: '' },
    chords: { type: [ChordSchema], default: [] },
    bpm: { type: Number, default: 120 },
    chordBeats: { type: Number, default: 4 },
    melody: { type: [MelodyNoteSchema], default: [] },
    genre: { type: String, default: '' },
    key: { type: String, default: '' },
    scale: { type: String, default: '' },
    structure: { type: String, default: '' },
    sections: { type: [SongSectionSchema], default: [] },
    desc: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('AiChordCollection', AiChordCollectionSchema);
