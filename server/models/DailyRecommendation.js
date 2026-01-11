import mongoose from 'mongoose';

const { Schema } = mongoose;

const DailyRecommendationItemSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: 'RecommendationItem', required: true },
    score: { type: Number, default: 0 },
    reasonTags: { type: [String], default: [] },
    source: { type: String, default: '' },
  },
  { _id: false }
);

const DailyRecommendationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true },
    items: { type: [DailyRecommendationItemSchema], default: [] },
    algoVersion: { type: String, default: 'v1' },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

DailyRecommendationSchema.index({ userId: 1, date: 1 }, { unique: true });

export default mongoose.model('DailyRecommendation', DailyRecommendationSchema);

