import mongoose from 'mongoose';

const PostSchema = new mongoose.Schema({
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, default: '', trim: true, maxlength: 2000 },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    images: [
        {
            url: { type: String, required: true },
        },
    ],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

PostSchema.index({ author: 1, createdAt: -1 });

PostSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
    }
});

export default mongoose.model('Post', PostSchema);
