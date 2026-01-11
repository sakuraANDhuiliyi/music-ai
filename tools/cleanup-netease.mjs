import 'dotenv/config';
import mongoose from 'mongoose';
import RecommendationItem from '../server/models/RecommendationItem.js';
import PlayEvent from '../server/models/PlayEvent.js';
import DailyRecommendation from '../server/models/DailyRecommendation.js';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ 未找到 MONGO_URI');
  process.exit(1);
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const main = async () => {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB Connected');

  const ids = await RecommendationItem.find({ source: 'netease' }).select('_id').lean();
  const idList = ids.map((d) => d._id).filter(Boolean);

  if (!idList.length) {
    console.log('ℹ️ 没有发现网易云候选数据');
    await mongoose.disconnect();
    return;
  }

  const idChunks = chunk(idList, 800);
  let eventsRemoved = 0;
  let dailyUpdated = 0;

  for (const idsBatch of idChunks) {
    const resEvents = await PlayEvent.deleteMany({ itemId: { $in: idsBatch } });
    eventsRemoved += resEvents?.deletedCount || 0;

    const resDaily = await DailyRecommendation.updateMany(
      { 'items.itemId': { $in: idsBatch } },
      { $pull: { items: { itemId: { $in: idsBatch } } } }
    );
    dailyUpdated += resDaily?.modifiedCount || 0;
  }

  const resItems = await RecommendationItem.deleteMany({ _id: { $in: idList } });

  console.log(`✅ 删除网易云候选条目: ${resItems?.deletedCount || 0}`);
  console.log(`✅ 删除相关播放事件: ${eventsRemoved}`);
  console.log(`✅ 清理每日推荐记录: ${dailyUpdated}`);

  await mongoose.disconnect();
};

main().catch((err) => {
  console.error('❌ 清理失败', err);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
