<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status: string
}>()

const statusConfig = computed(() => {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    pending:     { label: '待开始', bg: '#e5e1dc', fg: '#6b5b4e' },
    in_progress: { label: '进行中', bg: '#fef0d5', fg: '#b8860b' },
    completed:   { label: '已完成', bg: '#d4edda', fg: '#2d6a4f' },
    blocked:     { label: '已阻塞', bg: '#f8d7da', fg: '#a4262c' },
    skipped:     { label: '已跳过', bg: '#e2e3e5', fg: '#6c757d' },
  }
  return map[props.status] ?? { label: props.status, bg: '#e5e1dc', fg: '#6b5b4e' }
})
</script>

<template>
  <span
    class="status-badge"
    :style="{
      backgroundColor: statusConfig.bg,
      color: statusConfig.fg,
    }"
  >
    {{ statusConfig.label }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  line-height: 1.6;
}
</style>
