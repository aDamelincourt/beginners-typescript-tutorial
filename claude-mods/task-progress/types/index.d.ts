export type TaskProgressStep = {
  id: string
  subject: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type TaskProgressPlan = {
  steps: TaskProgressStep[]
  startedAt: number
  finishedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { plan: TaskProgressPlan | null; now: number }
  }
}
