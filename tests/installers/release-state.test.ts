import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveRelease, runReleaseResolution } from '../../scripts/resolve-release.mjs'

const EXPECTED_COMMIT = 'a'.repeat(40)

interface Release {
  id: number
  tag_name: string
  draft: boolean
  prerelease: boolean
  target_commitish: string
  assets: unknown[]
}

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: 42,
    tag_name: 'v3.0.1',
    draft: true,
    prerelease: false,
    target_commitish: EXPECTED_COMMIT,
    assets: [],
    ...overrides,
  }
}

function invoke(
  response: unknown,
  options: {
    mode?: 'absent' | 'exact-draft' | 'validate-json'
    output?: 'id' | 'json'
    tag?: string
    expectedId?: string
    rawResponse?: string
    ghStatus?: number
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'workflow-studio-release-state-'))
  const args = [
    '--mode',
    options.mode ?? 'exact-draft',
    '--repository',
    'cmetech/workflow-studio',
    '--tag',
    options.tag ?? 'v3.0.1',
    '--expected-commit',
    EXPECTED_COMMIT,
  ]
  if (options.output) args.push('--output', options.output)
  if (options.expectedId) args.push('--expected-id', options.expectedId)
  let ghArguments: string[] = []
  const result = runReleaseResolution(args, {
    runGh(arguments_: string[]) {
      ghArguments = [...arguments_]
      return {
        error: undefined,
        status: options.ghStatus ?? 0,
        stdout: options.rawResponse ?? JSON.stringify(response),
        stderr: options.ghStatus ? 'fake gh failed\n' : '',
      }
    },
  })
  return { root, result, ghArguments }
}

function invokeJson(
  response: unknown,
  options: { expectedId?: string; fromFile?: boolean; rawResponse?: string; output?: 'id' | 'json' } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'workflow-studio-release-json-'))
  const inputPath = join(root, 'release.json')
  const serialized = options.rawResponse ?? JSON.stringify(response)
  if (options.fromFile) writeFileSync(inputPath, serialized)
  const args = [
    '--mode',
    'validate-json',
    '--input',
    options.fromFile ? inputPath : '-',
    '--tag',
    'v3.0.1',
    '--expected-commit',
    EXPECTED_COMMIT,
    '--output',
    options.output ?? 'id',
  ]
  if (options.expectedId) args.push('--expected-id', options.expectedId)
  let ghInvoked = false
  const result = runReleaseResolution(args, {
    runGh() {
      ghInvoked = true
      throw new Error('validate-json must not invoke GitHub')
    },
    readInput: (input: string) => (input === '-' ? serialized : readFileSync(input, 'utf8')),
  })
  return { root, result, ghInvoked }
}

