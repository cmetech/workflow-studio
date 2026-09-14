import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function eolAttribute(paths: readonly string[]): Readonly<Record<string, string>> {
  const output = execFileSync('git', ['check-attr', 'eol', '--', ...paths], { encoding: 'utf8' })
  return Object.fromEntries(
    output
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const match = /^(.*): eol: (.*)$/.exec(line)
        if (!match) throw new Error(`Unexpected git check-attr output: ${line}`)
        return [match[1]!, match[2]!]
      }),
  )
}

describe('checkout line-ending contract', () => {
  it('checks source out as LF and reserves CRLF for Windows batch entry points', () => {
    expect(eolAttribute(['package.json', 'src/app/App.svelte', 'scripts/example.cmd', 'scripts/example.bat'])).toEqual({
      'package.json': 'lf',
      'src/app/App.svelte': 'lf',
      'scripts/example.cmd': 'crlf',
      'scripts/example.bat': 'crlf',
    })
  })
})
