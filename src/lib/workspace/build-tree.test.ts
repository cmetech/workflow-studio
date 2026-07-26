import { describe, expect, it } from 'vitest'
import { buildWorkspaceTree } from './build-tree'
import type { WorkspaceEntry } from './types'

function workflow(relativePath: string, state: 'paired' | 'legacy' = 'legacy'): WorkspaceEntry {
  return {
    kind: 'workflow',
    id: `workflow:workspace-1:${relativePath}`,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    relativePath,
    definitionPath: relativePath,
    companionPath: state === 'paired' ? relativePath.replace(/\.ya?ml$/, '.hermes.yaml') : null,
    state,
    readOnly: false,
  }
}

describe('buildWorkspaceTree', () => {
  it('builds deterministic nested folders with folders before workflow items', () => {
    const entries = [
      workflow('z-last.yaml'),
      workflow('team/release.yaml', 'paired'),
      workflow('a-first.yaml'),
      workflow('team/automations/daily.yml'),
      workflow('alpha/inside.yaml'),
    ]

    const tree = buildWorkspaceTree(entries)

    expect(tree.map((entry) => [entry.kind, entry.name])).toEqual([
      ['folder', 'alpha'],
      ['folder', 'team'],
      ['workflow', 'a-first.yaml'],
      ['workflow', 'z-last.yaml'],
    ])
    expect(tree[1]).toMatchObject({
      kind: 'folder',
      id: 'folder:team',
      relativePath: 'team',
      children: [
        expect.objectContaining({ kind: 'folder', name: 'automations' }),
        expect.objectContaining({ kind: 'workflow', name: 'release.yaml', state: 'paired' }),
      ],
    })
  })

  it('preserves orphan and read-only states as leaf entries', () => {
    const entries: WorkspaceEntry[] = [
      {
        kind: 'orphan-companion',
        id: 'orphan:workspace-1:resources/lost.hermes.yaml',
        name: 'lost.hermes.yaml',
        relativePath: 'resources/lost.hermes.yaml',
        companionPath: 'resources/lost.hermes.yaml',
        state: 'orphan',
        readOnly: true,
      },
    ]

    expect(buildWorkspaceTree(entries)).toEqual([
      expect.objectContaining({
        kind: 'folder',
        name: 'resources',
        children: [expect.objectContaining({ kind: 'orphan-companion', state: 'orphan', readOnly: true })],
      }),
    ])
  })

  it('does not mutate caller-owned entries or their order', () => {
    const entries = [workflow('b.yaml'), workflow('a.yaml')]
    const before = structuredClone(entries)

    buildWorkspaceTree(entries)

    expect(entries).toEqual(before)
  })
})
