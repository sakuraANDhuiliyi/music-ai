<script setup>
import {
  defineComponent,
  onMounted,
  computed,
  watch,
  ref,
  reactive,
  onBeforeUnmount,
  h,
  inject,
  nextTick,
} from "vue";

import { reqToplist, reqTopDetaliList } from "@/api/music.js";
import { PLAYTYPE } from "../musicTool.js";
import { ElNotification } from "element-plus";
import SearchList from "./components/search-list.vue";
import LyricBoard from "./components/lyric-board.vue";
import Loading from "@/components/Loading/Loading.vue"; 
import { authFetch } from "@/composables/useUser.js";

const musicGetters = inject("musicGetters");
const musicSetters = inject("musicSetters");

const { getPlayQueue } = musicGetters;

const topList = ref([]);

const currentMusicList = ref([]); // 当前音乐播放列表
const dailyList = ref([]);
const dailyLoading = ref(false);

const currentTop = ref(null);
const DAILY_TOP_ID = "__daily__";
const DAILY_COVER =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%25' stop-color='%2360a5fa'/><stop offset='100%25' stop-color='%2334d399'/></linearGradient></defs><rect width='100%25' height='100%25' fill='url(%23g)'/></svg>";

const dailyCard = computed(() => ({
  id: DAILY_TOP_ID,
  name: "每日推荐",
  coverImgUrl: DAILY_COVER,
  isDaily: true,
}));

const displayTopList = computed(() => [dailyCard.value, ...topList.value]);
const isDailyTop = computed(() => currentTop.value?.id === DAILY_TOP_ID);

let observe, box;

defineComponent({
  name: "MusicList",
});

const params = reactive({
  limit: 30,
  offset: 0,
  id: "",
  loading: false,
  loadMore: true,
});

const musicCategoryLoading = ref(false); // 音乐分类加载
const musicListLoading = ref(false); // 音乐列表加载
const musicScrollLoading = ref(false); // 音乐滚动加载

//  获取音乐排行榜
const reqMusicList = async () => {
  try {
    musicCategoryLoading.value = true;
    const res = await reqToplist();
    const code = Number(res?.code ?? res?.data?.code ?? 0);
    const list = res?.list || res?.data?.list || [];
    if (code === 200 && Array.isArray(list)) {
      topList.value = list;
      musicCategoryLoading.value = false;
      if (topList.value && topList.value.length) {
        // 默认取第4个（飙升榜？），如果没有则取第1个
        let targetIndex = topList.value.length > 3 ? 3 : 0;
        currentTop.value = topList.value[targetIndex];
        musicSetters.setPlayType(PLAYTYPE.TOP);
        await reqTopMusicList(topList.value[targetIndex].id);
      }
    } else {
        console.error("Failed to load top list, code:", res.code);
        ElNotification({ title: '错误', message: '获取榜单失败', type: 'error' });
    }
  } catch (error) {
     console.error("ReqMusicList Error:", error);
     ElNotification({ title: '错误', message: '网络请求失败，请检查连接', type: 'error' });
  } finally {
     musicCategoryLoading.value = false;
  }
};

// 根据排行榜id 查询排行榜音乐
const reqTopMusicList = async (id) => {
  if (id) {
    params.id = id;
  }
  // Ensure ID is present
  if (!params.id) return; 

  if (!params.loadMore) {
    return;
  }
  try {
    if (params.offset == 0) {
      musicListLoading.value = true;
    } else {
      musicScrollLoading.value = true;
    }
    // 修复：传入正确的参数格式（id, limit, offset）而非对象
    const res = await reqTopDetaliList(params.id, params.limit, params.offset);
    const code = Number(res?.code ?? res?.data?.code ?? 0);
    const songs =
      res?.songs ||
      res?.playlist?.tracks ||
      res?.data?.songs ||
      res?.data?.playlist?.tracks ||
      [];
    if ((code === 200 || songs.length) && Array.isArray(songs)) {
      getFlagToMusicList(songs);
      if (!songs.length) {
        params.loadMore = false;
      }
      currentMusicList.value =
        params.offset == 0 ? songs : currentMusicList.value.concat(songs);
      musicSetters.setMusicList(currentMusicList.value);
    }
  } catch (error) {
     console.error("Failed to load music list:", error);
     ElNotification({ title: '加载失败', message: '获取歌曲列表失败，请重试', type: 'error' });
  } finally {
    musicListLoading.value = false;
    musicScrollLoading.value = false;
    nextTick(() => {
      observeBox();
    });
  }
};

// 无限加载
const observeBox = () => {
  // 获取要监听的元素
  box = document.querySelector(".observe");
  if (!box) return;

  if (observe) {
    observe.disconnect();
  }

  observe = new IntersectionObserver(
    (entries) => {
      entries.forEach(async (e) => {
        if (e.isIntersecting && e.intersectionRatio > 0) {
          if (!musicListLoading.value && params.loadMore) {
            loadMore();
          }
        }
      });
    },
    { threshold: [0.1] }
  );
  observe.observe(box);
};

