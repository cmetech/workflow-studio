import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { loadBundledAuthoringContracts } from '../../src/lib/contract/bundled-contracts'
import { createDocumentationGuides } from '../../src/lib/docs/guide-sources'
import { buildDocumentationIndex, searchDocumentation } from '../../src/lib/docs/build-index'

const ids = [
  'workflow-packages',
  'package-folder-structure',
  'creating-a-package',
  'multiple-workflows-per-package',
  'command-resources',
  'script-resources',
  'mcp-and-supporting-resources',
  'packaged-and-external-requirements',
  'package-readiness',
  'package-versions-digests-trust',
  'preparing-packages',
  'updating-packages',
  'publishing-packages-with-git',
  'coworker-package-installation',
  'package-troubleshooting',
]
async function sources() {
  return Object.fromEntries(
    await Promise.all(ids.map(async (id) => [id + '.md', await readFile('docs/app-guides/' + id + '.md', 'utf8')])),
  )
}
it('makes each package guide searchable offline and resolves related package topics', async () => {
  const docs = await sources()
  const contract = (await loadBundledAuthoringContracts()).find((c) => c.profile === 'archon-2026-07')!
  const index = buildDocumentationIndex(contract, createDocumentationGuides(docs))
  for (const id of ids) {
    const topic = index.byId.get('guide:' + id)
    expect(topic, id).toBeDefined()
    expect(topic?.guideGroup, id).toBe('workflow-packages')
    expect(topic?.body, id).toMatch(/#guide:/)
    for (const match of docs[id + '.md']!.matchAll(/\(#guide:([a-z-]+)(?:#[a-z-]+)?\)/g))
      expect(index.byId.has('guide:' + match[1]), id + ' -> ' + match[1]).toBe(true)
  }
  expect(
    searchDocumentation(index, 'package digests', { mode: 'guides' }).some(
      (t) => t.id === 'guide:package-versions-digests-trust',
    ),
  ).toBe(true)
})
it('documents context anchors and distinguishes saved files, local preparation, and repository availability', async () => {
  const docs = await sources()
  expect(docs['script-resources.md']).toContain('## Runtime resolution')
  expect(docs['command-resources.md']).toContain('## Frontmatter and preview')
  expect(docs['package-readiness.md']).toContain('## Blocking findings')
  expect(docs['workflow-packages.md']).toMatch(/Saved/)
  expect(docs['workflow-packages.md']).toMatch(/Prepared locally/)
  expect(docs['workflow-packages.md']).toMatch(/Available from repository/)
  expect(docs['publishing-packages-with-git.md']).toMatch(/outside Studio/)
  for (const [path, text] of Object.entries(docs)) {
    expect(text, path).not.toMatch(
      /Studio (?:automatically )?(?:executes|runs scripts|pushes|publishes remotely|grants trust)/i,
    )
    expect(text, path).not.toMatch(/\bHermes\b/)
  }
})
