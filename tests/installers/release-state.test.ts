import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const EXPECTED_COMMIT = 'a'.repeat(40)

interface Release {
  id: number
  tag_name: string
  draft: boolean
  target_commitish: string
  assets: unknown[]
}

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: 42,
    tag_name: 'v1.0.2',
    draft: true,
    target_commitish: EXPECTED_COMMIT,
    assets: [],
    ...overrides,
  }
}

function invoke(
  pages: Release[][],
  options: { mode?: 'absent' | 'exact-draft'; output?: 'id' | 'json'; tag?: string } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'workflow-studio-release-state-'))
  const bin = join(root, 'bin')
  const fakeGh = join(bin, 'fake-gh.mjs')
  const argumentsPath = join(root, 'gh-arguments.json')
  mkdirSync(bin)
  writeFileSync(
    fakeGh,
    `import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
writeFileSync(process.env.FAKE_GH_ARGUMENTS, JSON.stringify(args))
if (args.some((argument) => argument.includes('/releases/tags/'))) {
  process.stderr.write('tag endpoint returned 404\\n')
  process.exit(44)
}
process.stdout.write(process.env.FAKE_GH_RESPONSE)
`,
  )
  const executable = join(bin, process.platform === 'win32' ? 'gh.cmd' : 'gh')
  if (process.platform === 'win32') {
    writeFileSync(executable, '@node "%~dp0\\fake-gh.mjs" %*\r\n')
  } else {
    writeFileSync(executable, '#!/bin/sh\nexec node "$(dirname "$0")/fake-gh.mjs" "$@"\n')
    chmodSync(executable, 0o700)
  }

  const args = [
    'scripts/resolve-release.mjs',
    '--mode',
    options.mode ?? 'exact-draft',
    '--repository',
    'cmetech/workflow-studio',
    '--tag',
    options.tag ?? 'v1.0.2',
    '--expected-commit',
    EXPECTED_COMMIT,
  ]
  if (options.output) args.push('--output', options.output)
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
      FAKE_GH_ARGUMENTS: argumentsPath,
      FAKE_GH_RESPONSE: JSON.stringify(pages),
    },
  })
  const ghArguments = existsSync(argumentsPath) ? (JSON.parse(readFileSync(argumentsPath, 'utf8')) as string[]) : []
  return { root, result, ghArguments }
}

describe('authenticated release-list resolution', () => {
  it('finds one exact draft across paginated release-list results without using the tag endpoint', () => {
    const invocation = invoke([[release({ id: 11, tag_name: 'v9.9.9' })], [release({ id: 73 })]])
    try {
      expect(invocation.result.status, invocation.result.stderr).toBe(0)
      expect(JSON.parse(invocation.result.stdout)).toMatchObject({
        id: 73,
        tag_name: 'v1.0.2',
        draft: true,
        target_commitish: EXPECTED_COMMIT,
      })
      expect(invocation.ghArguments).toEqual([
        'api',
        '--paginate',
        '--slurp',
        'repos/cmetech/workflow-studio/releases?per_page=100',
      ])
      expect(invocation.ghArguments.join(' ')).not.toContain('/releases/tags/')
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it('returns the validated numeric release ID when requested', () => {
    const invocation = invoke([[release({ id: 73 })]], { output: 'id' })
    try {
      expect(invocation.result.status, invocation.result.stderr).toBe(0)
      expect(invocation.result.stdout).toBe('73\n')
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it.each([
    [
      'duplicate exact tags',
      [[release({ id: 1 }), release({ id: 2 })]],
      /exactly one release tagged v1\.0\.2; found 2/i,
    ],
    ['wrong commit', [[release({ target_commitish: 'b'.repeat(40) })]], /target commit/i],
    ['non-draft release', [[release({ draft: false })]], /must be a draft/i],
  ] as const)('fails closed for %s', (_name, pages, expectedError) => {
    const invocation = invoke(pages.map((page) => [...page]))
    try {
      expect(invocation.result.status).toBe(1)
      expect(invocation.result.stderr).toMatch(expectedError)
      expect(invocation.result.stdout).toBe('')
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it('requires complete absence before a draft may be created', () => {
    const absent = invoke([[]], { mode: 'absent' })
    const existing = invoke([[release({ draft: false, target_commitish: 'b'.repeat(40) })]], { mode: 'absent' })
    try {
      expect(absent.result.status, absent.result.stderr).toBe(0)
      expect(absent.result.stdout).toBe('')
      expect(existing.result.status).toBe(1)
      expect(existing.result.stderr).toMatch(/expected no release tagged v1\.0\.2; found 1/i)
    } finally {
      rmSync(absent.root, { recursive: true, force: true })
      rmSync(existing.root, { recursive: true, force: true })
    }
  })

  it('treats the tag as data and never executes shell syntax', () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-studio-release-injection-'))
    const sentinel = join(root, 'executed')
    const tag = `v1.0.2; touch ${sentinel}`
    const invocation = invoke([[release({ tag_name: tag })]], { tag })
    try {
      expect(invocation.result.status, invocation.result.stderr).toBe(0)
      expect(existsSync(sentinel)).toBe(false)
      expect(JSON.parse(invocation.result.stdout).tag_name).toBe(tag)
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  })
})
