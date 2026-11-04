<script setup lang="ts">
/**
 * 视频播放器（设计系统 v2 §4 VideoPlayer）
 * - r-md、--media-bg 底；控制条浮层：播放/暂停、进度（--accent）、时间、音量、保存、全屏
 * - 触摸目标 ≥ 40px；播放中 3s 自动隐藏控制条（指针移动/聚焦/暂停时恢复）
 * 契约不变：props { src }；新增可选：name?（保存时的文件名）
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{ src: string; name?: string }>(), { name: '视频' })
const store = useChatStore()

const el = ref<HTMLVideoElement | null>(null)
const box = ref<HTMLElement | null>(null)
const playing = ref(false)
const muted = ref(false)
const volume = ref(1)
const current = ref(0)
const duration = ref(0)
const showControls = ref(true)
const error = ref(false)
const fullscreenOn = ref(false)

let hideTimer: ReturnType<typeof setTimeout> | null = null

const progress = computed(() => (duration.value > 0 ? Math.min(100, (current.value / duration.value) * 100) : 0))
const mutedNow = computed(() => muted.value || volume.value === 0)

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec % 60)
  const m = Math.floor(sec / 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function applyAudio(v: HTMLVideoElement): void {
  v.defaultMuted = false
  v.muted = muted.value
  v.volume = muted.value ? 0 : volume.value
}

function clearHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

/** 显示控制条并（播放中）重新开始 3s 倒计时 */
function reveal(): void {
  showControls.value = true
  clearHide()
  if (playing.value && !error.value) hideTimer = setTimeout(() => (showControls.value = false), 3000)
}

function onMeta(): void {
  const v = el.value
  if (!v) return
  duration.value = Number.isFinite(v.duration) ? v.duration : 0
  applyAudio(v)
}

function onTime(): void {
  current.value = el.value?.currentTime ?? 0
}

function onError(): void {
  error.value = true
  playing.value = false
}

function reload(): void {
  error.value = false
  const v = el.value
  if (!v) return
  v.load()
  reveal()
}

function onPointerLeave(): void {
  if (playing.value) {
    clearHide()
    showControls.value = false
  }
}

async function toggle(): Promise<void> {
  const v = el.value
  if (!v) return
  applyAudio(v)
  if (v.paused) {
    try {
      await v.play()
    } catch {
      reveal()
    }
  } else {
    v.pause()
  }
}

function seek(ev: Event): void {
  const v = el.value
  if (!v || !duration.value) return
  const input = ev.target as HTMLInputElement
  v.currentTime = (Number(input.value) / 1000) * duration.value
  current.value = v.currentTime
  reveal()
}

function setVolume(ev: Event): void {
  const input = ev.target as HTMLInputElement
  volume.value = Number(input.value)
  muted.value = volume.value === 0
  if (el.value) applyAudio(el.value)
  reveal()
}

function toggleMute(): void {
  muted.value = !muted.value
  if (!muted.value && volume.value === 0) volume.value = 1
  if (el.value) applyAudio(el.value)
  reveal()
}

async function toggleFullscreen(): Promise<void> {
  const b = box.value
  if (!b) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await b.requestFullscreen()
  } catch {
    /* 全屏不可用时忽略 */
  }
  reveal()
}

function onFullscreenChange(): void {
  fullscreenOn.value = document.fullscreenElement === box.value
  reveal()
}

async function save(): Promise<void> {
  const s = store.session
  const name = props.name || 'video.mp4'
  try {
    if (s?.platform.saveFile) {
      await Promise.resolve(s.platform.saveFile(name, props.src))
      return
    }
    const link = document.createElement('a')
    link.href = props.src
    link.download = name
    link.click()
  } catch (e) {
    console.error('save video failed:', e)
  }
  reveal()
}

watch(
  () => props.src,
  () => {
    playing.value = false
    current.value = 0
    duration.value = 0
    error.value = false
    showControls.value = true
    clearHide()
  },
)

watch(playing, (p) => {
  if (p) reveal()
  else {
    clearHide()
    showControls.value = true
  }
})

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  clearHide()
  el.value?.pause()
})
</script>

