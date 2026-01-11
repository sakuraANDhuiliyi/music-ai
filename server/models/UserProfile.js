import mongoose from 'mongoose';

const { Schema } = mongoose;

const UserProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    stylePrefVec: { type: [Number], default: [] },
    chordPrefFeat: { type: Schema.Types.Mixed, default: null },
    recentHistory: { type: [String], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('UserProfile', UserProfileSchema);

