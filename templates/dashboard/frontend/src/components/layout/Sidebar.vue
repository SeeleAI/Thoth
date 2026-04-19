<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

interface NavItem {
  key: string
  label: string
  icon: string
  path: string
}

const navItems: NavItem[] = [
  { key: 'overview',   label: '总览',   icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',                                          path: '/overview' },
  { key: 'tasks',      label: '任务',   icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-6h8v2H8v-2zm0-4h8v2H8v-2z', path: '/tasks' },
  { key: 'milestones', label: '里程碑', icon: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z',                                                                path: '/milestones' },
  { key: 'dag',        label: '依赖图', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z', path: '/dag' },
  { key: 'timeline',   label: '时间线', icon: 'M23 8c0 1.1-.9 2-2 2-.18 0-.35-.02-.51-.07l-3.56 3.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52l-2.55-2.55c-.16.05-.34.07-.52.07s-.36-.02-.52-.07l-4.55 4.56c.05.16.07.33.07.51 0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.18 0 .35.02.51.07l4.56-4.55C8.02 9.36 8 9.18 8 9c0-1.1.9-2 2-2s2 .9 2 2c0 .18-.02.36-.07.52l2.55 2.55c.16-.05.34-.07.52-.07s.36.02.52.07l3.55-3.56C19.02 8.35 19 8.18 19 8c0-1.1.9-2 2-2s2 .9 2 2z', path: '/timeline' },
  { key: 'todo',       label: '待办',   icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z', path: '/todo' },
  { key: 'activity',   label: '活动',   icon: 'M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z', path: '/activity' },
]

const activeKey = computed(() => {
  const name = route.name as string | undefined
  if (name) return name
  const p = route.path
  const match = navItems.find(n => p.startsWith(n.path))
  return match?.key ?? 'overview'
})

function navigate(item: NavItem) {
  router.push(item.path)
}
</script>

<template>
  <nav class="sidebar">
    <ul class="nav-list">
      <li
        v-for="item in navItems"
        :key="item.key"
        class="nav-item"
        :class="{ active: activeKey === item.key }"
        @click="navigate(item)"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" width="20" height="20">
          <path :d="item.icon" fill="currentColor" />
        </svg>
        <span class="nav-label">{{ item.label }}</span>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.sidebar {
  width: 180px;
  min-width: 180px;
  background: var(--bg-card, #ffffff);
  border-right: 1px solid var(--border, #e8e0d6);
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  cursor: pointer;
  color: var(--text-secondary, #6b5b4e);
  border-radius: 0;
  transition: background 0.15s, color 0.15s;
  position: relative;
  user-select: none;
}

.nav-item:hover {
  background: var(--bg-secondary, #f0ebe4);
  color: var(--text-primary, #2C1810);
}

.nav-item.active {
  color: var(--accent, #CC8B3A);
  background: rgba(204, 139, 58, 0.08);
  font-weight: 600;
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--accent, #CC8B3A);
}

.nav-icon {
  flex-shrink: 0;
}

.nav-label {
  font-size: 14px;
  white-space: nowrap;
}
</style>