const playMusic = (item) => {
  if (item?.source === "community") {
    const audioUrl = String(item.url || item.audioUrl || "").trim();
    if (!audioUrl) {
      ElNotification({
        offset: 60,
        title: "提示",
        duration: 1200,
        message: h("div", { style: "color: #f97316; font-weight: 600;" }, "该作品暂无音频，无法播放"),
      });
      return;
    }
    musicSetters.addToQueue(item);
    musicSetters.setCustomTrack({ ...item, audioUrl });
    return;
  }
  musicSetters.addToQueue(item);
  musicSetters.setMusicInfo(item.id);
};

const normalizeDailyItems = () => {
  return (dailyList.value || []).map((entry, index) => {
    const item = entry?.item || entry || {};
    const sourceId = String(item.sourceId || item.id || "").trim();
    const audioUrl = String(item.audioUrl || "").trim();
    const safeSourceId = sourceId || `unknown-${index}`;
    return {
      id: `community:${safeSourceId}`,
      name: item.title || "未命名作品",
      ar: [{ name: item.artistName || "创作者" }],
      al: { name: "社区作品", picUrl: item.coverUrl || "" },
      source: "community",
      sourceId: safeSourceId,
      audioUrl,
      url: audioUrl,
    };
  });
};

const fetchDailyRecommendations = async () => {
  dailyLoading.value = true;
  try {
    const res = await authFetch("/api/recommendations/daily");
    if (!res.ok) {
      dailyList.value = [];
      return;
    }
    const data = await res.json().catch(() => null);
    dailyList.value = Array.isArray(data?.items) ? data.items : [];
    if (isDailyTop.value) {
      const dailyItems = normalizeDailyItems();
      getFlagToMusicList(dailyItems);
      currentMusicList.value = dailyItems;
      musicSetters.setMusicList(currentMusicList.value);
    }
  } catch {
    dailyList.value = [];
  } finally {
    dailyLoading.value = false;
  }
};

// 切换排行榜置空数据
const clickTopMusicList = async (item) => {
  if (!item?.id) return;
  musicSetters.setPlayType(PLAYTYPE.TOP);
  if (currentTop.value && currentTop.value.id === item.id) {
    if (currentMusicList.value.length) {
      musicSetters.setMusicList(currentMusicList.value);
    }
    return;
  }

  currentTop.value = item;
  params.offset = 0;
  currentMusicList.value = [];
  musicSetters.setMusicList([]);

  if (item.id === DAILY_TOP_ID) {
    params.id = "";
    params.loadMore = false;
    if (observe) {
      observe.disconnect();
    }
    if (!dailyList.value.length && !dailyLoading.value) {
      await fetchDailyRecommendations();
    }
    const dailyItems = normalizeDailyItems();
    getFlagToMusicList(dailyItems);
    currentMusicList.value = dailyItems;
    musicSetters.setMusicList(currentMusicList.value);
    return;
  }

  params.id = item.id;
  params.loadMore = true;
  reqTopMusicList();
};

// 添加歌曲
const customerAddMusic = (item) => {
  if (isActive(item.id)) return;
  if (item?.source === "community") {
    const audioUrl = String(item.url || item.audioUrl || "").trim();
    if (!audioUrl) {
      ElNotification({
        offset: 60,
        title: "提示",
        duration: 1200,
        message: h("div", { style: "color: #f97316; font-weight: 600;" }, "该作品暂无音频，无法加入播放队列"),
      });
      return;
    }
  }
  musicSetters.addToQueue(item);
  ElNotification({
    offset: 60,
    title: "提示",
    duration: 1000,
    message: h("div", { style: "color: #7ec050; font-weight: 600;" }, "已加入播放队列"),
  });
};
// 判断当前歌曲是否在用户定制列表中
const isActive = (id) => {
  if (!getPlayQueue.value.length) {
    return false;
  }
  let index = getPlayQueue.value.findIndex((item) => item.id == id);
  if (index == -1) {
    return false;
  } else {
    return true;
  }
};
// 判断歌曲是否被添加了
const getFlagToMusicList = (songs) => {
  Array.isArray(songs) &&
    songs.forEach((song) => {
      song.active = isActive(song.id);
    });
};

const loadMore = () => {
  if (isDailyTop.value) return;
  params.offset = params.offset + params.limit;
  reqTopMusicList();
};

watch(
  () => getPlayQueue.value.length,
  () => {
    getFlagToMusicList(currentMusicList.value);
  }
);

onMounted(async () => {
  await reqMusicList();
  await fetchDailyRecommendations();
});

