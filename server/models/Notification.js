import mongoose from 'mongoose';

const NOTIFICATION_TYPES = [
    'like_project',
    'like_comment',
    'reply',
    'comment_project',
    'comment_post',
    'mention',
    'followed_project',
    'followed_post',
    'system',
];

const NotificationSchema = new mongoose.Schema({
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // 接收通知的人
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },    // 触发动作的人
    type: {
        type: String,
        enum: NOTIFICATION_TYPES,
        required: true
    },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' }, // 关联的作品
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' }, // 关联的动态帖子
    comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }, // 关联的评论(可选)
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

NotificationSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
    }
});

export default mongoose.model('Notification', NotificationSchema);
