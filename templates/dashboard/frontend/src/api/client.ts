/* Thoth Dashboard — API client */

import type {
  ResearchConfig,
  ProgressData,
  TaskListResponse,
  Task,
  DagData,
  TimelineItem,
  Milestone,
  ActivityEvent,
  TodoProject,
  TaskFilters,
  SystemStatus,
} from '@/types/index'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || body.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  /* ── Config & Status ─────────────────────── */
  getConfig: () => request<ResearchConfig>('/config'),
  getSystemStatus: () => request<SystemStatus>('/status'),

  /* ── Progress ────────────────────────────── */
  getProgress: () => request<ProgressData>('/progress'),

  /* ── Tasks ───────────────────────────────── */
  getTasks: (filters?: TaskFilters) => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.module) params.set('module', filters.module)
    if (filters?.direction) params.set('direction', filters.direction)
    if (filters?.limit) params.set('limit', String(filters.limit))
    if (filters?.offset) params.set('offset', String(filters.offset))
    const qs = params.toString()
    return request<TaskListResponse>(`/tasks${qs ? `?${qs}` : ''}`)
  },
  getTask: (id: string) => request<Task>(`/tasks/${id}`),

  /* ── DAG ─────────────────────────────────── */
  getDag: () => request<DagData>('/dag'),

  /* ── Timeline ────────────────────────────── */
  getTimeline: () => request<TimelineItem[]>('/timeline'),

  /* ── Milestones ──────────────────────────── */
  getMilestones: () => request<Milestone[]>('/milestones'),

  /* ── Activity ────────────────────────────── */
  getActivity: (limit = 20) =>
    request<ActivityEvent[]>(`/activity?limit=${limit}`),

  /* ── Todo ─────────────────────────────────── */
  getTodo: () => request<TodoProject[]>('/todo'),
  addTodoProject: (name: string) =>
    request<{ id: number; name: string }>('/todo/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  addTodoTask: (projectId: number, description: string, dueDate?: string) =>
    request<{ id: number; project_id: number; description: string }>(
      '/todo/tasks',
      {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          description,
          due_date: dueDate ?? null,
        }),
      },
    ),
  updateTodoTask: (
    taskId: number,
    patch: { completed?: boolean; description?: string; due_date?: string },
  ) =>
    request<{ id: number; updated: boolean }>(`/todo/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /* ── Triggers ────────────────────────────── */
  triggerValidate: () =>
    request<Record<string, unknown>>('/trigger/validate', { method: 'POST' }),
  triggerSync: () =>
    request<Record<string, unknown>>('/trigger/sync', { method: 'POST' }),
  triggerHealthCheck: () =>
    request<Record<string, unknown>>('/trigger/health-check', {
      method: 'POST',
    }),
}