onBeforeUnmount(() => {
  if (observe && box) {
    observe.unobserve(box);
  }
  observe = null;
});
</script>

<template>
  <div class="music-list">
    <div class="container">
      <div class="music-list__left">
        <div class="header">分类歌单</div>
        <div class="body scroll-container">
          <div v-if="musicCategoryLoading" class="loading-wrapper">
            <Loading :size="48" />
          </div>
          <div v-else>
            <div class="playlist-grid">
              <div
                class="playlist-item"
                v-for="item in displayTopList"
                :key="item.id"
                @click="clickTopMusicList(item)"
                :class="{ active: currentTop && currentTop.id === item.id }"
              >
                <div class="img-wrapper">
                  <img class="cover-img" :src="item.coverImgUrl" loading="lazy" />
                  <div class="overlay">
                    <span class="category-name">{{ item.name }}</span>
                  </div>
                  <!-- Play status icon overlay -->
                  <div class="play-status" v-if="currentTop && currentTop.id === item.id">
                     <i class="iconfont icon-bofangzhong playing-anim"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="music-list__right">
        <div class="right-header">
          <div class="top-info" v-if="currentTop">
             <span class="top-name text-overflow" :title="currentTop.name">{{ currentTop.name }}</span>
          </div>
           <div class="search-btn">
             <el-popover
              ref="elPopoverRef"
              placement="bottom-end"
              :width="330"
              trigger="click"
             >
                <template #reference>
                  <i class="iconfont icon-nav-search hover:text-[#62c28a] cursor-pointer text-xl" title="搜索歌曲"></i>
                </template>
                <SearchList />
             </el-popover>
           </div>
        </div>

        <div class="song-list-header">
           <div class="col col-1">歌曲</div>
           <div class="col col-2">作者</div>
           <div class="col col-3">专辑</div>
        </div>

        <div class="body scroll-container" ref="songListContainer">
           <div v-if="musicListLoading && params.offset === 0" class="loading-wrapper">
              <Loading :size="48" />
           </div>
           
           <div v-else class="song-list">
              <template v-if="currentMusicList.length > 0">
                <div 
                    class="song-item" 
                    v-for="(item, index) in currentMusicList" 
                    :key="item.id"
                    @dblclick="playMusic(item)"
                >
                    <div class="col col-1 name-col">
                        <span class="index-num">{{ index + 1 }}</span>
                        <div class="text-wrapper">
                            <span class="song-name text-overflow" :title="item.name">{{ item.name }}</span>
                            <div class="tags" v-if="item.alia && item.alia[0]">
                            <span class="tag">{{ item.alia[0] }}</span>
                            </div>
                        </div>
                        <div class="actions">
                            <i class="iconfont icon-bofangzhong play-btn" @click.stop="playMusic(item)" title="播放"></i>
                            <i 
                            class="iconfont icon-tianjiadao add-btn" 
                            :class="{ active: item.active }"
                            @click.stop="customerAddMusic(item)"
                            title="加入播放队列"
                            ></i>
                        </div>
                    </div>
                    <div class="col col-2 author-col">
                        <span class="text-overflow" v-if="item.ar && item.ar[0]" :title="item.ar[0].name">{{ item.ar[0].name }}</span>
                    </div>
                    <div class="col col-3 album-col">
                        <span class="text-overflow" v-if="item.al" :title="item.al.name">{{ item.al.name }}</span>
                    </div>
                </div>

                <div v-if="!isDailyTop" class="observe" @click="loadMore">
                    <template v-if="!musicListLoading">
                        <Loading :size="24" v-if="musicScrollLoading" />
                        <span v-else class="load-text">{{ params.loadMore ? "加载更多" : "没有更多了" }}</span>
                    </template>
                </div>
              </template>
              <div v-else class="empty-state">
                  暂无歌曲数据
              </div>
           </div>
        </div>
      </div>
    </div>
    <!-- 歌词面板 -->
    <LyricBoard />
  </div>
</template>

