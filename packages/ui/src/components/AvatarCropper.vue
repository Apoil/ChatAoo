<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'

const props = defineProps<{
  src: string
  aspect?: number
  title?: string
}>()

const emit = defineEmits<{ close: []; cropped: [blob: Blob] }>()

const box = ref<HTMLDivElement | null>(null)
const img = ref<HTMLImageElement | null>(null)
const busy = ref(false)
let cropper: Cropper | null = null

nextTick(() => {
  if (!img.value) return
  cropper = new Cropper(img.value, {
    aspectRatio: props.aspect ?? 1,
    viewMode: 1,
    autoCropArea: 0.85,
    movable: true,
    zoomable: true,
    rotatable: false,
    scalable: false,
    background: false,
  })
})

function confirm(): void {
  if (!cropper || busy.value) return
  busy.value = true
  const canvas = cropper.getCroppedCanvas({ width: 512, height: 512 })
  canvas.toBlob((blob) => {
    busy.value = false
    if (blob) emit('cropped', blob)
  }, 'image/png')
}

onBeforeUnmount(() => {
  cropper?.destroy()
  cropper = null
})
</script>

<template>
  <div class="cropper-modal" @click.self="emit('close')">
    <div class="cropper-card">
      <h3>{{ title ?? '裁剪图片' }}</h3>
      <div ref="box" class="img-box">
        <img ref="img" :src="src" alt="" />
      </div>
      <div class="actions">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="busy" @click="confirm">{{ busy ? '处理中…' : '确定' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
</style>
