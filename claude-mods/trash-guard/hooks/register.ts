import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TrashGuardItem } from '../types'

const moved = atom({ plugin: 'trash-guard', key: 'moved' } as const, [] as TrashGuardItem[])

const DELETES = /(^|[^\w.\/-])(rm|rmdir|unlink)(?=\s|$|;|&|\|)/

// Forms that reach the real binary instead of the shell functions, or delete
// by other means: refused, so nothing is erased behind the trash's back.
const BYPASSES: readonly [RegExp, string][] = [
  [/\bfind\b[^|;&]*\s-delete\b/, 'find -delete'],
  [/-exec(dir)?\s+(\S*\/)?(rm|rmdir|unlink)\b/, 'find -exec rm'],
  [/\b(xargs|sudo|doas|env|nohup|exec|nice|timeout|parallel)\b[^|;&]*?(^|\s|\/)(rm|rmdir|unlink)(\s|$)/, 'rm lancé par une autre commande'],
  [/(^|[\s;&|(`])\/(usr\/)?bin\/(rm|rmdir|unlink)\b/, 'chemin absolu vers rm'],
  [/\b(command|builtin)\s+(-\S+\s+)*(rm|rmdir|unlink)\b/, 'command rm'],
  [/\\(rm|rmdir|unlink)\b/, '\\rm'],
  [/\b(ba|z|k|da)?sh\s+(-\S+\s+)*-c\b[^|;&]*\b(rm|rmdir|unlink)\b/, 'rm dans un sous-shell sh -c'],
  [/\bgit\s+clean\b(?![^|;&]*(\s-n\b|--dry-run|\s-[a-zA-Z]*n))/, 'git clean'],
]

export function findBypass(command: string): string | undefined {
  return BYPASSES.find(([pattern]) => pattern.test(command))?.[1]
}

export function deletes(command: string): boolean {
  return DELETES.test(command)
}

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`

export function parseLog(text: string): TrashGuardItem[] {
  return text
    .split('\n')
    .filter(line => line.includes('\t'))
    .map(line => {
      const [from = '', to = ''] = line.split('\t')
      return { from, to }
    })
}

async function takeLog($: EngineInterface, path: string): Promise<TrashGuardItem[]> {
  if (!(await $.fs.exists(path))) return []
  const items = parseLog(await $.fs.read(path))
  await $.process.run(['rm', '-f', path])
  return items
}

const listing = (items: readonly TrashGuardItem[]) =>
  items.map(item => `  • ${item.from}  →  ${item.to}`).join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'corbeille',
      description: 'Liste ce que Claude a déplacé dans la corbeille pendant cette session',
    })
    return next(e)
  })

  on('command.run', { command: 'corbeille' }, async $ => {
    const items = await read($, moved)
    return {
      text:
        items.length === 0
          ? 'Rien n’a été déplacé dans la corbeille pendant cette session.'
          : `Déplacé dans la corbeille pendant cette session (${items.length}) :\n${listing(items)}`,
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const bypass = findBypass(e.command)
    if (bypass !== undefined) {
      return {
        deny:
          `trash-guard : « ${bypass} » effacerait définitivement sans passer par la corbeille. ` +
          'Utilise rm, rmdir ou unlink directement dans la commande : ils déplacent vers la corbeille.',
      }
    }
    if (!deletes(e.command)) return next(e)

    const log = `/tmp/claude-trash-${crypto.randomUUID()}.log`
    const prelude =
      'unalias rm rmdir unlink 2>/dev/null\n' +
      `CLAUDE_TRASH_LOG=${quote(log)}; . ${quote(`${$.plugin.root}/bin/safe-rm.sh`)}\n`
    const ran = await next({ ...e, command: prelude + e.command })

    const items = await takeLog($, log)
    if (items.length === 0) return ran

    await update($, moved, list => [...list, ...items])
    $.ui.log(`🗑  Déplacé dans la corbeille (${items.length}) :\n${listing(items)}`)
    if (ran.deny !== undefined) return ran
    return {
      ...ran,
      context: [
        ...(ran.context ?? []),
        `trash-guard: nothing was deleted; these were moved to the system trash and can be restored:\n${listing(items)}`,
      ],
    }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'trash-guard : la protection a échoué, commande bloquée par prudence.' },
  )
}
