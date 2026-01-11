import mongoose from 'mongoose';

const ProjectSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    cover: { type: String, default: '' }, // 封面颜色或图片URL
    audioUrl: { type: String, default: '' }, // 音乐文件URL (暂时留空)

    // 存储点赞了该作品的所有用户 ID
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    tags: [String], // 例如 ['Electronic', 'Jazz']
    createdAt: { type: Date, default: Date.now }
});

// 让前端能拿到 id 而不是 _id, 并计算 likesCount
ProjectSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        // 返回点赞数量
        ret.likesCount = ret.likes ? ret.likes.length : 0;
    }
});

export default mongoose.model('Project', ProjectSchema);