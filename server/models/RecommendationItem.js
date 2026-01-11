import mongoose from 'mongoose';

const { Schema } = mongoose;

const RecommendationItemSchema = new Schema(
  {
    source: { type: String, enum: ['netease', 'community'], required: true, index: true },
    sourceId: { type: String, required: true },
    title: { type: String, default: '' },
    artistName: { type: String, default: '' },
    coverUrl: { type: String, default: '' },
    audioUrl: { type: String, default: '' },
    durationSec: { type: Number, default: 0 },
    styleTags: { type: [String], default: [] },
    styleVec: { type: [Number], default: [] },
    chordFeat: { type: Schema.Types.Mixed, default: null },
    popularity: { type: Number, default: 0 },
  },
  { timestamps: true }
);

RecommendationItemSchema.index({ source: 1, sourceId: 1 }, { unique: true });

export default mongoose.model('RecommendationItem', RecommendationItemSchema);
