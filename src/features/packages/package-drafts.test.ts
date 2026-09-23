import { expect, it, vi } from 'vitest'
import { unresolvedPackageDrafts } from './package-drafts'
import type { ArtifactRecoveryDraft, RecoveryDraft } from '$src/lib/recovery/types'

const artifact = (workspaceId: string, path: string, text: string): ArtifactRecoveryDraft => ({
  schemaVersion: 2,
  recordType: 'artifact',
  artifactId: `artifact:${workspaceId}:${path}`,
  workspaceId,
  path,
  text,
  language: 'text',
  updatedAt: 'now',
  revision: 2,
  savedRevision: 1,
  diskHash: 'old',
})
it('blocks differing closed recovery drafts only for the selected workspace and package', async () => {
  const read = vi.fn(async (path: string) => ({ text: path.endsWith('saved.txt') ? 'saved' : 'disk' }))
  const paths = await unresolvedPackageDrafts({
    workspaceId: 'w',
    packageRoot: 'packages/p',
    read,
    artifactDrafts: [
      artifact('w', 'packages/p/draft.txt', 'mine'),
      artifact('w', 'packages/p/saved.txt', 'saved'),
      artifact('other', 'packages/p/foreign.txt', 'mine'),
      artifact('w', 'packages/peer/other.txt', 'mine'),
    ],
    workflowDrafts: [],
  })
  expect(paths).toEqual(['packages/p/draft.txt'])
  expect(read.mock.calls.map(([path]) => path)).toEqual(['packages/p/draft.txt', 'packages/p/saved.txt'])
})
it('includes deleted artifact and paired workflow recovery without reading another workspace', async () => {
  const document = { path: 'packages/p/main.yaml', text: 'mine', revision: 1, savedRevision: 0, diskHash: null }
  const draft: RecoveryDraft = {
    schemaVersion: 1,
    workflowId: 'workflow:w:packages/p/main.yaml',
    generation: 1,
    savedGeneration: 0,
    definition: document,
    companion: { ...document, path: 'packages/p/main.hermes.yaml' },
    updatedAt: 'now',
  }
  const read = vi.fn(async (path: string) => {
    if (path.endsWith('deleted.txt')) throw { code: 'path_not_found' }
    return { text: 'disk' }
  })
  const paths = await unresolvedPackageDrafts({
    workspaceId: 'w',
    packageRoot: 'packages/p',
    read,
    artifactDrafts: [artifact('w', 'packages/p/deleted.txt', 'mine')],
    workflowDrafts: [draft, { ...draft, workflowId: 'workflow:other:packages/p/main.yaml' }],
  })
  expect(paths).toEqual(['packages/p/deleted.txt', 'packages/p/main.hermes.yaml', 'packages/p/main.yaml'])
  expect(read).toHaveBeenCalledTimes(3)
})
