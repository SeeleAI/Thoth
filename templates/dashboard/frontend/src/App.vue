<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()

const sidebarCollapsed = ref(false)

interface NavItem {
  key: string
  label: string
  icon: string
  path: string
}

const navItems: NavItem[] = [
  { key: 'overview',   label: '总览',   icon: '\u{1F4CA}', path: '/overview' },
  { key: 'tasks',      label: '任务',   icon: '\u{1F4CB}', path: '/tasks' },
  { key: 'milestones', label: '里程碑', icon: '\u{1F3AF}', path: '/milestones' },
  { key: 'dag',        label: '依赖图', icon: '\u{1F578}', path: '/dag' },
  { key: 'timeline',   label: '时间线', icon: '\u{23F3}',  path: '/timeline' },
  { key: 'todo',       label: '待办',   icon: '\u{2705}',  path: '/todo' },
  { key: 'activity',   label: '活动',   icon: '\u{1F514}', path: '/activity' },
]

const activeKey = computed(() => {
  const name = route.name as string | undefined
  return name ?? 'overview'
})

function navigate(item: NavItem) {
  router.push(item.path)
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

onMounted(() => {
  appStore.fetchConfig()
})
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-header">
        <h1 v-if="!sidebarCollapsed" class="brand-title">Thoth</h1>
        <button class="toggle-btn" @click="toggleSidebar" :title="sidebarCollapsed ? 'Expand' : 'Collapse'">
          <span v-if="sidebarCollapsed">&#x25B6;</span>
          <span v-else>&#x25C0;</span>
        </button>
      </div>

      <nav class="sidebar-nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: activeKey === item.key }"
          @click="navigate(item)"
          :title="item.label"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span v-if="!sidebarCollapsed" class="nav-label">{{ item.label }}</span>
        </button>
      </nav>

      <div v-if="!sidebarCollapsed" class="sidebar-footer">
        <span class="footer-text">Research Dashboard</span>
      </div>
    </aside>

    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<style>
/* ---- CSS Custom Properties (Warm-Bear Theme) ---- */
:root {
  --color-bg: #FEF9F4;
  --color-text: #2C1810;
  --color-accent: #CC8B3A;
  --color-secondary: #8BA870;
  --color-border: #E8DED4;
  --color-sidebar-bg: #2C1810;
  --color-sidebar-text: #FEF9F4;
  --color-sidebar-hover: rgba(204, 139, 58, 0.2);
  --color-sidebar-active: rgba(204, 139, 58, 0.35);
  --color-card-bg: #FFFFFF;
  --color-card-shadow: rgba(44, 24, 16, 0.08);

  --sidebar-width: 220px;
  --sidebar-collapsed-width: 56px;
  --transition-speed: 0.25s;
}

/* ---- Reset ---- */
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, 'Noto Sans SC', sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
}

#app {
  height: 100%;
}
</style>

<style scoped>
/* ---- Layout ---- */
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ---- Sidebar ---- */
.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--color-sidebar-bg);
  color: var(--color-sidebar-text);
  display: flex;
  flex-direction: column;
  transition: width var(--transition-speed) ease,
              min-width var(--transition-speed) ease;
  overflow: hidden;
}

.sidebar.collapsed {
  width: var(--sidebar-collapsed-width);
  min-width: var(--sidebar-collapsed-width);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 12px;
  border-bottom: 1px solid rgba(254, 249, 244, 0.1);
}

.brand-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--color-accent);
  white-space: nowrap;
}

.toggle-btn {
  background: none;
  border: none;
  color: var(--color-sidebar-text);
  cursor: pointer;
  font-size: 14px;
  padding: 4px 6px;
  border-radius: 4px;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.toggle-btn:hover {
  opacity: 1;
}

/* ---- Navigation ---- */
.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 8px 0;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: none;
  border: none;
  color: var(--color-sidebar-text);
  font-size: 15px;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: background var(--transition-speed);
  border-left: 3px solid transparent;
}

.nav-item:hover {
  background: var(--color-sidebar-hover);
}

.nav-item.active {
  background: var(--color-sidebar-active);
  border-left-color: var(--color-accent);
}

.nav-icon {
  font-size: 18px;
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}

.nav-label {
  font-weight: 500;
}

/* ---- Sidebar Footer ---- */
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(254, 249, 244, 0.1);
}

.footer-text {
  font-size: 11px;
  opacity: 0.5;
  white-space: nowrap;
}

/* ---- Main Content ---- */
.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

/* ---- Responsive ---- */
@media (max-width: 768px) {
  .sidebar {
    width: var(--sidebar-collapsed-width);
    min-width: var(--sidebar-collapsed-width);
  }

  .brand-title,
  .nav-label,
  .sidebar-footer {
    display: none;
  }

  .main-content {
    padding: 16px;
  }
}
</style>
