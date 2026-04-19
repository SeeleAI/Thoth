/* Thoth Dashboard — shared TypeScript types */

// ─── Task & Phase ───────────────────────────────────────────

export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'

export interface PhaseCriteria {
  metric: string
  threshold: number
  current: number | null
}

export interface PhaseInfo {
  status: PhaseStatus
  criteria?: PhaseCriteria
  started_at?: string
  completed_at?: string
}

export interface Phases {
  survey: PhaseInfo
  method_design: PhaseInfo
  experiment: PhaseInfo
  conclusion: PhaseInfo
}

export interface Dependency {
  task_id: string
  type: 'hard' | 'soft'
  reason?: string
}

export interface Deliverable {
  path: string
  type: 'report' | 'model' | 'checkpoint' | 'data' | 'script' | 'config'
  description: string
}

export interface Task {
  id: string
  title: string
  type?: string
  direction: string
  module: string
  hypothesis?: string
  phases?: Phases
  depends_on?: Dependency[]
  deliverables?: Deliverable[]
  created_at?: string
  estimated_total_hours?: number
  time_spent_hours?: number
  computed_status: TaskStatus
  computed_progress: number
}

export interface TaskListResponse {
  total: number
  offset: number
  limit: number
  tasks: Task[]
}

// ─── Module & Direction ─────────────────────────────────────

export interface ModuleNode {
  id: string
  name: string
  scientific_question?: string
  task_count: number
  progress: number
  tasks: TaskNode[]
  upstream: string[]
  downstream: string[]
}

export interface TaskNode {
  id: string
  title: string
  type: string
  status: TaskStatus
  progress: number
  hypothesis?: string
  phases: Record<string, { status: PhaseStatus; criteria?: PhaseCriteria }>
}

export interface DirectionNode {
  direction: string
  label: string
  module_count: number
  progress: number
  modules: ModuleNode[]
}

// ─── Progress ───────────────────────────────────────────────

export interface BlockedTask {
  id: string
  title: string
  blocked_by: string[]
}

export interface Estimation {
  total_tasks: number
  completed_tasks: number
  elapsed_days: number
  rate_per_day?: number
  estimated_days_remaining: number | null
  message?: string
}

export interface ProgressData {
  overall_progress: number
  by_direction: Record<string, number>
  status_counts: {
    total: number
    pending: number
    in_progress: number
    completed: number
    blocked: number
  }
  blocked_tasks: BlockedTask[]
  module_count: number
  estimation: Estimation | null
}

// ─── DAG ────────────────────────────────────────────────────

export interface DagNode {
  id: string
  label: string
  type: 'module' | 'task'
  direction: string
  module?: string
  status?: TaskStatus
  progress: number
  task_count?: number
}

export interface DagEdge {
  source: string
  target: string
  type: 'hard' | 'soft'
  level: 'module' | 'task'
  reason?: string
}

export interface DagData {
  nodes: DagNode[]
  edges: DagEdge[]
}

// ─── Timeline ───────────────────────────────────────────────

export interface TimelineItem {
  id: string
  title: string
  module: string
  direction: string
  status: TaskStatus
  progress: number
  start_date: string | null
  end_date: string | null
  estimated_hours: number
  spent_hours: number
}

// ─── Milestones ─────────────────────────────────────────────

export interface Milestone {
  id: string
  name: string
  description: string
  progress: number
  task_count: number
}

// ─── Activity ───────────────────────────────────────────────

export interface ActivityEvent {
  id: number
  task_id: string
  task_title: string
  module: string
  direction: string
  verdict: string
  conclusion_text: string | null
  created_at: string
}

// ─── Todo ───────────────────────────────────────────────────

export interface TodoTask {
  id: number
  project_id: number
  description: string
  due_label: string | null
  due_date: string | null
  completed: number
  completed_at: string | null
  created_at: string
}

export interface TodoProject {
  id: number
  name: string
  created_at: string
  tasks: TodoTask[]
}

// ─── System ─────────────────────────────────────────────────

export interface SystemStatus {
  last_updated: number
  task_count: number
  module_count: number
  cache_info: Record<string, unknown>
}

export interface ResearchConfig {
  project?: { name?: string }
  research?: { directions?: { id: string; label_en?: string }[] }
  [key: string]: unknown
}

// ─── Filters ────────────────────────────────────────────────

export interface TaskFilters {
  status?: TaskStatus | ''
  module?: string
  direction?: string
  limit?: number
  offset?: number
}
