import mongoose from 'mongoose';

const ConversationSchema = new mongoose.Schema(
    {
        pairKey: { type: String, required: true, unique: true, index: true },
        participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
        lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
        lastMessageAt: { type: Date, default: null },
    },
    { timestamps: true }
);

ConversationSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
    },
});

export default mongoose.model('Conversation', ConversationSchema);
