import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TaskProgressPlan, TaskProgressStep } from '../types'

const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, null as TaskProgressPlan | null)
const now = atom({ plugin: 'task-progress', key: 'now' } as const, 0)

type Status = TaskProgressStep['status']

// Pure plan arithmetic, exported for the tests.

const isFinished = (steps: readonly TaskProgressStep[]) =>
  steps.length > 0 && steps.every(step => step.status === 'completed')

export function settle(previous: TaskProgressPlan | null, steps: TaskProgressStep[], at: number): TaskProgressPlan {
  // A list that was finished, or empty, starts a new task and a new clock.
  const startedAt =
    previous === null || previous.steps.length === 0 || previous.finishedAt !== null ? at : previous.startedAt
  const finishedAt = isFinished(steps) ? (previous?.finishedAt ?? at) : null
  return { steps, startedAt, finishedAt }
}

export function addStep(previous: TaskProgressPlan | null, step: TaskProgressStep, at: number): TaskProgressPlan {
  const kept = previous === null || previous.finishedAt !== null ? [] : previous.steps
  return settle(previous, [...kept, step], at)
}

export function changeStep(
  previous: TaskProgressPlan | null,
  id: string,
  change: { subject?: string; activeForm?: string; status?: Status | 'deleted' },
  at: number,
): TaskProgressPlan | null {
  if (previous === null) return null
  const { status } = change
  const steps: TaskProgressStep[] =
    status === 'deleted'
      ? previous.steps.filter(step => step.id !== id)
      : previous.steps.map(step =>
          step.id !== id
            ? step
            : {
                ...step,
                ...(change.subject !== undefined && { subject: change.subject }),
                ...(change.activeForm !== undefined && { activeForm: change.activeForm }),
                ...(status !== undefined && { status }),
              },
        )
  return settle({ ...previous, finishedAt: isFinished(steps) ? previous.finishedAt : null }, steps, at)
}

export function bar(done: number, total: number, width: number): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m ${rest}s`
    : `${minutes}m ${rest}s`
}

export function current(steps: readonly TaskProgressStep[]): { index: number; label: string } | undefined {
  const index = steps.findIndex(step => step.status === 'in_progress')
  const at = index >= 0 ? index : steps.findIndex(step => step.status === 'pending')
  const step = steps[at]
  if (step === undefined) return undefined
  return { index: at + 1, label: (index >= 0 ? step.activeForm : undefined) ?? step.subject }
}

export function summary(value: TaskProgressPlan, at: number): string {
  const done = value.steps.filter(step => step.status === 'completed').length
  const total = value.steps.length
  const time = elapsed((value.finishedAt ?? at) - value.startedAt)
  if (value.finishedAt !== null) return `✓ ${done}/${total} étapes terminées en ${time}`
  const step = current(value.steps)
  return `${bar(done, total, 10)} ${done}/${total}${step ? ` · ${step.label}` : ''} · ${time}`
}

const MULTI_STEP = 2

async function publish($: EngineInterface, next: TaskProgressPlan | null) {
  const at = await $.clock.now()
  await update($, plan, () => next)
  await update($, now, () => at)
  $.ui.status(next !== null && next.steps.length >= MULTI_STEP ? summary(next, at) : undefined)
}

const STATUSES: readonly Status[] = ['pending', 'in_progress', 'completed']
const asStatus = (value: unknown): Status => (STATUSES.includes(value as Status) ? (value as Status) : 'pending')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progression', description: 'Affiche où en est la tâche en cours' })
    // The elapsed time ticks once a second while a task runs.
    $.clock.every(1000, () => {
      void (async () => {
        const value = await read($, plan)
        if (value === null || value.finishedAt !== null || value.steps.length < MULTI_STEP) return
        const at = await $.clock.now()
        await update($, now, () => at)
      })()
    })
    return next(e)
  })

  on('command.run', { command: 'progression' }, async $ => {
    const value = await read($, plan)
    return {
      text: value === null || value.steps.length === 0 ? 'Aucune tâche en plusieurs étapes en cours.' : summary(value, await $.clock.now()),
    }
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const id = ran.result.task.id
    const at = await $.clock.now()
    const step: TaskProgressStep = { id, subject: e.subject, status: 'pending', ...(e.activeForm !== undefined && { activeForm: e.activeForm }) }
    await publish($, addStep(await read($, plan), step, at))
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || ran.result.success === false) return ran
    const at = await $.clock.now()
    await publish($, changeStep(await read($, plan), e.taskId, e, at))
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const at = await $.clock.now()
    const steps = e.todos.map((todo, i) => ({
      id: String(i),
      subject: todo.content,
      activeForm: todo.activeForm,
      status: asStatus(todo.status),
    }))
    await publish($, steps.length === 0 ? null : settle(await read($, plan), steps, at))
    return ran
  }).catch(($, e, next) => next(e))

  // A finished task's bar stays until the next prompt.
  on('prompt.submit', async ($, e, next) => {
    const value = await read($, plan)
    if (value !== null && value.finishedAt !== null) await publish($, null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const value = await read($, plan)
    const at = await read($, now)
    if (e.props.hasSurvey || value === null || value.steps.length < MULTI_STEP) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const total = value.steps.length
    const done = value.steps.filter(step => step.status === 'completed').length
    const isDone = value.finishedAt !== null
    const time = elapsed((value.finishedAt ?? Math.max(at, value.startedAt)) - value.startedAt)
    const width = Math.max(10, Math.min(30, e.props.bodyColumns - 30))
    const step = current(value.steps)
    const room = Math.max(0, e.props.maxRows - 2)
    const listed = value.steps.length <= room ? value.steps : []

    return (
      <Box flexDirection="column">
        <Box>
          <Text key="bar" color={isDone ? 'success' : 'claude'}>{bar(done, total, width)}</Text>
          <Text key="count" bold>{` ${done}/${total} étapes`}</Text>
          <Text key="time" dimColor>{` · ⏱ ${time}`}</Text>
        </Box>
        <Text key="current" wrap="truncate-end" color={isDone ? 'success' : undefined}>
          {isDone ? '✓ Tâche terminée' : step ? `▶ Étape ${step.index}/${total} : ${step.label}` : '…'}
        </Text>
        {!isDone &&
          listed.map(one => (
            <Text dimColor={one.status !== 'in_progress'} wrap="truncate-end">
              {`  ${one.status === 'completed' ? '✓' : one.status === 'in_progress' ? '▶' : '○'} ${one.subject}`}
            </Text>
          ))}
      </Box>
    )
  })
}
