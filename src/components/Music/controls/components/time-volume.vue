
<script setup>
import { defineComponent, ref, watch, inject } from "vue";

import { MODELLIST } from "@/utils/enum.js";

import { calcMusicTime } from "../../musicTool.js";

const musicGetters = inject("musicGetters");
const musicSetters = inject("musicSetters");

const { getPlayModel, getVolume, getCurrentTime, getDuration, getShowQueuePanel } = musicGetters;

defineComponent({
  name: "TimeVolume",
});

const myPlayModel = {
  RANDOM: "icon-suijibofang",
  LISTLOOP: "icon-liebiaoxunhuan",
  SINGLECYCLE: "icon-danquxunhuan",
};

defineEmits(["update:getVolume"]);

const currentVolume = ref(0);
// 切换音乐播放模式
const changeModel = () => {
  let index = MODELLIST.findIndex((item) => item == getPlayModel.value);
  if (index != -1) {
    if (index == 2) {
      index = 0;
    } else {
      index = index + 1;
    }
  }
  musicSetters.setPlayModel(MODELLIST[index]);
};

const toggleQueue = () => {
  musicSetters.setShowQueuePanel(!getShowQueuePanel.value);
};

watch(
  () => getVolume.value,
  (newV) => {
    // 根据pina存的声音来改变播放器声音大小
    // 存的是除以了 100 的小数
    currentVolume.value = newV * 100;
  },
  {
    immediate: true,
  }
);
watch(
  () => currentVolume.value,
  () => {
    // 修改音乐大小 外面会根据音乐大小去调节音乐播放器的声音大小
    musicSetters.setVolume(currentVolume.value);
  }
);
</script>

<template>
  <div class="time-getVolume">
    <!-- 音乐模式 -->
    <i :class="['change-color', 'iconfont', myPlayModel[getPlayModel]]" @click="changeModel"></i>
    <!-- 时间显示 -->
    <span class="time">{{ calcMusicTime(getCurrentTime) }} / {{ calcMusicTime(getDuration) }}</span>
    <!-- 音量调节 -->
    <el-popover placement="top" trigger="click" :width="42">
      <template #reference>
        <i class="iconfont icon-yinliang change-color"> </i>
      </template>
      <template #default>
        <el-slider v-model="currentVolume" :show-tooltip="false" vertical height="60px" />
      </template>
    </el-popover>
    <!-- 播放队列（右上角面板） -->
    <i class="iconfont icon-bofangliebiao change-color" title="播放队列" @click="toggleQueue"></i>
  </div>
</template>

<style lang="scss" scoped>
.time-getVolume {
  position: relative;
  width: 120px;
  display: flex;
  justify-content: space-around;
  align-items: center;

  .time {
    font-size: 1rem;
  }
}
.getVolume {
  position: absolute;
  top: -22px;
  right: -8px;
}
.icon-yinliang {
  font-size: 1.6rem;
}

.change-color:hover {
  cursor: pointer;
  color: var(--music-main-active);
}

// mobile
@media screen and (max-width: 768px) {
  .icon-yinliang {
    display: none;
  }
}

:deep(.el-slider__bar) {
  background-color: var(--music-main-active);
}

:deep(.el-slider__button) {
  width: 8px;
  height: 8px;
  border: solid 2px var(--music-main-active);
}
:deep(.el-slider__runway) {
  margin: 6px 16px 4px 16px !important;
}
</style>
