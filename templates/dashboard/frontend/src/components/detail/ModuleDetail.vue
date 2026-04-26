<script setup lang="ts">
import { useDashboardStore } from '@/stores/dashboard'

const store = useDashboardStore()

function openTask(taskId: string) {
  void store.selectTask(taskId)
}
</script>

<template>
  <section v-if="store.selectedModule" class="module-detail">
    <article class="card module-detail__hero">
      <h2>{{ store.selectedModule.id }} · {{ store.selectedModule.name }}</h2>
      <p>{{ store.selectedModule.scientific_question || 'No module summary yet.' }}</p>
      <div class="module-detail__meta">
        <span>tasks: {{ store.selectedModule.task_count }}</span>
        <span>progress: {{ Math.round(store.selectedModule.progress) }}%</span>
      </div>
    </article>

    <article class="card module-detail__tasks">
      <h3>Tasks</h3>
      <button
        v-for="task in store.selectedModule.tasks"
        :key="task.id"
        class="module-detail__task"
        @click="openTask(task.id)"
      >
        <strong>{{ task.id }}</strong>
        <span>{{ task.title }}</span>
        <em>{{ task.status }}</em>
      </button>
    </article>
  </section>
</template>

<style scoped>
.module-detail {
  display: grid;
  gap: 14px;
}

.module-detail__hero,
.module-detail__tasks {
  padding: 18px;
}

.module-detail__hero p {
  margin-top: 8px;
  color: var(--text-secondary);
}

.module-detail__meta {
  display: flex;
  gap: 12px;
  margin-top: 10px;
  color: var(--text-muted);
}

.module-detail__tasks {
  display: grid;
  gap: 8px;
}

.module-detail__task {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: rgba(243, 236, 223, 0.55);
  text-align: left;
}

.module-detail__task strong {
  font-family: var(--font-mono);
  color: var(--accent-primary);
}

.module-detail__task em {
  color: var(--text-muted);
  font-style: normal;
}
</style>
