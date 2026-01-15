import http from "@/config/music-request";

/** 获取榜单 */
export const reqToplist = async () => {
  return await http.get("/wapi/toplist/detail");
};

/** 获取榜单歌曲列表 */
/** 获取榜单/歌单歌曲列表 [已修复] */
export const reqTopDetaliList = (id, limit = 100, offset = 0) => {
  return new Promise((resolve, reject) => {
    // 确保 id 存在
    if (!id) return reject("No ID provided");
    
    http
      .get(`/wapi/playlist/track/all?id=${id}&limit=${limit}&offset=${offset}`)
      .then((res) => {
        resolve(res);
      })
      .catch(err => reject(err));
  });
};

/** 获取歌曲详情 主要是播放地址 */
export const reqMusicDetail = async ({ id, level }) => {
  return await http.get(`/wapi/song/url/v1?id=${id}&level=${level}`);
};

// 获取音乐的描述
export const reqMusicDescription = async (id) => {
  return await http.get(`/wapi/song/detail?ids=${id}`);
};

// 搜索
export const reqSearch = async (keyWords, offset, limit) => {
  return await http.get(`/wapi/search?keywords=${keyWords}&offset=${offset}&limit=${limit}`);
};

// 获取歌词
export const reqMusicLyricById = async (id) => {
  return await http.get(`/wapi/lyric?id=${id}`);
};
