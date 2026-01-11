import mongoose from 'mongoose';

const { Schema } = mongoose;

const PlayEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'RecommendationItem', required: true, index: true },
    sourceContext: { type: String, default: '' },
    playedMs: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    skipped: { type: Boolean, default: false },
    addedToQueue: { type: Boolean, default: false },
    liked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

PlayEventSchema.index({ userId: 1, itemId: 1, createdAt: -1 });

export default mongoose.model('PlayEvent', PlayEventSchema);

