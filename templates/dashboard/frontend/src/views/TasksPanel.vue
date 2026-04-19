<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api/client'
import type { Task, TaskListResponse, TaskFilters, TaskStatus } from '@/types'

const tasks = ref<Task[]>([])
const total = ref(0)
const offset = ref(0)
const limit = ref(20)
const filterDirection = ref('')
const filterStatus = ref<TaskStatus | ''>('')
const loading = ref(true)
const error = ref('')

async function loadTasks() {
  loading.value = true
  error.value = ''
  try {
    const filters: TaskFilters = {
      offset: offset.value,
      limit: limit.value,
    }
    if (filterDirection.value) filters.direction = filterDirection.value
    if (filterStatus.value) filters.status = filterStatus.value
    const res: TaskListResponse = await api.getTasks(filters)
    tasks.value = res.tasks
    total.value = res.total
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}

function prevPage() {
  if (offset.value > 0) {
    offset.value = Math.max(0, offset.value - limit.value)
    loadTasks()
  }
}

function nextPage() {
  if (offset.value + limit.value < total.value) {
    offset.value += limit.value
    loadTasks()
  }
}

function applyFilters() {
  offset.value = 0
  loadTasks()
}

function statusClass(status: string): string {
  return 'status-badge status-' + status.replace(/_/g, '-')
}

onMounted(loadTasks)
</script>

<template>
  <div class="panel">
    <h2 class="panel-title">任务</h2>

    <!-- Filters -->
    <div class="filters card">
      <input
        v-model="filterDirection"
        placeholder="Filter by direction..."
        class="filter-input"
        @keydown.enter="applyFilters"
      />
      <select v-model="filterStatus" class="filter-select" @change="applyFilters">
        <option value="">All statuses</option>
        <option value="pending">Pending</option>
        <option value="in_progress">In Progress</option>
        <option value="completed">Completed</option>
        <option value="blocked">Blocked</option>
      </select>
      <button class="filter-btn" @click="applyFilters">Filter</button>
    </div>

    <div v-if="loading" class="loading-state">Loading...</div>
    <div v-else-if="error" class="error-state">{{ error }}</div>

    <template v-else>
      <div class="task-count">{{ total }} tasks found</div>

      <div class="task-list">
        <div v-for="task in tasks" :key="task.id" class="card task-card">
          <div class="task-header">
            <span class="task-id">{{ task.id }}</span>
            <span :class="statusClass(task.computed_status)">{{ task.computed_status }}</span>
          </div>
          <h4 class="task-title">{{ task.title }}</h4>
          <div class="task-meta">
            <span>Module: {{ task.module }}</span>
            <span>Direction: {{ task.direction }}</span>
            <span>Progress: {{ task.computed_progress.toFixed(0) }}%</span>
          </div>
          <p v-if="task.hypothesis" class="task-hypothesis">{{ task.hypothesis }}</p>
        </div>
      </div>

      <!-- Pagination -->
      <div class="pagination">
        <button :disabled="offset === 0" @click="prevPage" class="page-btn">Previous</button>
        <span class="page-info">{{ offset + 1 }}-{{ Math.min(offset + limit, total) }} of {{ total }}</span>
        <button :disabled="offset + limit >= total" @click="nextPage" class="page-btn">Next</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel {
  max-width: 960px;
}

.panel-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 20px;
}

.loading-state,
.error-state {
  padding: 32px;
  text-align: center;
}

.error-state {
  color: #c0392b;
}

.card {
  background: var(--color-card-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px var(--color-card-shadow);
}

.filters {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-input {
  flex: 1;
  min-width: 160px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  background: var(--color-bg);
}

.filter-select {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  background: var(--color-bg);
}

.filter-btn {
  padding: 8px 20px;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
}

.filter-btn:hover {
  opacity: 0.9;
}

.task-count {
  font-size: 14px;
  opacity: 0.6;
  margin-bottom: 12px;
}

.task-card {
  transition: box-shadow 0.15s;
}

.task-card:hover {
  box-shadow: 0 2px 8px var(--color-card-shadow);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.task-id {
  font-size: 12px;
  font-family: monospace;
  opacity: 0.6;
}

.status-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 12px;
  text-transform: uppercase;
}

.status-pending { background: var(--color-border); color: var(--color-text); }
.status-in-progress { background: #FFF3CD; color: #856404; }
.status-completed { background: #D4EDDA; color: #155724; }
.status-blocked { background: #F8D7DA; color: #721C24; }

.task-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}

.task-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  opacity: 0.7;
  flex-wrap: wrap;
}

.task-hypothesis {
  margin-top: 8px;
  font-size: 14px;
  font-style: italic;
  opacity: 0.8;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 16px;
}

.page-btn {
  padding: 6px 16px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 14px;
  opacity: 0.7;
}
</style>
