/// <reference types="node" />

import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkflowPairText } from '$src/lib/documents/types'
import type { YamlTransaction } from '$src/lib/documents/transactions'
import { createHistoryState, recordTransaction, redoTransaction, undoTransaction } from '$src/stores/history'
import { loadHistoricalPairAsDraft } from './version-actions'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('historical pair restore repository isolation', () => {
  it('changes only the in-memory draft and remains one undo/redo step', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-studio-restore-'))
    roots.push(root)
    git(root, 'init', '-b', 'main')
    git(root, 'config', 'user.name', 'Workflow Test')
    git(root, 'config', 'user.email', 'workflow@example.test')
    await writeFile(join(root, 'flow.yaml'), 'name: Historical\n')
    await writeFile(join(root, 'flow.hermes.yaml'), 'profile: historical\n')
    git(root, 'add', '--all')
    git(root, 'commit', '-m', 'historical')
    const historicalOid = git(root, 'rev-parse', 'HEAD').trim()
    await writeFile(join(root, 'flow.yaml'), 'name: Current\n')
    await writeFile(join(root, 'flow.hermes.yaml'), 'profile: current\n')
    git(root, 'add', '--all')
    git(root, 'commit', '-m', 'current')
    await writeFile(join(root, 'unrelated.txt'), 'staged unrelated\n')
    git(root, 'add', 'unrelated.txt')

    const before = await repositorySnapshot(root)
    const pair = currentPair()
    const restored = await loadHistoricalPairAsDraft({
      pair,
      snapshot: {
        oid: historicalOid,
        definition: git(root, 'show', `${historicalOid}:flow.yaml`),
        companion: git(root, 'show', `${historicalOid}:flow.hermes.yaml`),
      },
      apply: async (workingPair, mutation) => {
        const document = mutation.document === 'definition' ? workingPair.definition : workingPair.companion!
        const next = {
          ...workingPair,
          [mutation.document]: { ...document, text: mutation.text, revision: document.revision + 1 },
        }
        return { pair: next, transaction: transaction(workingPair, next, mutation) }
      },
    })

    expect(await repositorySnapshot(root)).toEqual(before)
    expect(restored.pair.definition.revision).not.toBe(restored.pair.definition.savedRevision)
    expect(restored.pair.companion?.revision).not.toBe(restored.pair.companion?.savedRevision)
    const history = recordTransaction(createHistoryState(), restored.transaction!)
    expect(history.undo).toHaveLength(1)
    const undone = undoTransaction(history, restored.pair)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.pair.definition.text).toBe(pair.definition.text)
    expect(undone.pair.companion?.text).toBe(pair.companion?.text)
    const redone = redoTransaction(undone.history, undone.pair)
    expect(redone.ok).toBe(true)
    if (!redone.ok) return
    expect(redone.pair.definition.text).toBe('name: Historical\n')
    expect(redone.pair.companion?.text).toBe('profile: historical\n')
    expect(await repositorySnapshot(root)).toEqual(before)
  })
})

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
}

async function repositorySnapshot(root: string) {
  const gitDirectory = git(root, 'rev-parse', '--absolute-git-dir').trim()
  return {
    head: git(root, 'rev-parse', 'HEAD'),
    branch: git(root, 'symbolic-ref', '--short', 'HEAD'),
    status: git(root, 'status', '--porcelain=v2', '-z', '--untracked-files=all'),
    index: await readFile(join(gitDirectory, 'index')),
    definition: await readFile(join(root, 'flow.yaml')),
    companion: await readFile(join(root, 'flow.hermes.yaml')),
    unrelated: await readFile(join(root, 'unrelated.txt')),
  }
}

function currentPair(): WorkflowPairText {
  return {
    workflowId: 'workspace:flow.yaml',
    generation: 1,
    savedGeneration: 1,
    definition: {
      id: 'definition',
      kind: 'definition',
      path: 'flow.yaml',
      text: 'name: Current\n',
      revision: 4,
      savedRevision: 4,
      diskHash: 'definition',
    },
    companion: {
      id: 'companion',
      kind: 'companion',
      path: 'flow.hermes.yaml',
      text: 'profile: current\n',
      revision: 5,
      savedRevision: 5,
      diskHash: 'companion',
    },
  }
}

function transaction(
  before: WorkflowPairText,
  after: WorkflowPairText,
  mutation: Extract<import('$src/lib/yaml/mutations').WorkflowMutation, { type: 'replace-document' }>,
): YamlTransaction {
  return {
    mutation,
    label: `Replace ${mutation.document}`,
    workflowId: before.workflowId,
    pairGeneration: before.generation,
    before: { definition: before.definition.text, companion: before.companion?.text ?? null },
    after: { definition: after.definition.text, companion: after.companion?.text ?? null },
    beforeRevisions: { definition: before.definition.revision, companion: before.companion?.revision ?? null },
    afterRevisions: { definition: after.definition.revision, companion: after.companion?.revision ?? null },
    selection: { document: mutation.document },
  }
}