<template>
  <div
    ref="box"
    class="player"
    :class="{ playing, 'hide-bar': playing && !showControls, fullscreen: fullscreenOn }"
    role="region"
    aria-label="视频播放器"
    @pointermove="reveal"
    @pointerdown="reveal"
    @pointerleave="onPointerLeave"
    @focusin="reveal"
  >
    <video
      ref="el"
      :src="src"
      class="vid"
      playsinline
      preload="metadata"
      @loadedmetadata="onMeta"
      @durationchange="onMeta"
      @timeupdate="onTime"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @error="onError"
      @click="toggle"
    />

    <!-- 中央播放键（封面态） -->
    <button
      v-if="!playing && !error"
      type="button"
      class="big-play"
      aria-label="播放视频"
      @click.stop="toggle"
    >
      <Icon name="play" :size="22" />
    </button>

    <!-- 出错兜底 -->
    <div v-if="error" class="error-box" role="alert">
      <Icon name="alert" :size="20" />
      <span>无法播放该视频</span>
      <button type="button" class="error-retry" @click="reload">重试</button>
    </div>

    <!-- 控制条 -->
    <div class="controls">
      <button
        type="button"
        class="ctrl main"
        :aria-label="playing ? '暂停' : '播放'"
        :title="playing ? '暂停' : '播放'"
        @click="toggle"
      >
        <Icon :name="playing ? 'pause' : 'play'" :size="18" />
      </button>

      <span class="time">{{ fmt(current) }}</span>

      <div class="seek-wrap">
        <div class="seek-track"><div class="seek-fill" :style="{ width: `${progress}%` }" /></div>
        <input
          class="seek"
          type="range"
          min="0"
          max="1000"
          step="1"
          :value="Math.round(progress * 10)"
          aria-label="播放进度"
          @input="seek"
        />
      </div>

      <span class="time">{{ fmt(duration) }}</span>

      <button
        type="button"
        class="ctrl mute"
        :aria-label="mutedNow ? '取消静音' : '静音'"
        :title="mutedNow ? '取消静音' : '静音'"
        @click="toggleMute"
      >
        <Icon :name="mutedNow ? 'volume-off' : 'volume'" :size="17" />
      </button>
      <input
        class="vol"
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="mutedNow ? 0 : volume"
        aria-label="音量"
        @input="setVolume"
      />

      <button type="button" class="ctrl" title="保存视频" aria-label="保存视频" @click="save">
        <Icon name="save" :size="17" />
      </button>
      <button
        type="button"
        class="ctrl"
        :title="fullscreenOn ? '退出全屏' : '全屏'"
        :aria-label="fullscreenOn ? '退出全屏' : '全屏'"
        @click="toggleFullscreen"
      >
        <Icon name="expand" :size="17" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.player {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--r-md);
  background: var(--media-bg);
  color: var(--media-fg);
  line-height: 0;
}
.vid {
  display: block;
  width: 100%;
  max-height: 300px;
  background: var(--media-bg);
  cursor: pointer;
}

/* 中央播放键 */
.big-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--s-10) + var(--s-2));
  height: calc(var(--s-10) + var(--s-2));
  border-radius: var(--r-full);
  background: var(--media-control-bg);
  color: var(--media-fg);
  border: 1px solid var(--media-track);
  backdrop-filter: blur(4px);
  transition: background var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
  z-index: 2;
}
.big-play:hover {
  background: color-mix(in srgb, var(--media-control-bg) 80%, var(--media-fg));
  transform: translate(-50%, -50%) scale(1.04);
}

/* 错误态 */
.error-box {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: var(--s-4);
  background: var(--media-bg);
  color: var(--media-fg-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  text-align: center;
  z-index: 2;
}
.error-retry {
  min-height: 32px;
  padding: 0 var(--s-4);
  border-radius: var(--r-full);
  border: 1px solid var(--media-track);
  color: var(--media-fg);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.error-retry:hover {
  background: var(--media-control-bg);
}

/* 控制条 */
.controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: var(--s-1) var(--s-2);
  background: var(--media-control-bg);
  backdrop-filter: blur(6px);
  color: var(--media-fg);
  line-height: 1;
  z-index: 3;
  transition: opacity var(--dur-med) var(--ease), visibility var(--dur-med) var(--ease);
}
.hide-bar .controls {
  opacity: 0;
  visibility: hidden;
}
.player:focus-within .controls {
  opacity: 1;
  visibility: visible;
}
.ctrl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--s-10);
  height: var(--s-10);
  flex: none;
  border-radius: var(--r-sm);
  color: var(--media-fg);
  transition: background var(--dur-fast) var(--ease), opacity var(--dur-fast) var(--ease);
}
.ctrl:hover {
  background: color-mix(in srgb, var(--media-fg) 14%, transparent);
}
.time {
  flex: none;
  min-width: 26px;
  text-align: center;
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: var(--media-fg-muted);
  font-variant-numeric: tabular-nums;
}

/* 进度条 */
.seek-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 32px;
  height: var(--s-10);
}
.seek-track {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: var(--r-full);
  background: var(--media-track);
  overflow: hidden;
  pointer-events: none;
}
.seek-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}
.seek {
  position: relative;
  width: 100%;
  height: var(--s-10);
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
}
.seek::-webkit-slider-runnable-track {
  height: 4px;
  background: transparent;
}
.seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4px;
  border-radius: var(--r-full);
  background: var(--media-fg);
  box-shadow: 0 0 0 2px var(--media-control-bg);
}
.seek::-moz-range-track {
  height: 4px;
  background: transparent;
}
.seek::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: none;
  border-radius: var(--r-full);
  background: var(--media-fg);
}

/* 音量：气泡内空间有限，仅全屏时展开滑杆 */
.vol {
  display: none;
  width: 56px;
  flex: none;
  accent-color: var(--accent);
  cursor: pointer;
}

/* 全屏 */
.player.fullscreen,
.player:fullscreen {
  width: 100%;
  height: 100%;
  border-radius: 0;
}
.player.fullscreen .vid,
.player:fullscreen .vid {
  max-height: 100vh;
  height: 100%;
  object-fit: contain;
}

@media (max-width: 719px) {
  .mute,
  .vol {
    display: none;
  }
  .controls {
    gap: 2px;
    padding: 2px var(--s-1);
  }
  .time {
    min-width: 24px;
  }
  .seek-wrap {
    min-width: 20px;
  }
  .big-play {
    width: calc(var(--s-10) + var(--s-3));
    height: calc(var(--s-10) + var(--s-3));
  }
}

/* 全屏空间充足：音量滑杆与静音按钮重新出现 */
.player.fullscreen .vol,
.player:fullscreen .vol {
  display: inline-block;
  width: 56px;
}
.player.fullscreen .mute,
.player:fullscreen .mute {
  display: inline-flex;
}
</style>
