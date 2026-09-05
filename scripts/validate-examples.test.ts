import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateExampleResources } from './validate-examples'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workflow-studio-examples-'))
  const examples = join(root, 'examples')
  const contracts = join(root, 'contracts')
  cpSync('examples', examples, { recursive: true })
  cpSync('contracts', contracts, { recursive: true })
  return { root, examples, contracts }
}

describe('example resource validation', () => {
  it('uses the current manifest-selected contracts and validates scoped highlight identities', async () => {
    await expect(validateExampleResources()).resolves.toEqual([])
  })

  it('follows safe renamed manifest files without changing the Node adapter', async () => {
    const { root, examples, contracts } = fixture()
    try {
      const manifestPath = join(contracts, 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        contracts: Array<{ file: string; corpus_file: string }>
      }
      const entry = manifest.contracts[0]!
      renameSync(join(contracts, entry.file), join(contracts, 'renamed-contract.json'))
      renameSync(join(contracts, entry.corpus_file), join(contracts, 'renamed.corpus.json'))
      entry.file = 'renamed-contract.json'
      entry.corpus_file = 'renamed.corpus.json'
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

      await expect(validateExampleResources(examples, contracts)).resolves.toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('surfaces the production diagnostic for an invalid bundled definition', async () => {
    const { root, examples, contracts } = fixture()
    try {
      const path = join(examples, 'sequential/workflow.yaml')
      writeFileSync(path, readFileSync(path, 'utf8').replace('$prepare.output', '$missing.output'))
      const errors = await validateExampleResources(examples, contracts)
      expect(errors).toEqual([
        'sequential: Output reference "missing" must be listed directly in depends_on.',
        'sequential: highlighted node is missing.',
        'catalog IDs must be exactly minimal, sequential, parallel-fan-in, conditional, approval, bash-script, ai-tools, retry-trigger, bounded-loop, advanced-reference, loop-group-current-output, loop-group-iteration-context, loop-group-primary-sink.',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
