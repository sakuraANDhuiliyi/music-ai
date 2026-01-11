import mongoose from 'mongoose';
const CommentSchema = new mongoose.Schema({
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    replyToUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now }
});
CommentSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        // [新增] 返回点赞数
        ret.likesCount = ret.likes ? ret.likes.length : 0;
    }
});
export default mongoose.model('Comment', CommentSchema);