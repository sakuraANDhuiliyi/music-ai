/*
 * @author: Zhang Yuming
 * @date: 2024-04-02 11:48:51
 * @description: 音乐状态
 */

import { reactive, computed } from "vue";
import { apiUrl } from "../../config/apiBase.js";
import { notifyPlaybackStop, registerPlaybackSource, requestPlaybackStart } from "../../audio/playbackCoordinator.js";
const blogAvatar = "https://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg";
// 歌曲工具
import {
  MODELLIST,
  PLAYTYPE,
  LYRICTYPE,
  getNextMusic,
  calcMusicCurrentTime,
  calcMusicSchedule,
  getMusicDetail,
  getLyric,
  getMusicDescription,
  musicKey,
  _getLocalItem,
  _setLocalItem,
} from "./musicTool.js";

let audio = new Audio();
let unregisterPlayback = null;
const PLAYBACK_SOURCE_ID = "netease-player";
const MIN_PLAY_EVENT_MS = 3000;
let playbackSession = {
  trackId: "",
  startedAtSec: null,
  accumulatedMs: 0,
};

const getToken = () => {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
};

const postPlayEvent = async (payload) => {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(apiUrl("/api/play-events"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // ignore
  }
};

const resetPlaybackSession = () => {
  playbackSession = { trackId: "", startedAtSec: null, accumulatedMs: 0 };
};

const getTrackMeta = (store) => {
  const desc = store?.musicDescription || {};
  const al = desc?.al || {};
  const ar = Array.isArray(desc?.ar) ? desc.ar : [];
  return {
    title: desc?.name || "",
    artistName: ar[0]?.name || "",
    coverUrl: al?.picUrl || "",
    source: store?.musicInfo?.source || "netease",
    sourceId: store?.musicInfo?.sourceId || store?.musicInfo?.id || "",
    audioUrl: store?.musicInfo?.url || "",
  };
};

const finalizePlaybackEvent = async (store, options = {}) => {
  const id = String(store?.musicInfo?.id || "");
  if (!id || playbackSession.trackId !== id) {
    resetPlaybackSession();
    return;
  }

  const nowSec = Number(audio?.currentTime || 0);
  const durationSec = Number(audio?.duration || 0);
  let playedMs = playbackSession.accumulatedMs;
  if (playbackSession.startedAtSec != null) {
    playedMs += Math.max(0, (nowSec - playbackSession.startedAtSec) * 1000);
  }

  const durationMs = Math.max(0, durationSec * 1000);
  const completed = Boolean(options.completed) || (durationSec > 0 && nowSec / durationSec >= 0.92);
  const skipped =
    !completed && durationMs > 0 ? playedMs / durationMs < 0.3 : !completed && playedMs < MIN_PLAY_EVENT_MS;

  if (playedMs < MIN_PLAY_EVENT_MS && !completed) {
    resetPlaybackSession();
    return;
  }

  const meta = getTrackMeta(store);
  await postPlayEvent({
    source: meta.source,
    sourceId: meta.sourceId || id,
    sourceContext: meta.source === "community" ? "community-player" : "netease-player",
    playedMs: Math.round(playedMs),
    durationMs: Math.round(durationMs),
    completed,
    skipped,
    item: {
      source: meta.source,
      sourceId: meta.sourceId || id,
      title: meta.title,
      artistName: meta.artistName,
      coverUrl: meta.coverUrl,
      audioUrl: meta.audioUrl,
    },
  });

  resetPlaybackSession();
};

const setters = {
  // 初始化音乐播放器
  init() {
    if (!audio) {
      audio = new Audio();
    }
    audio.volume = this.volume;
    audio.loop = false;
    audio.autoplay = true;
    audio.preload = true;
    audio.crossOrigin = "anonymous";

    // Global playback coordinator: register once and keep it bound to the current Audio element.
    try {
      unregisterPlayback?.();
    } catch (e) {
      // ignore
    }
    try {
      unregisterPlayback = registerPlaybackSource(PLAYBACK_SOURCE_ID, {
        stop: () => {
          try {
            audio?.pause?.();
          } catch (e) {
            // ignore
          }
          try {
            this.isPaused = true;
          } catch (e) {
            // ignore
          }
        },
      });
    } catch (e) {
      unregisterPlayback = null;
    }

    if (!audio.__playbackCoordinatorBound) {
      audio.__playbackCoordinatorBound = true;
      audio.addEventListener(
        "pause",
        () => {
          notifyPlaybackStop(PLAYBACK_SOURCE_ID);
        },
        { passive: true }
      );
      audio.addEventListener(
        "ended",
        () => {
          notifyPlaybackStop(PLAYBACK_SOURCE_ID);
        },
        { passive: true }
      );
    }

    if (!audio.__playEventBound) {
      audio.__playEventBound = true;
      audio.addEventListener(
        "play",
        () => {
          const id = String(this.musicInfo?.id || "");
          if (!id) return;
          if (playbackSession.trackId !== id) {
            resetPlaybackSession();
            playbackSession.trackId = id;
          }
          playbackSession.startedAtSec = Number(audio.currentTime || 0);
        },
        { passive: true }
      );
      audio.addEventListener(
        "ended",
        () => {
          finalizePlaybackEvent(this, { completed: true });
        },
        { passive: true }
      );
    }

    // 随着音乐播放的变化，需要设置 当前时间的变化 歌词变化
    audio.ontimeupdate = () => {
      if (audio.currentTime) {
        this.currentTime = audio.currentTime;
      }

      if (this.isPaused != audio.paused) {
        this.isPaused = audio.paused;
      }

      if (this.duration != audio.duration) {
        this.duration = audio.duration;
      }
      // 设置播放歌词
      if (!this.isClickLyric) {
        let index = this.musicInfo.lyricTimeList.findIndex((v) => v >= audio.currentTime * 1000);
        this.currentLyricIndex = index - 1 || 0;
      }

      if (!this.isUseProgress) {
        this.currentSchedule = calcMusicSchedule(audio.currentTime, audio.duration);
      }
      // 下一首
      if (audio.ended) {
        this.setNext(true);
      }
    };

    // 初始化的时候如果有音乐id，就获取一下最新的音乐内容
    if (this.musicInfo.id) {
      this.setMusicInfo(this.musicInfo.id, true);
    }
  },
  // 清空当前的时长
  clear() {
    this.duration = 0;
    this.currentLyricIndex = 0;
  },
  // 初始化播放音乐
  setPlay(isInit = false) {
    this.clear();

    // 如果初始化的时候播放进度大于0说明已经播放一段时间了，得自动切换到这歌进度来
    if (isInit) {
      audio.currentTime = this.currentTime;
    } else {
      audio.currentTime = 0;
      this.currentTime = 0;
    }

    // 切换歌曲的时候，让图片回到初始状态
    this.isToggleImg = true;

    if (isInit) {
      if (this.isPaused) {
        audio.pause();
      } else {
        requestPlaybackStart(PLAYBACK_SOURCE_ID);
        audio
          .play()
          .then(() => {
            this.isPaused = false;
            this.isToggleImg = false;
          })
          .catch((res) => {
            this.isPaused = true;
            console.log(res);
          });
      }
    } else {
      requestPlaybackStart(PLAYBACK_SOURCE_ID);
      audio
        .play()
        .then(() => {
          this.isPaused = false;
          this.isToggleImg = false;
        })
        .catch((res) => {
          this.isPaused = true;
          console.log(res);
        });
    }
  },
  togglePlay() {
    this.isToggleImg = false;
    if (this.isPaused) {
      requestPlaybackStart(PLAYBACK_SOURCE_ID);
      audio
        .play()
        .then(() => {
          this.isPaused = false;
        })
        .catch((err) => {
          console.log(err);
        });
    } else {
      audio.pause();
      this.isPaused = true;
      notifyPlaybackStop(PLAYBACK_SOURCE_ID);
    }
  },
  // 设置下一首，或者上一首 ，根据传入参数判断 true 下一首 false 上一首
  setNext(flag = true) {
    // Prefer playback queue; fallback to current list if queue is empty
    let list = Array.isArray(this.playQueue) ? this.playQueue : [];
    if (!list.length) {
      list = this.musicList;
      switch (this.playType) {
        case "TOP":
          list = this.musicList;
          break;
        case "CUSTOM":
          list = this.customerMusicList;
          break;
        default:
          break;
      }
    }
    let len = list.length;
    if (!len) return;
    let index = list.findIndex((item) => item.id == this.musicInfo.id);
    if (index == -1) {
      index = 0;
    }
    // 随机/顺序/单曲循环播放的逻辑
    const musicIndex = getNextMusic(len, index, this.playModel, flag);
    const nextItem = list[musicIndex];
    if (nextItem?.source === "community" && (nextItem.url || nextItem.audioUrl)) {
      this.setCustomTrack(nextItem);
    } else {
      this.setMusicInfo(nextItem.id);
    }
  },
  normalizeTrack(item) {
    const raw = item || {};
    const id = raw.id;
    const name = raw.name || "";
    const ar =
      Array.isArray(raw.ar) && raw.ar.length
        ? raw.ar
        : Array.isArray(raw.artists)
          ? raw.artists.map((a) => ({ id: a?.id, name: a?.name }))
          : [];
    const al = raw.al
      ? raw.al
      : raw.album
        ? {
            id: raw.album?.id,
            name: raw.album?.name,
            picUrl: raw.album?.picUrl || raw.album?.artist?.img1v1Url || "",
          }
        : { name: "", picUrl: "" };

    const source = raw.source || "netease";
    const sourceId = raw.sourceId || raw.id;
    const url = raw.url || raw.audioUrl || "";

    return { id, name, ar, al, source, sourceId, url };
  },
  isInQueue(id) {
    const sid = String(id || "");
    return (this.playQueue || []).some((t) => String(t?.id) === sid);
  },
  addToQueue(track) {
    const t = this.normalizeTrack(track);
    if (!t?.id) return;
    if (!Array.isArray(this.playQueue)) this.playQueue = [];
    if (this.isInQueue(t.id)) return;
    this.playQueue.push(t);
  },
  removeFromQueue(id) {
    const sid = String(id || "");
    if (!Array.isArray(this.playQueue) || !sid) return;
    const idx = this.playQueue.findIndex((t) => String(t?.id) === sid);
    if (idx !== -1) this.playQueue.splice(idx, 1);
  },
  clearQueue() {
    this.playQueue = [];
  },
  // 设置当前播放音乐的信息 搜索列表的歌曲信息时没有的需要传过来
  async setMusicInfo(id, isInit = false) {
    if (!id) return;
    if (String(this.musicInfo?.id || "") && String(this.musicInfo?.id || "") !== String(id)) {
      finalizePlaybackEvent(this, { completed: false });
    }
    const des = await getMusicDescription(id);
    // 通过音乐id 获取音乐简介 描述 歌词信息
    if (des) {
      this.setMusicDescription(des[0]);
      // Played tracks should enter the playback queue automatically
      try {
        this.addToQueue(des[0]);
      } catch (e) {
        // ignore
      }
    }

    // 主要是获取歌曲播放的url地址
    const musicDetail = await getMusicDetail(id);
    const lyric = await getLyric(id);
    let musicInfo = {
      id: id,
      url: musicDetail.url, // 正在播放音乐的详情 音乐地址
      lyricList: lyric.lyricList, // 歌词列表
      lyricTimeList: lyric.lyricTimeList, // 歌词时间列表
      source: "netease",
      sourceId: String(id),
    };
    audio.src = musicDetail.url;
    this.musicInfo = musicInfo;

    await this.setPlay(isInit);
  },
  async setCustomTrack(track, isInit = false) {
    const raw = track || {};
    const sourceId = String(raw.sourceId || raw.id || "").trim();
    const audioUrl = String(raw.url || raw.audioUrl || "").trim();
    if (!sourceId || !audioUrl) return;

    if (String(this.musicInfo?.sourceId || "") !== sourceId || this.musicInfo?.source !== "community") {
      finalizePlaybackEvent(this, { completed: false });
    }

    const customId = String(raw.id || "") || `custom:${sourceId}`;
    const name = String(raw.name || raw.title || "未命名作品");
    const artist = String(raw.ar?.[0]?.name || raw.artistName || "创作者");
    const coverUrl = raw.al?.picUrl || raw.coverUrl || "";

    this.musicDescription = {
      name,
      ar: [{ name: artist }],
      al: { picUrl: coverUrl },
    };

    this.musicInfo = {
      id: customId,
      url: audioUrl,
      lyricList: [],
      lyricTimeList: [],
      source: "community",
      sourceId,
    };

    audio.src = audioUrl;
    await this.setPlay(isInit);
  },
  setMusicDescription(val) {
    this.musicDescription = val;
  },
  setMusicList(list) {
    this.musicList = list;
  },
  // 通过用户拉动进度条 切换音乐的播放时间
  setCurrentTime(progress) {
    let time = calcMusicCurrentTime(progress, audio.duration);
    this.currentTime = time;
    audio.currentTime = time;
    // 设置播放歌词
    let index = this.musicInfo.lyricTimeList.findIndex((v) => v >= audio.currentTime * 1000);
    this.currentLyricIndex = index - 1 || 0;

    if (audio.paused) {
      this.togglePlay();
    }
    setTimeout(() => {
      this.isUseProgress = false;
    }, 200);
  },
  // 通过用户点击歌词设置当前播放时间
  setCurrentTimeByClickLyric(index) {
    this.isClickLyric = true;
    let time = this.musicInfo.lyricTimeList[index];
    audio.currentTime = time / 1000;
    this.currentTime = time / 1000;
    if (audio.paused) {
      this.togglePlay();
    }
    setTimeout(() => {
      this.isClickLyric = false;
    }, 100);
  },
  // 设置音量
  setVolume(progress) {
    let volume = Math.round((progress / 100) * 100) / 100;
    this.volume = volume;
    audio.volume = volume;
  },
  setShowLyricBoard(val) {
    this.showLyricBoard = val;
  },
  setShowQueuePanel(val) {
    this.showQueuePanel = !!val;
  },
  toggleQueuePanel() {
    this.showQueuePanel = !this.showQueuePanel;
  },
  setIsShow(flag) {
    if (flag) {
      this.isShowMusicPlayer = true;
    } else {
      this.isShowMusicPlayer = !this.isShowMusicPlayer;
    }
    if (!this.isShowMusicPlayer) {
      this.showQueuePanel = false;
    }
  },
  setCustomerMusicList(type, music) {
    if (type == "add") {
      this.customerMusicList.push(music);
    } else if (type == "delete") {
      let index = this.customerMusicList.findIndex((item) => item.id == music.id);
      if (index != -1) {
        this.customerMusicList.splice(index, 1);
      }
      if (!this.customerMusicList.length) {
        this.setPlayType(PLAYTYPE.TOP);
      }
    }
  },
  setIsToggleImg(isToggleImg) {
    this.isToggleImg = isToggleImg;
  },
  setLyricType(val) {
    this.lyricType = LYRICTYPE[val];
  },
  setPlayType(type) {
    this.playType = type;
  },
  setPlayModel(model) {
    this.playModel = model;
  },
  setIsUseProgress(val) {
    this.isUseProgress = val;
  },
};

const getters = {
  getAudio() {
    return audio;
  },
  getCurrentTime() {
    return this.currentTime;
  },
  getDuration() {
    return this.duration;
  },
  getVolume() {
    return this.volume;
  },
  getIsPaused() {
    return this.isPaused;
  },
  // 获取当前播放进度
  getCurrentSchedule() {
    return this.currentSchedule;
  },
  getMusicDescription() {
    return this.musicDescription;
  },
  getLyricType() {
    return this.lyricType;
  },
  getMusicInfo() {
    return this.musicInfo;
  },
  getMusicList() {
    return this.musicList;
  },
  getPlayQueue() {
    return this.playQueue;
  },
  getShowLyricBoard() {
    return this.showLyricBoard;
  },
  getShowQueuePanel() {
    return this.showQueuePanel;
  },
  getCurrentLyricIndex() {
    return this.currentLyricIndex;
  },
  getIsShowMusicPlayer() {
    return this.isShowMusicPlayer;
  },
  getIsToggleImg() {
    return this.isToggleImg;
  },
  getPlayType() {
    return this.playType;
  },
  getPlayModel() {
    return this.playModel;
  },
  getCustomerMusicList() {
    return this.customerMusicList;
  },
  getIsClickLyric() {
    return this.isClickLyric;
  },
};

function useMusic() {
  let musicData = _getLocalItem(musicKey);

  const state = reactive({
    volume: 0.5, // 音量
    isPaused: true, // 音乐播放器是否暂停
    currentTime: 0, // 当前播放的时间
    duration: 0, // 歌曲总时长
    musicInfo: {
      id: "", // 正在播放歌曲的id
      url: "", // 正在播放音乐的详情 音乐地址
      lyricList: [], // 歌词列表
      lyricTimeList: [], // 歌词时间列表
    },
    // 正在播放音乐的描述
    musicDescription: {
      al: {
        picUrl: blogAvatar,
      },
      name: "",
      ar: [
        {
          name: "歌手走丢了",
        },
      ],
    },
    lyricType: LYRICTYPE.COMMON, // 歌词模式
    showLyricBoard: false, // 是否展示歌词板
    showQueuePanel: false, // 是否展示播放队列面板
    currentLyricIndex: 0, // 当前歌词的下标
    isShowMusicPlayer: false, // 是否展示音乐控制器
    isToggleImg: false, // 是否正在切换图片
    playType: PLAYTYPE.TOP, // 播放列表 是用户选择的列表还是当前歌曲排行榜的列表 top表示排行 user表示用户选择的
    playModel: MODELLIST[0], // 播放模式 随机：RANDOM 列表循环：LISTLOOP 单曲循环：SINGLECYCLE
    musicList: [], // 当前排行榜音乐列表
    playQueue: [], // 播放队列（仅播放过/手动加入）
    customerMusicList: [], // 用户添加的音乐列表
    currentSchedule: 0,
    isUseProgress: false,
    isClickLyric: false,
  });
  // 初始化状态
  initState(state, musicData || {});
  // 把 setters 和 getters 绑定到 state上
  Object.assign(state, setters, getters);
  // 给setter 绑定 this
  let musicSetters = bindSetters(setters, state);
  // 给 getters 使用computed缓存值 当state中数据变化时 computed可以更新值 完成响应式
  let musicGetters = computedGetters(getters, state);

  // 保存当前播放数据
  function saveMusicInfo() {
    _setLocalItem(musicKey, state);
  }
  // 移除 当前audio 防止闭包 audio不会被清除
  function removeAudio() {
    try {
      finalizePlaybackEvent(state, { completed: false });
    } catch (e) {
      // ignore
    }
    audio && audio.pause();
    audio = null;
    try {
      unregisterPlayback?.();
    } catch (e) {
      // ignore
    }
    unregisterPlayback = null;
  }

  console.log(
    `%c M's Music-Player %c v1.0.0 %c \n 初始化成功～`,
    "color: #fff;background: #434345;padding: 3px 0 3px 3px; border-top-left-radius: 3px;border-bottom-left-radius: 3px;",
    "color: #fff;background: #42d392;padding: 3px 6px 3px 0; border-top-right-radius: 3px;border-bottom-right-radius: 3px;",
    "color: #42d392; margin-top: 5px; margin-left: -7px;"
  );

  return {
    musicSetters,
    musicGetters,
    saveMusicInfo,
    removeAudio,
  };
}

function bindSetters(setters, store) {
  let bindSetters = {};
  Object.keys(setters).forEach((name) => {
    bindSetters[name] = setters[name].bind(store);
  });

  return bindSetters;
}
function computedGetters(getters, store) {
  let computedGetters = {};
  Object.keys(getters).forEach((name) => {
    computedGetters[name] = computed(() => {
      return getters[name].apply(store);
    });
  });

  return computedGetters;
}

function initState(state, data) {
  Object.assign(state, data);
}

export default useMusic;
