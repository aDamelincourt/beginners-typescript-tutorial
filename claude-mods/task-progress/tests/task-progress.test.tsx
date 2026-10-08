import { expect, mock, test } from 'claude-code/testing'

import type { RenderElement } from 'claude-code'

import { bar, elapsed } from '../hooks/register'

const textOf = (node: unknown): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : node !== null && typeof node === 'object' && 'children' in node
        ? textOf((node as { children: unknown }).children)
        : ''

// One line per child of the band's outer column.
const textLines = (tree: RenderElement): string[] => {
  const children = (tree as { children?: unknown }).children
  return Array.isArray(children) ? children.map(textOf) : [textOf(tree)]
}

export const frames: string[] = []

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const STEPS = [
  ['Créer le fichier', 'Création du fichier'],
  ['Écrire la fonction', 'Écriture de la fonction'],
  ['Ajouter un test', 'Ajout du test'],
  ['Lancer le test', 'Lancement du test'],
] as const

test('bar and elapsed time read as expected', () => {
  expect(bar(2, 4, 8)).toBe('████░░░░')
  expect(bar(0, 4, 4)).toBe('░░░░')
  expect(elapsed(65_000)).toBe('1m 05s')
  expect(elapsed(3_725_000)).toBe('1h 02m 05s')
})

test('a 4-step task shows done/total, the current step and the elapsed time', async ($, on) => {
  const clock = mock.clock(on)
  let ids = 0
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskCreate') {
      ids += 1
      return { result: { task: { id: String(ids), subject: e.subject } } }
    }
    if (e.tool === 'TaskUpdate') {
      return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
    }
    return { result: {} }
  })
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })

  const snapshot = async () => {
    const ui = await $.ui.mount({ plugin: 'task-progress', surface: 'terminal', ...BAND })
    const lines = textLines(await ui.drawn())
    await ui.unmount()
    frames.push(lines.join('\n'))
    return lines.join('\n')
  }

  // Nothing is shown before a multi-step task exists.
  const empty = await $.ui.mount({ plugin: 'task-progress', surface: 'terminal', ...BAND })
  expect(textLines(await empty.drawn()).join('')).not.toContain('étapes')
  await empty.unmount()

  for (const [subject, activeForm] of STEPS) {
    await $.tool.call({ tool: 'TaskCreate', subject, description: subject, activeForm })
  }
  expect(await snapshot()).toContain('0/4 étapes')

  for (const [i] of STEPS.entries()) {
    const id = String(i + 1)
    await $.tool.call({ tool: 'TaskUpdate', taskId: id, status: 'in_progress' })
    await clock.advance(13_000)
    const during = await snapshot()
    expect(during).toContain(`${i}/4 étapes`)
    expect(during).toContain(`Étape ${i + 1}/4 : ${STEPS[i]?.[1]}`)
    await $.tool.call({ tool: 'TaskUpdate', taskId: id, status: 'completed' })
  }

  const done = await snapshot()
  expect(done).toContain('4/4 étapes')
  expect(done).toContain('0m 52s')
  expect(done).toContain('Tâche terminée')

  // Time stays frozen once finished.
  await clock.advance(30_000)
  expect(await snapshot()).toContain('0m 52s')

  expect(statuses.at(-1)).toBe('✓ 4/4 étapes terminées en 0m 52s')

  const listed = await $.command.run({
    command: 'progression',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(listed.text).toBe('✓ 4/4 étapes terminées en 0m 52s')
})