<style lang="scss" scoped>
.music-list {
  width: 100%;
  height: 100%;
  padding: 20px;
  display: flex;
  justify-content: center;
  overflow: hidden;
  
  .container {
    width: 100%; 
    max-width: 1200px;
    height: 100%;
    display: flex;
    background: var(--card-bg);
    border-radius: 12px;
    box-shadow: var(--card-box-shadow);
    overflow: hidden;
    color: var(--font-color);
  }

  /* Left Side: Playlist Grid */
  &__left {
    width: 450px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-color, #eee);
    display: flex;
    flex-direction: column;
    /* Use solid background or safe opacity */
    background: var(--card-bg);
    opacity: 0.95;

    .header {
      padding: 16px 20px;
      font-size: 1.25rem;
      font-weight: 700;
    }
    
    .body {
       flex: 1;
       overflow-y: auto;
       padding: 0 16px 16px 16px;
    }

    .playlist-grid {
      display: grid;
      // 4 Columns as requested
      grid-template-columns: repeat(4, 1fr); 
      gap: 12px;
    }

    .playlist-item {
      cursor: pointer;
      position: relative;
      transition: all 0.2s;
      border-radius: 8px;
      overflow: hidden;
      
      &:hover {
         transform: translateY(-4px);
         box-shadow: 0 4px 12px rgba(0,0,0,0.15);
         .cover-img { filter: brightness(0.8); }
      }
      &.active {
         outline: 2px solid var(--music-main-active);
         outline-offset: 2px;
      }

      .img-wrapper {
        position: relative;
        width: 100%;
        padding-bottom: 100%; /* Square aspect ratio */
        background: #f0f0f0;
      }
      
      .cover-img {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        object-fit: cover;
      }

      .overlay {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        padding: 4px 6px;
        background: rgba(0,0,0,0.6);
        color: #fff;
        font-size: 0.75rem;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .play-status {
        position: absolute;
        top: 5px; right: 5px;
        color: var(--music-main-active);
        background: rgba(255,255,255,0.8);
        border-radius: 50%;
        width: 20px; height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        i { font-size: 12px; }
      }
    }
  }

  /* Right Side: Song List */
  &__right {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--card-bg);

    .right-header {
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color, #f0f0f0);
      
      .top-name {
         font-size: 1.5rem;
         font-weight: 800;
      }
    }

    .song-list-header {
      display: flex;
      padding: 10px 20px;
      font-size: 0.9rem;
      opacity: 0.7;
      border-bottom: 1px solid var(--border-color, #f5f5f5);
      
      .col-1 { flex: 2; }
      .col-2 { flex: 1; }
      .col-3 { flex: 1; }
    }

    /* Make the right list scrollable */
    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    .song-list {
       flex: 1;
       
       .empty-state {
         padding: 40px;
         text-align: center;
         color: #999;
       }

       .song-item {
          display: flex;
          align-items: center;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border-color, #f9f9f9);
          cursor: default;
          transition: background 0.2s;
          
          &:hover {
             background: rgba(0,0,0,0.03);
             .name-col .actions { opacity: 1; }
          }

          .col {
             overflow: hidden;
             white-space: nowrap;
             text-overflow: ellipsis;
             padding-right: 10px;
          }
          .col-1 { flex: 2; display: flex; align-items: center; }
          .col-2 { flex: 1; font-size: 0.9rem; opacity: 0.8; }
          .col-3 { flex: 1; font-size: 0.9rem; opacity: 0.6; }
          
          .index-num {
             width: 30px;
             opacity: 0.5;
             font-style: italic;
             flex-shrink: 0;
          }

          .text-wrapper {
             flex: 1;
             min-width: 0;
             display: flex;
             flex-direction: column;
          }

          .song-name {
             font-size: 1rem;
             font-weight: 500;
          }
          
          .tags {
             margin-top: 2px;
             .tag {
                border: 1px solid #62c28a;
                color: #62c28a;
                font-size: 0.7rem;
                padding: 0 4px;
                border-radius: 4px;
                transform: scale(0.9);
                transform-origin: left center;
             }
          }

          .actions {
             margin-left: 10px;
             flex-shrink: 0;
             opacity: 0;
             transition: opacity 0.2s;
             
             i {
                cursor: pointer;
                margin-left: 10px;
                font-size: 1.2rem;
                opacity: 0.6;
                transition: all 0.2s; 
                &:hover { opacity: 1; color: var(--music-main-active); transform: scale(1.1); }
                &.active { color: #f56c6c; opacity: 1; }
             }
          }
       }
    }

    .observe {
       padding: 20px;
       text-align: center;
       cursor: pointer;
       opacity: 0.6;
       &:hover { opacity: 1; color: var(--music-main-active); }
    }
  }

  .scroll-container {
    &::-webkit-scrollbar { width: 6px; }
    &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 3px; }
    &::-webkit-scrollbar-track { background: transparent; }
  }

  .loading-wrapper {
     height: 100%; 
     width: 100%;
     display: grid; 
     place-content: center;
  }
}

/* Mobile responsive */
@media (max-width: 900px) {
  .music-list {
     padding: 0; 
     height: 100vh; /* Full screen on mobile */
     .container {
        flex-direction: column;
        border-radius: 0;
     }
  }
  .music-list__left {
     width: 100%;
     height: 200px; /* Fixed height for playlist selector */
     border-right: none;
     border-bottom: 1px solid var(--border-color);
     
     .playlist-grid {
         /* Horizontal scroll on mobile */
         display: flex;
         overflow-x: auto;
         padding-bottom: 10px;
     }
     .playlist-item {
         width: 100px;
         flex-shrink: 0;
     }
  }
  .music-list__right {
     width: 100%;
     flex: 1;
  }
}
</style>
