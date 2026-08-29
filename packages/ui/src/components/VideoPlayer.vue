<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{ src: string }>()

const el = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
const muted = ref(false)
const volume = ref(1)
const current = ref(0)
const duration = ref(0)
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

function onMeta(): void {
  const v = el.value
  if (!v) return
  duration.value = v.duration || 0
  applyAudio(v)
}

function onTime(): void {
  current.value = el.value?.currentTime ?? 0
}

async function toggle(): Promise<void> {
  const v = el.value
  if (!v) return
  applyAudio(v)
  if (v.paused) {
    try {
      await v.play()
    } catch {
      muted.value = false
      applyAudio(v)
      await v.play().catch(() => {})
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
}

function setVolume(ev: Event): void {
  const v = el.value
  const input = ev.target as HTMLInputElement
  volume.value = Number(input.value)
  muted.value = volume.value === 0
  if (v) applyAudio(v)
}

function toggleMute(): void {
  muted.value = !muted.value
  if (!muted.value && volume.value === 0) volume.value = 1
  if (el.value) applyAudio(el.value)
}

async function fullscreen(): Promise<void> {
  const box = el.value?.parentElement
  if (!box) return
  if (document.fullscreenElement) await document.exitFullscreen()
  else await box.requestFullscreen().catch(() => {})
}

watch(
  () => props.src,
  () => {
    playing.value = false
    current.value = 0
    duration.value = 0
  },
)

onBeforeUnmount(() => el.value?.pause())
</script>

<template>
  <div class="player" @click.stop>
    <video
      ref="el"
      :src="src"
      playsinline
      preload="auto"
      class="vid"
      @loadedmetadata="onMeta"
      @timeupdate="onTime"
      @play="playing = true"
      @pause="playing = false"
      @click="toggle"
    />
    <div class="bar">
      <button type="button" class="t" @click="toggle">
        <Icon :name="playing ? 'pause' : 'play'" :size="14" />
      </button>
      <span class="tm">{{ fmt(current) }}</span>
      <input
        class="seek"
        type="range"
        min="0"
        max="1000"
        :value="duration ? Math.round((current / duration) * 1000) : 0"
        @input="seek"
      />
      <span class="tm">{{ fmt(duration) }}</span>
      <div class="vol">
        <button type="button" class="t" @click="toggleMute">
          <Icon :name="muted || volume === 0 ? 'volume-off' : 'volume'" :size="15" />
        </button>
        <input
          class="vslider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="muted ? 0 : volume"
          @input="setVolume"
        />
      </div>
      <button type="button" class="t fs" title="全屏" @click="fullscreen">⛶</button>
    </div>
  </div>
</template>

<style scoped>
.player {
  position: relative;
  width: min(360px, 60vw);
  background: #1c1915;
  border-radius: 6px;
  overflow: hidden;
}
.vid {
  display: block;
  width: 100%;
  max-height: 300px;
  background: #1c1915;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 8px;
  background: #2a2620;
  color: #f4efe6;
}
.t {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f4efe6;
  padding: 0;
  flex: none;
}
.tm {
  font-size: 11px;
  color: #c4b8a8;
  flex: none;
  min-width: 28px;
}
.seek {
  flex: 1;
  min-width: 0;
  accent-color: #d35400;
}
.vol {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.vslider {
  width: 64px;
  accent-color: #d35400;
}
.fs {
  font-size: 13px;
}
</style>
