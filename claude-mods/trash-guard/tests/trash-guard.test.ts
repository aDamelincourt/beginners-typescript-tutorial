import { expect, test } from 'claude-code/testing'

import { deletes, findBypass, parseLog } from '../hooks/register'

test('rm, rmdir and unlink are recognised, other commands are not', () => {
  for (const command of ['rm -rf build', 'cd x && rm a.txt', 'ls; rmdir vide', 'unlink f', 'rm']) {
    expect(deletes(command)).toBe(true)
  }
  for (const command of ['ls -la', 'npm run format', 'echo confirm', 'cat rm.txt']) {
    expect(deletes(command)).toBe(false)
  }
})

test('deletions that would skip the trash are named', () => {
  expect(findBypass('find . -name "*.log" -delete')).toBe('find -delete')
  expect(findBypass('find . -exec rm {} +')).toBe('find -exec rm')
  expect(findBypass('ls | xargs rm -f')).toBeDefined()
  expect(findBypass('sudo rm -rf /opt/x')).toBeDefined()
  expect(findBypass('/bin/rm -rf x')).toBeDefined()
  expect(findBypass('command rm x')).toBeDefined()
  expect(findBypass('\\rm x')).toBeDefined()
  expect(findBypass('bash -c "rm -rf x"')).toBeDefined()
  expect(findBypass('git clean -fd')).toBe('git clean')
  expect(findBypass('git clean -n')).toBeUndefined()
  expect(findBypass('rm -rf build && npm test')).toBeUndefined()
})

test('the log reads back as original and destination', () => {
  expect(parseLog('/w/a b.txt\t/t/files/a b.txt\n/w/d\t/t/files/d.2\n')).toEqual([
    { from: '/w/a b.txt', to: '/t/files/a b.txt' },
    { from: '/w/d', to: '/t/files/d.2' },
  ])
})

test('a Bash rm runs with the trash functions and the moves are reported', async ($, on) => {
  let ran = ''
  let log = ''
  const removed: string[] = []
  on('tool.call', ($, e) => {
    ran = e.tool === 'Bash' ? e.command : ''
    log = /CLAUDE_TRASH_LOG='([^']+)'/.exec(ran)?.[1] ?? ''
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('fs.exists', ($, e) => ({ value: e.path === log }))
  on('fs.read', () => ({ value: '/w/dossier-test\t/home/u/.local/share/Trash/files/dossier-test\n' }))
  on('process.run', ($, e) => {
    removed.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const answer = await $.tool.call({ tool: 'Bash', command: 'rm -rf dossier-test' })
  expect(ran).toContain('bin/safe-rm.sh')
  expect(ran.endsWith('\nrm -rf dossier-test')).toBe(true)
  expect(answer.context?.join('\n')).toContain('/w/dossier-test')
  expect(removed).toEqual([`rm -f ${log}`])

  const listed = await $.command.run({
    command: 'corbeille',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(listed.text).toContain('/w/dossier-test')
})

test('find -delete is refused and never runs', async ($, on) => {
  let calls = 0
  on('tool.call', () => {
    calls += 1
    return { result: {} }
  })
  const answer = await $.tool.call({ tool: 'Bash', command: 'find . -delete' })
  expect(answer.deny).toContain('find -delete')
  expect(calls).toBe(0)
})

test('a command without deletion is left as it is', async ($, on) => {
  let ran = ''
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') ran = e.command
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(ran).toBe('ls -la')
})
