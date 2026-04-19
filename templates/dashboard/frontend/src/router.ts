import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/overview',
  },
  {
    path: '/overview',
    name: 'overview',
    component: () => import('@/views/OverviewPanel.vue'),
    meta: { title: '总览', icon: 'overview' },
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('@/views/TasksPanel.vue'),
    meta: { title: '任务', icon: 'tasks' },
  },
  {
    path: '/milestones',
    name: 'milestones',
    component: () => import('@/views/MilestonesPanel.vue'),
    meta: { title: '里程碑', icon: 'milestones' },
  },
  {
    path: '/dag',
    name: 'dag',
    component: () => import('@/views/DagPanel.vue'),
    meta: { title: '依赖图', icon: 'dag' },
  },
  {
    path: '/timeline',
    name: 'timeline',
    component: () => import('@/views/TimelinePanel.vue'),
    meta: { title: '时间线', icon: 'timeline' },
  },
  {
    path: '/todo',
    name: 'todo',
    component: () => import('@/views/TodoPanel.vue'),
    meta: { title: '待办', icon: 'todo' },
  },
  {
    path: '/activity',
    name: 'activity',
    component: () => import('@/views/ActivityPanel.vue'),
    meta: { title: '活动', icon: 'activity' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
