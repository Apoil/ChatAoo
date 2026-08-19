<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'

const props = defineProps<{
  src: string
  aspect?: number
  title?: string
}>()

const emit = defineEmits<{ close: []; cropped: [blob: Blob] }>()

const imgEl = ref<HTMLImageElement | null>(null)
const busy = ref(false)
const ready = ref(false)
const error = ref('')

let cropper: Cropper | null = null

function initCropper(): void {
  const el = imgEl.value
  if (!el) return
  try {
    cropper = new Cropper(el, {
      aspectRatio: props.aspect ?? 1,
      viewMode: 1,
      autoCropArea: 0.85,
      movable: true,
      zoomable: true,
      rotatable: false,
      scalable: false,
      background: false,
      ready: () => {
        ready.value = true
      },
    })
  } catch (e) {
    error.value = `裁剪器初始化失败：${e instanceof Error ? e.message : String(e)}`
  }
}

onMounted(() => {
  const el = imgEl.value
  if (!el) return
  if (el.complete && el.naturalWidth > 0) {
    initCropper()
  } else {
    el.addEventListener('load', initCropper, { once: true })
    el.addEventListener('error', () => {
      error.value = '图片加载失败'
    })
  }
})

function confirm(): void {
  if (!cropper || busy.value || !ready.value) return
  busy.value = true
  error.value = ''
  try {
    const canvas = cropper.getCroppedCanvas({ width: 512, height: 512 })
    canvas.toBlob((blob) => {
      busy.value = false
      if (blob) emit('cropped', blob)
      else error.value = '生成图片失败，请重试'
    }, 'image/png')
  } catch (e) {
    busy.value = false
    error.value = `裁剪失败：${e instanceof Error ? e.message : String(e)}`
  }
}

onBeforeUnmount(() => {
  cropper?.destroy()
  cropper = null
})
</script>

<template>
  <div class="avatar-crop-modal" @click.self="emit('close')">
    <div class="avatar-crop-card">
      <h3>{{ title ?? '裁剪图片' }}</h3>
      <div class="img-box">
        <img ref="imgEl" :src="src" alt="" draggable="false" />
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="actions">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="busy || !ready" @click="confirm">
          {{ busy ? '处理中…' : '确定' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.img-box {
  max-height: 420px;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  /* cropper 需要容器有确定尺寸，避免图片未加载完成时塌陷 */
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.img-box img {
  max-width: 100%;
  max-height: 420px;
  display: block;
}
.error {
  color: var(--danger);
  font-size: 12.5px;
  margin: 10px 0 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
</style>
