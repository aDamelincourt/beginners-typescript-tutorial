import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NextStepsList } from '../types'

const suggestions = atom({ plugin: 'next-steps', key: 'suggestions' } as const, [] as NextStepsList)
const isLoading = atom({ plugin: 'next-steps', key: 'isLoading' } as const, false)

const ENABLED_KEY = 'enabled'

const FORK_PROMPT = [
  'Propose exactly 3 short next steps the user could ask you for now, given the conversation so far.',
  'Write each one as the user would type it, in the language the user writes in, under 70 characters.',
  'Answer with a JSON array of 3 strings and nothing else.',
].join(' ')

export function parseSuggestions(text: string): string[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const value: unknown = JSON.parse(match[0])
    if (!Array.isArray(value)) return []
    return value
      .filter((one): one is string => typeof one === 'string')
      .map(one => one.trim())
      .filter(one => one.length > 0)
      .slice(0, 3)
  } catch {
    return []
  }
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  return ((await $.store.get(ENABLED_KEY)) ?? true) !== false
}

async function clear($: EngineInterface) {
  await update($, suggestions, () => [])
  await update($, isLoading, () => false)
}

async function generate($: EngineInterface) {
  await update($, isLoading, () => true)
  const reply = await $.model.fork({ prompt: FORK_PROMPT })
  const list = reply.isAnswered ? parseSuggestions(reply.text) : []
  await update($, suggestions, () => list)
  await update($, isLoading, () => false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'next-steps',
      description: 'Suggestions de prochaine étape : on, off, ou rien pour basculer',
      argumentHint: '[on|off]',
    })
    return next(e)
  })

  on('command.run', { command: 'next-steps' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const wanted = arg === 'on' ? true : arg === 'off' ? false : !(await isEnabled($))
    await $.store.set(ENABLED_KEY, wanted)
    if (!wanted) await clear($)
    return {
      text: wanted
        ? 'Suggestions de prochaine étape activées.'
        : 'Suggestions de prochaine étape désactivées (/next-steps on pour les réactiver).',
    }
  })

  // A new prompt makes the previous suggestions stale.
  on('prompt.submit', async ($, e, next) => {
    await clear($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && (await isEnabled($))) {
      // Off the turn's own dispatch, so the turn ends without waiting on the fork.
      $.clock.after(0, () => void generate($))
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, suggestions)
    const loading = await read($, isLoading)
    if (e.props.hasSurvey || e.props.isWorking || (list.length === 0 && !loading)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    if (list.length === 0) {
      return (
        <Box>
          <Text dimColor>Suggestions en préparation…</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>Prochaines étapes :</Text>
        {list.map((text, i) => (
          <Button
            key={`step-${i + 1}`}
            label={text}
            hotkey={String(i + 1)}
            variant={i === 0 ? 'primary' : 'secondary'}
            onPress={async () => {
              await clear($)
              await $.prompt.submit({ text, asUser: true })
            }}
          />
        ))}
        <Button key="dismiss" label="Ignorer" hotkey="x" role="dismiss" plain onPress={() => clear($)} />
      </Box>
    )
  })
}
