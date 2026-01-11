<script setup>
import { defineComponent, h, ref, reactive, inject } from "vue";

import { ElNotification } from "element-plus";
import { reqSearch } from "@/api/music.js";
import Loading from "@/components/Loading/Loading.vue";

defineComponent({
  name: "CustomMusicList",
});

const musicGetters = inject("musicGetters");
const musicSetters = inject("musicSetters");

const { getPlayQueue } = musicGetters;
const keyWords = ref(""); // 搜索关键词
const keyWordsSongs = ref([]); //
const params = reactive({
  limit: 20,
  offset: 0,
  id: "",
  loadMore: true,
  loading: false,
});

const primaryParams = reactive({ ...params });

const playMusic = (item) => {
  // 设置当前播放音乐
  musicSetters.addToQueue(item);
  musicSetters.setMusicInfo(item.id, false);
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
// 添加歌曲
const customerAddMusic = (item) => {
  if (isActive(item.id)) return;
  musicSetters.addToQueue(item);

  keyWordsSongs.value.forEach((song) => {
    song.active = isActive(song.id);
  });
  ElNotification({
    offset: 60,
    title: "提示",
    duration: 1000,
    message: h("div", { style: "color: #7ec050; font-weight: 600;" }, "已加入播放队列"),
  });
};

const returnAuthors = (arr, attr) => {
  let resArr = arr.map((v) => {
    return v[attr];
  });

  return resArr.join(",");
};

const coverOf = (item) => {
  return (
    item?.album?.picUrl ||
    item?.album?.artist?.img1v1Url ||
    item?.album?.artist?.picUrl ||
    ""
  );
};

// 搜索歌曲
const search = async (type) => {
  params.loading = true;

  if (type !== "loadMore") {
    Object.assign(params, primaryParams);
  }
  if (!keyWords.value) {
    keyWordsSongs.value = [];
    return;
  }

  const res = await reqSearch(keyWords.value, params.offset, params.limit);
  if (res.code == 200) {
    let list = Array.isArray(res.result.songs) ? res.result.songs : [];
    keyWordsSongs.value = params.offset == 0 ? list : keyWordsSongs.value.concat(list);
    params.loading = false;
    if (!keyWordsSongs.value.length) {
      params.loadMore = false;
      ElNotification({
        offset: 60,
        title: "提示",
        duration: 1000,
        message: h("div", { style: "color: #7ec050; font-weight: 600;" }, "没有相关的歌曲"),
      });
      return;
    }
    if (type !== "loadMore") {
      document.querySelector(".search-music-list__detail").scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }

    keyWordsSongs.value.forEach((song) => {
      song.active = isActive(song.id);
    });
  }
};

const searchSingerSongs = async (type) => {
  if (!params.loadMore) return;
  if (type == "init") {
    params.offset = 0;
  } else {
    params.offset = params.limit + params.offset;
  }
  search("loadMore");
};
</script>

<template>
  <div class="search-music-list">
    <div class="search-header">
      <el-input
        v-model="keyWords"
        placeholder="搜索歌名 / 歌手"
        @keyup.enter="search"
        clearable
        size="large"
      >
        <template #append>
          <el-button @click="search">搜索</el-button>
        </template>
      </el-input>
    </div>

    <div class="search-music-list__detail">
      <div v-if="!keyWordsSongs.length" class="empty">
        <div class="empty-title">输入关键词开始搜索</div>
        <div class="empty-sub">支持歌名 / 歌手，回车即可搜索</div>
      </div>

      <div v-else class="results">
        <div class="list-header">
          <div class="col col-song">歌曲</div>
          <div class="col col-artist">歌手</div>
          <div class="col col-album">专辑</div>
          <div class="col col-actions">操作</div>
        </div>

        <div class="list-body">
          <div v-for="(item, idx) in keyWordsSongs" :key="item.id" class="row" @dblclick="playMusic(item)">
            <div class="col col-song">
              <span class="index">{{ idx + 1 }}</span>
              <img v-if="coverOf(item)" class="cover" :src="coverOf(item)" loading="lazy" />
              <div class="meta">
                <div class="name text-overflow" :title="item.name">{{ item.name }}</div>
                <div v-if="item.alias?.[0]" class="alias text-overflow" :title="item.alias[0]">{{ item.alias[0] }}</div>
              </div>
            </div>

            <div class="col col-artist">
              <span class="text-overflow" :title="returnAuthors(item.artists, 'name')">
                {{ returnAuthors(item.artists, "name") }}
              </span>
            </div>

            <div class="col col-album">
              <span class="text-overflow" :title="item.album?.name || ''">{{ item.album?.name || "" }}</span>
            </div>

            <div class="col col-actions">
              <i class="iconfont icon-bofangzhong action" title="播放" @click.stop="playMusic(item)"></i>
              <i
                :class="['iconfont', 'icon-tianjiadao', 'action', item.active ? 'active' : '']"
                title="加入播放队列"
                @click.stop="customerAddMusic(item)"
              ></i>
            </div>
          </div>

          <div class="observe" @click="searchSingerSongs('loadMore')">
            <Loading :size="22" v-if="params.loading" />
            <template v-else>
              {{ params.loadMore ? "加载更多" : "已经到底了" }}
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.search-music-list {
  width: 330px;
  padding: 10px;
  box-sizing: border-box;
  color: var(--font-color);

  .search-header {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--card-bg);
    padding-bottom: 10px;
  }

  &__detail {
    height: 360px;
    overflow: auto;
    border-radius: 12px;
    border: 1px solid var(--border-color, #f0f0f0);
    background: var(--card-bg);
  }

  .empty {
    height: 100%;
    display: grid;
    place-content: center;
    text-align: center;
    padding: 24px;
    opacity: 0.8;

    .empty-title {
      font-weight: 800;
      font-size: 1rem;
    }

    .empty-sub {
      margin-top: 6px;
      font-size: 0.85rem;
      opacity: 0.7;
    }
  }

  .results {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .list-header {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    font-size: 0.8rem;
    opacity: 0.75;
    border-bottom: 1px solid var(--border-color, #f5f5f5);
    position: sticky;
    top: 0;
    background: var(--card-bg);
    z-index: 1;
  }

  .list-body {
    flex: 1;
  }

  .row {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-color, #fafafa);
    transition: background 0.2s;
  }

  .row:hover {
    background: rgba(0, 0, 0, 0.03);
  }

  .col {
    min-width: 0;
    padding-right: 10px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .col-song {
    flex: 1.6;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .col-artist {
    flex: 1;
    opacity: 0.85;
    font-size: 0.9rem;
  }

  .col-album {
    flex: 1;
    opacity: 0.7;
    font-size: 0.9rem;
  }

  .col-actions {
    width: 66px;
    padding-right: 0;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-shrink: 0;
  }

  .index {
    width: 18px;
    opacity: 0.55;
    font-style: italic;
    flex-shrink: 0;
  }

  .cover {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(0, 0, 0, 0.04);
  }

  .meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .alias {
    font-size: 0.75rem;
    opacity: 0.7;
    margin-top: 2px;
  }

  .action {
    cursor: pointer;
    opacity: 0.65;
    transition: all 0.2s;
    font-size: 1.15rem;
  }

  .action:hover {
    opacity: 1;
    color: var(--music-main-active);
    transform: scale(1.08);
  }

  .active {
    color: var(--music-main-active);
    opacity: 1;
  }

  .text-overflow {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
:deep(.el-input-group__append) {
  color: #fff;
  background-color: var(--music-main-active);
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
}
.observe {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 0;
  color: var(--music-main-active);
  cursor: pointer;
  opacity: 0.8;
  font-weight: 600;
}
.observe:hover {
  opacity: 1;
}
</style>
