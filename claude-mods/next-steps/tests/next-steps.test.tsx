import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const ANSWER = {
  answer: '2 + 2 = 4',
  durationMs: 1000,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
} as const

test('three clickable next steps, sent as typed, and dismissable', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const sent: string[] = []
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: '["Explique le calcul", "Et 3 + 3 ?", "Donne un exercice"]',
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.turn.complete(ANSWER)
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'next-steps', surface, ...BAND })
    expect((await ui.find({ key: 'step-1' }))?.text).toContain('Explique le calcul')
    expect(await ui.find({ key: 'step-3' })).toBeDefined()
    expect(await ui.find({ key: 'dismiss' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', ...BAND })
  await ui.press({ key: 'step-2' })
  expect(sent).toEqual(['Et 3 + 3 ?'])
  expect(await ui.find({ key: 'step-1' })).toBeUndefined()
  await ui.unmount()

  await $.turn.complete(ANSWER)
  await clock.settle()
  const again = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', ...BAND })
  await again.press({ key: 'dismiss' })
  expect(await again.find({ key: 'step-1' })).toBeUndefined()
  expect(sent).toEqual(['Et 3 + 3 ?'])
})

test('/next-steps off stops the suggestions', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  let forks = 0
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })

  await $.command.run({ command: 'next-steps', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.turn.complete(ANSWER)
  await clock.settle()
  expect(forks).toBe(0)
})
