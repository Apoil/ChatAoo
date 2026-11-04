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

function reset(): void {
  if (!cropper || !ready.value) return
  cropper.reset()
  error.value = ''
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
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

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      try {
        const data = canvas.toDataURL('image/png')
        void fetch(data)
          .then((r) => r.blob())
          .then(resolve)
          .catch(reject)
      } catch (e) {
        reject(e)
      }
    }, 'image/png')
  })
}

async function confirm(): Promise<void> {
  if (!cropper || busy.value || !ready.value) return
  busy.value = true
  error.value = ''
  try {
    const canvas = cropper.getCroppedCanvas({ width: 512, height: 512 })
    const blob = await canvasToBlob(canvas)
    emit('cropped', blob)
  } catch (e) {
    error.value = `裁剪失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  cropper?.destroy()
  cropper = null
})
</script>

<template>
  <div
    class="avatar-crop-modal"
    role="dialog"
    aria-modal="true"
    :aria-label="title ?? '裁剪图片'"
    @click.self="emit('close')"
  >
    <div class="avatar-crop-card">
      <h3>{{ title ?? '裁剪图片' }}</h3>
      <div class="img-box">
        <img ref="imgEl" :src="src" alt="" draggable="false" />
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button class="btn btn-subtle" type="button" :disabled="!ready" @click="reset">重置</button>
        <span class="spacer" />
        <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
        <button class="btn btn-primary" type="button" :disabled="busy || !ready" @click="confirm">
          {{ busy ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 复用全局 .avatar-crop-modal / .avatar-crop-card，仅按 §4 收紧裁剪卡尺寸 */
.avatar-crop-card {
  max-width: var(--dialog-w);
}
/* button 不继承 body 行高，中文文案统一按 1.5 行高 */
.avatar-crop-card button {
  line-height: var(--lh-base);
}
h3 {
  margin: 0 0 var(--s-3);
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-tight);
}
.img-box {
  /* 320×320 裁剪视窗，窄屏时等比缩小 */
  width: min(var(--crop-size), 100%);
  aspect-ratio: 1;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.img-box img {
  max-width: 100%;
  max-height: 100%;
  display: block;
}
.error {
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  margin: var(--s-2) 0 0;
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-top: var(--s-4);
}
.spacer {
  flex: 1;
}
@media (max-width: 719.98px) {
  .actions {
    flex-wrap: wrap;
  }
  .actions .btn {
    min-height: var(--touch);
  }
}
</style>
