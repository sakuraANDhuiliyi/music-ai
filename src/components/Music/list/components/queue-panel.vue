<script setup>
import { computed, defineComponent, inject } from "vue";

defineComponent({
  name: "QueuePanel",
});

const musicGetters = inject("musicGetters");
const musicSetters = inject("musicSetters");

const { getShowQueuePanel, getPlayQueue, getMusicInfo } = musicGetters;

const isOpen = computed(() => !!getShowQueuePanel.value);

const queueTitle = computed(() => "播放队列");

const queueList = computed(() => getPlayQueue.value || []);

const isCurrent = (id) => String(getMusicInfo.value?.id || "") === String(id || "");

const close = () => musicSetters.setShowQueuePanel(false);

const play = (item) => {
  if (!item?.id) return;
  if (item?.source === "community" && (item?.url || item?.audioUrl)) {
    musicSetters.setCustomTrack(item);
  } else {
    musicSetters.setMusicInfo(item.id);
  }
};

const removeFromQueue = (item) => {
  if (!item?.id) return;
  musicSetters.removeFromQueue(item.id);
};

const clearQueue = () => {
  musicSetters.clearQueue();
};
</script>

<template>
  <div v-show="isOpen" class="queue-panel" @click.self="close">
    <div class="queue-card">
      <div class="queue-header">
        <div class="queue-title">
          {{ queueTitle }}
          <span class="queue-count" v-if="queueList.length">（{{ queueList.length }}）</span>
        </div>
        <div class="queue-actions">
          <button v-if="queueList.length" class="queue-clear" @click="clearQueue">清空</button>
          <i class="iconfont icon-off-search change-color" title="关闭" @click="close"></i>
        </div>
      </div>

      <div class="queue-body scroll-container">
        <div v-if="!queueList.length" class="queue-empty">空空如也</div>

        <div
          v-for="(item, idx) in queueList"
          :key="item.id || idx"
          class="queue-item"
          :class="{ current: isCurrent(item.id) }"
          @dblclick="play(item)"
        >
          <div class="queue-left">
            <span class="queue-index">{{ idx + 1 }}</span>
            <div class="queue-text">
              <div class="queue-name text-overflow" :title="item.name">{{ item.name }}</div>
              <div class="queue-sub text-overflow" :title="item.ar?.[0]?.name || item.artists?.[0]?.name || ''">
                {{ item.ar?.[0]?.name || item.artists?.[0]?.name || "" }}
              </div>
            </div>
          </div>

          <div class="queue-right">
            <i class="iconfont icon-bofangzhong play-btn" title="播放" @click.stop="play(item)"></i>
            <i
              class="iconfont icon-off-search delete-btn"
              title="移除"
              @click.stop="removeFromQueue(item)"
            ></i>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.queue-panel {
  position: absolute;
  top: 56px;
  right: 10px;
  z-index: 30;
  width: min(420px, calc(100% - 20px));
  pointer-events: auto;
}

.queue-card {
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: var(--card-box-shadow);
  border: 1px solid var(--border-color, #f0f0f0);
  overflow: hidden;
}

.queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color, #f5f5f5);
}

.queue-title {
  font-weight: 800;
  font-size: 1rem;
  color: var(--font-color);
}

.queue-count {
  font-weight: 600;
  opacity: 0.7;
  margin-left: 6px;
}

.queue-actions .iconfont {
  font-size: 1.2rem;
}

.queue-clear {
  border: 1px solid var(--border-color, #eaeaea);
  background: transparent;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.8rem;
  color: var(--font-color);
  opacity: 0.8;
  cursor: pointer;
  margin-right: 10px;
}

.queue-clear:hover {
  opacity: 1;
  border-color: rgba(98, 194, 138, 0.6);
  color: var(--music-main-active);
}

.queue-body {
  max-height: 360px;
  overflow: auto;
}

.queue-empty {
  padding: 26px 14px;
  text-align: center;
  opacity: 0.65;
}

.queue-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color, #fafafa);
  transition: background 0.2s;
}

.queue-item:hover {
  background: rgba(0, 0, 0, 0.03);
}

.queue-item.current {
  background: rgba(98, 194, 138, 0.12);
}

.queue-left {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.queue-index {
  width: 18px;
  opacity: 0.55;
  font-style: italic;
}

.queue-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.queue-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--font-color);
}

.queue-sub {
  font-size: 0.8rem;
  opacity: 0.7;
}

.queue-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  opacity: 0.75;
}

.queue-item:hover .queue-right {
  opacity: 1;
}

.play-btn {
  font-size: 1.2rem;
}

.delete-btn {
  font-size: 1.1rem;
  opacity: 0.65;
}

.delete-btn:hover {
  opacity: 1;
  color: #f56c6c;
}

.change-color:hover {
  cursor: pointer;
  color: var(--music-main-active);
}

.text-overflow {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scroll-container {
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
}
</style>
