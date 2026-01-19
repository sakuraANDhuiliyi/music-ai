import mongoose from 'mongoose';

const ProjectVersionSchema = new mongoose.Schema({
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    versionId: { type: String, required: true },
    parentVersionId: { type: String, default: '' },
    kind: { type: String, enum: ['fork', 'publish', 'snapshot', 'restore'], default: 'snapshot' },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: '' },
    note: { type: String, default: '' },
    restoredFrom: { type: String, default: '' },
    projectData: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
});

ProjectVersionSchema.index({ project: 1, versionId: 1 }, { unique: true });

ProjectVersionSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
    },
});

export default mongoose.model('ProjectVersion', ProjectVersionSchema);

