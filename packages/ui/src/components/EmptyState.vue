<script setup lang="ts">
/**
 * 通用空状态：图标 44px + 标题 15px/600 + 说明 13px + 可选默认插槽按钮。
 * 契约不变：icon 可选（默认 chat）、title 必填、hint 可选。
 */
import Icon, { type IconName } from './Icon.vue'

withDefaults(
  defineProps<{
    icon?: IconName
    title: string
    hint?: string
  }>(),
  { icon: 'chat' },
)
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon"><Icon :name="icon" :size="44" :stroke-width="1.4" /></div>
    <p class="empty-title">{{ title }}</p>
    <p v-if="hint" class="empty-desc">{{ hint }}</p>
    <div v-if="$slots.default" class="empty-action"><slot /></div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: var(--s-8) var(--s-5);
  text-align: center;
  color: var(--text-muted);
}
.empty-icon {
  color: var(--text-faint);
  margin-bottom: var(--s-1);
}
.empty-title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-base);
  color: var(--text);
}
.empty-desc {
  margin: 0;
  max-width: 34ch;
  font-size: 13px;
  line-height: var(--lh-base);
  color: var(--text-muted);
}
.empty-action {
  margin-top: var(--s-3);
}
</style>
