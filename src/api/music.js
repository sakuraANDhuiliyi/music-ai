import http from "@/config/music-request";

/** 获取榜单 */
export const reqToplist = () => {
  return new Promise((resolve, reject) => {
    http.get("/wapi/toplist/detail", {}).then((res) => {
      resolve(res);
    });
  });
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
export const reqMusicDetail = ({ id, level }) => {
  return new Promise((resolve, reject) => {
    http.get(`/wapi/song/url/v1?id=${id}&level=${level}`, {}).then((res) => {
      resolve(res);
    });
  });
};

// 获取音乐的描述
export const reqMusicDescription = (id) => {
  return new Promise((resolve, reject) => {
    http.get(`/wapi/song/detail?ids=${id}`, {}).then((res) => {
      resolve(res);
    });
  });
};

// 搜索
export const reqSearch = (keyWords, offset, limit) => {
  return new Promise((resolve, reject) => {
    http
      .get(`/wapi/search?keywords=${keyWords}&offset=${offset}&limit=${limit}`, {})
      .then((res) => {
        resolve(res);
      });
  });
};

// 获取歌词
export const reqMusicLyricById = (id) => {
  return new Promise((resolve, reject) => {
    http.get(`/wapi/lyric?id=${id}`, {}).then((res) => {
      resolve(res);
    });
  });
};
