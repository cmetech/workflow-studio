import { describe, expect, it } from 'vitest'
import { pairWorkflowFiles } from './pair-workflows'
import type { WorkspaceFileEntry } from './types'

function file(relativePath: string, overrides: Partial<WorkspaceFileEntry> = {}): WorkspaceFileEntry {
  return {
    relativePath,
    kind: 'file',
    size: 1,
    modifiedAt: '2026-07-25T12:00:00.000Z',
    symlink: 'none',
    readOnly: false,
    ...overrides,
  }
}

describe('pairWorkflowFiles', () => {
  it('pairs yaml and yml definitions only with canonical .hermes.yaml companions', () => {
    const paired = pairWorkflowFiles('workspace-1', [
      file('flows/alpha.yaml'),
      file('flows/alpha.hermes.yaml'),
      file('flows/beta.yml'),
      file('flows/beta.hermes.yaml'),
      file('flows/gamma.yml'),
      file('flows/gamma.hermes.yml'),
    ])

    expect(paired).toEqual([
      expect.objectContaining({
        kind: 'workflow',
        definitionPath: 'flows/alpha.yaml',
        companionPath: 'flows/alpha.hermes.yaml',
        state: 'paired',
      }),
      expect.objectContaining({
        kind: 'workflow',
        definitionPath: 'flows/beta.yml',
        companionPath: 'flows/beta.hermes.yaml',
        state: 'paired',
      }),
      expect.objectContaining({
        kind: 'workflow',
        definitionPath: 'flows/gamma.hermes.yml',
        companionPath: null,
        state: 'legacy',
      }),
      expect.objectContaining({
        kind: 'workflow',
        definitionPath: 'flows/gamma.yml',
        companionPath: null,
        state: 'legacy',
      }),
    ])
  })

  it('reports canonical companions without an exact matching definition as orphans', () => {
    const paired = pairWorkflowFiles('workspace-1', [
      file('flows/orphan.hermes.yaml'),
      file('flows/OnlyCase.yaml'),
      file('flows/onlycase.hermes.yaml'),
    ])

    expect(paired).toEqual([
      expect.objectContaining({
        kind: 'workflow',
        id: 'workflow:workspace-1:flows/OnlyCase.yaml',
        definitionPath: 'flows/OnlyCase.yaml',
        state: 'legacy',
      }),
      expect.objectContaining({
        kind: 'orphan-companion',
        companionPath: 'flows/onlycase.hermes.yaml',
        state: 'orphan',
      }),
      expect.objectContaining({
        kind: 'orphan-companion',
        companionPath: 'flows/orphan.hermes.yaml',
        state: 'orphan',
      }),
    ])
  })

  it('keeps same-stem workflows in separate normalized folders', () => {
    const paired = pairWorkflowFiles('workspace-1', [
      file('team/a.yml'),
      file('team/a.hermes.yaml'),
      file('personal/a.yml'),
      file('personal/a.hermes.yaml'),
    ])

    expect(paired.map((entry) => [entry.id, entry.relativePath])).toEqual([
      ['workflow:workspace-1:personal/a.yml', 'personal/a.yml'],
      ['workflow:workspace-1:team/a.yml', 'team/a.yml'],
    ])
  })

  it('uses locale-independent code-point ordering', () => {
    const forward = [file('z.yaml'), file('a.yaml'), file('A.yaml'), file('ä.yaml')]
    const reverse = [...forward].reverse()
    const expected = ['A.yaml', 'a.yaml', 'z.yaml', 'ä.yaml']

    expect(pairWorkflowFiles('workspace-1', forward).map((entry) => entry.relativePath)).toEqual(expected)
    expect(pairWorkflowFiles('workspace-1', reverse).map((entry) => entry.relativePath)).toEqual(expected)
  })

  it('excludes ignored directories, non-workflow files, and unsafe symlinks', () => {
    const paired = pairWorkflowFiles('workspace-1', [
      file('.git/workflows/hidden.yaml'),
      file('node_modules/package/workflow.yaml'),
      file('vendor/workflow.yaml'),
      file('dist/workflow.yaml'),
      file('build/workflow.yaml'),
      file('target/workflow.yaml'),
      file('.workflow-studio/run/workflow.yaml'),
      file('flows/readme.md'),
      file('flows/unsafe.yaml', { symlink: 'unsafe' }),
      file('flows/safe.yaml', { symlink: 'safe' }),
    ])

    expect(paired).toEqual([expect.objectContaining({ definitionPath: 'flows/safe.yaml', state: 'legacy' })])
  })

  it('propagates read-only metadata without reading file content', () => {
    const paired = pairWorkflowFiles('workspace-1', [
      file('resources/example.yaml', { readOnly: true, size: 500 }),
      file('resources/example.hermes.yaml', { readOnly: true, size: 100 }),
    ])

    expect(paired).toEqual([
      expect.objectContaining({
        id: 'workflow:workspace-1:resources/example.yaml',
        readOnly: true,
        state: 'paired',
      }),
    ])
  })
})
