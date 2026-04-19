<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api/client'

const projectName = ref('Thoth')
const healthy = ref<boolean | null>(null)
const refreshing = ref(false)

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

async function loadConfig() {
  try {
    const cfg = await api.getConfig()
    projectName.value = cfg.project?.name ?? 'Thoth'
  } catch {
    /* keep default */
  }
}

async function checkHealth() {
  try {
    const status = await api.getSystemStatus()
    healthy.value = status.task_count >= 0
  } catch {
    healthy.value = false
  }
}

async function handleRefresh() {
  refreshing.value = true
  emit('refresh')
  await checkHealth()
  refreshing.value = false
}

onMounted(() => {
  loadConfig()
  checkHealth()
})
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <h1 class="project-name">{{ projectName }}</h1>
      <span class="subtitle">Research Dashboard</span>
    </div>
    <div class="header-right">
      <span
        class="health-dot"
        :class="{
          'health-ok': healthy === true,
          'health-err': healthy === false,
          'health-unknown': healthy === null,
        }"
        :title="healthy === true ? '系统正常' : healthy === false ? '系统异常' : '检查中...'"
      />
      <button
        class="refresh-btn"
        :disabled="refreshing"
        :class="{ spinning: refreshing }"
        title="刷新数据"
        @click="handleRefresh"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: var(--bg-card, #ffffff);
  border-bottom: 1px solid var(--border, #e8e0d6);
  box-shadow: 0 1px 3px rgba(44, 24, 16, 0.04);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.project-name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary, #2C1810);
}

.subtitle {
  font-size: 13px;
  color: var(--text-secondary, #6b5b4e);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.health-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.health-ok     { background: #2d6a4f; box-shadow: 0 0 0 3px rgba(45,106,79,0.2); }
.health-err    { background: #a4262c; box-shadow: 0 0 0 3px rgba(164,38,44,0.2); }
.health-unknown { background: #ccc; }

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #6b5b4e);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.refresh-btn:hover {
  background: var(--bg-secondary, #f0ebe4);
  color: var(--accent, #CC8B3A);
}
.refresh-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.refresh-btn.spinning svg {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
