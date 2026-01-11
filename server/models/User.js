// server/models/User.js
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    username: { type: String, required: true },
    avatar: { type: String, default: '' },
    bio: { type: String, default: '' },
    role: { type: String, default: 'user', enum: ['user', 'admin'] },
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],
    messageSettings: {
        chat: { type: Boolean, default: true },
        replies: { type: Boolean, default: true },
        mentions: { type: Boolean, default: true },
        likes: { type: Boolean, default: true },
        system: { type: Boolean, default: true },
    },
    createdAt: { type: Date, default: Date.now }
});

UserSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.uid = ret._id;
        delete ret._id;
        delete ret.password; // 这是一个好习惯，返回数据时不暴露密码
        delete ret.following;
        delete ret.blockedUsers;
    }
});

// 👇 必须使用 export default 导出
export default mongoose.model('User', UserSchema);