describe('authenticated release-list resolution', () => {
  it('uses an injected GitHub runner instead of resolving a host executable', () => {
    const runGh = vi.fn(() => ({
      error: undefined,
      status: 0,
      stdout: JSON.stringify([[release({ id: 73 })]]),
      stderr: '',
    }))

    expect(
      resolveRelease(
        [
          '--mode',
          'exact-draft',
          '--repository',
          'cmetech/workflow-studio',
          '--tag',
          'v3.0.1',
          '--expected-commit',
          EXPECTED_COMMIT,
        ],
        { runGh },
      ),
    ).toBe(`${JSON.stringify(release({ id: 73 }))}\n`)
    expect(runGh).toHaveBeenCalledWith([
      'api',
      '--paginate',
      '--slurp',
      'repos/cmetech/workflow-studio/releases?per_page=100',
    ])
  })

  it('classifies a missing release without mutating process output state', () => {
    const result = runReleaseResolution(
      [
        '--mode',
        'exact-draft',
        '--repository',
        'cmetech/workflow-studio',
        '--tag',
        'v3.0.1',
        '--expected-commit',
        EXPECTED_COMMIT,
      ],
      {
        runGh: () => ({ error: undefined, status: 0, stdout: '[[]]', stderr: '' }),
      },
    )

    expect(result).toEqual({
      status: 3,
      stdout: '',
      stderr: 'Release resolution failed: Expected exactly one release tagged v3.0.1; found 0\n',
    })
  })

  it('finds one exact draft across paginated release-list results without using the tag endpoint', () => {
    const invocation = invoke([[release({ id: 11, tag_name: 'v9.9.9' })], [release({ id: 73 })]])
    try {
      expect(invocation.result.status, invocation.result.stderr).toBe(0)
      expect(JSON.parse(invocation.result.stdout)).toMatchObject({
        id: 73,
        tag_name: 'v3.0.1',
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

  it('uses a distinct no-match status so workflow fallback cannot mask malformed release state', () => {
    const invocation = invoke([[]])
    try {
      expect(invocation.result.status).toBe(3)
      expect(invocation.result.stderr).toMatch(/exactly one release tagged v3\.0\.1; found 0/i)
      expect(invocation.result.stdout).toBe('')
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it('requires later lookups to resolve the original validated release ID', () => {
    const invocation = invoke([[release({ id: 73 })]], { expectedId: '72' })
    try {
      expect(invocation.result.status).toBe(1)
      expect(invocation.result.stderr).toMatch(/release id/i)
      expect(invocation.result.stdout).toBe('')
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it.each([
    [
      'duplicate exact tags',
      [[release({ id: 1 }), release({ id: 2 })]],
      /exactly one release tagged v3\.0\.1; found 2/i,
    ],
    ['wrong commit', [[release({ target_commitish: 'b'.repeat(40) })]], /target commit/i],
    ['non-draft release', [[release({ draft: false })]], /must be a draft/i],
    ['prerelease draft', [[release({ prerelease: true })]], /must not be a prerelease/i],
    ['string release ID', [[release({ id: '73' as unknown as number })]], /release id/i],
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
      expect(existing.result.stderr).toMatch(/expected no release tagged v3\.0\.1; found 1/i)
    } finally {
      rmSync(absent.root, { recursive: true, force: true })
      rmSync(existing.root, { recursive: true, force: true })
    }
  })

  it('treats the tag as data and never executes shell syntax', () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-studio-release-injection-'))
    const sentinel = join(root, 'executed')
    const tag = `v3.0.1; touch ${sentinel}`
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

  it.each([
    ['a non-object asset', [null]],
    ['a string asset ID', [{ id: '1', name: 'latest.json' }]],
    ['a zero asset ID', [{ id: 0, name: 'latest.json' }]],
    ['a fractional asset ID', [{ id: 1.5, name: 'latest.json' }]],
    ['an unsafe integer asset ID', [{ id: Number.MAX_SAFE_INTEGER + 1, name: 'latest.json' }]],
    ['an empty asset name', [{ id: 1, name: '' }]],
    ['a slash in an asset name', [{ id: 1, name: 'nested/latest.json' }]],
    ['a backslash in an asset name', [{ id: 1, name: 'nested\\latest.json' }]],
    ['a dot asset name', [{ id: 1, name: '.' }]],
    ['a dot-dot asset name', [{ id: 1, name: '..' }]],
    ['a control character in an asset name', [{ id: 1, name: 'latest\n.json' }]],
    ['an excessively long asset name', [{ id: 1, name: `${'a'.repeat(256)}.json` }]],
    [
      'duplicate asset names',
      [
        { id: 1, name: 'latest.json' },
        { id: 2, name: 'latest.json' },
      ],
    ],
  ] as const)('rejects exact drafts containing %s', (_name, assets) => {
    const invocation = invoke([[release({ assets: [...assets] })]])
    try {
      expect(invocation.result.status).toBe(1)
      expect(invocation.result.stderr).toMatch(/asset/i)
      expect(invocation.result.stdout).toBe('')
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it('rejects malformed release-list JSON', () => {
    const invocation = invoke(undefined, { rawResponse: '{"draft":' })
    try {
      expect(invocation.result.status).toBe(1)
      expect(invocation.result.stderr).toMatch(/invalid json/i)
      expect(invocation.result.stdout).toBe('')
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it.each([
    ['a non-array response', { releases: [] }],
    ['a non-array page', [[release()], { release: release() }]],
  ])('rejects unexpected pagination shape: %s', (_name, response) => {
    const invocation = invoke(response)
    try {
      expect(invocation.result.status).toBe(1)
      expect(invocation.result.stderr).toMatch(/paginated arrays/i)
      expect(invocation.result.stdout).toBe('')
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it('propagates a nonzero gh release-list status without emitting release data', () => {
    const invocation = invoke([[release()]], { ghStatus: 23 })
    try {
      expect(invocation.result.status).toBe(1)
      expect(invocation.result.stderr).toMatch(/status 23/i)
      expect(invocation.result.stdout).toBe('')
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })
})

describe('release JSON validation without GitHub lookup', () => {
  it.each([
    ['stdin', false],
    ['a file', true],
  ])('validates a zero-asset draft from %s without invoking gh', (_source, fromFile) => {
    const invocation = invokeJson(release({ id: 73 }), { expectedId: '73', fromFile })
    try {
      expect(invocation.result.status, invocation.result.stderr).toBe(0)
      expect(invocation.result.stdout).toBe('73\n')
      expect(invocation.ghInvoked).toBe(false)
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it.each([
    ['a nonempty asset list', release({ assets: [{ id: 1, name: 'latest.json' }] }), undefined, /zero assets/i],
    ['the wrong tag', release({ tag_name: 'v9.9.9' }), undefined, /wrong tag/i],
    ['the wrong commit', release({ target_commitish: 'b'.repeat(40) }), undefined, /target commit/i],
    ['a published release', release({ draft: false }), undefined, /must be a draft/i],
    ['a prerelease draft', release({ prerelease: true }), undefined, /must not be a prerelease/i],
    ['a mismatched expected ID', release({ id: 73 }), '72', /release id/i],
  ] as const)('rejects created JSON containing %s without invoking gh', (_name, response, expectedId, error) => {
    const invocation = invokeJson(response, { expectedId })
    try {
      expect(invocation.result.status).toBe(1)
      expect(invocation.result.stderr).toMatch(error)
      expect(invocation.result.stdout).toBe('')
      expect(invocation.ghInvoked).toBe(false)
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })

  it('rejects malformed created JSON without invoking gh', () => {
    const invocation = invokeJson(undefined, { rawResponse: '{"draft":' })
    try {
      expect(invocation.result.status).toBe(1)
      expect(invocation.result.stderr).toMatch(/invalid json/i)
      expect(invocation.result.stdout).toBe('')
      expect(invocation.ghInvoked).toBe(false)
    } finally {
      rmSync(invocation.root, { recursive: true, force: true })
    }
  })
})
