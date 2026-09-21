import { describe, expect, it, vi } from 'vitest'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import type { WorkflowPairText } from '$src/lib/documents/types'
import { createDocumentWorkerCache, processDocumentWorkerRequest } from './document-worker'
import type { DocumentWorkerRequest, DocumentWorkerResponse, MutateDocumentRequest } from './document-worker-protocol'
import { applyWorkflowMutationInWorker } from './document-mutation-client'

class MutationEndpoint extends EventTarget {
  request: DocumentWorkerRequest | undefined
  terminated = false
  postMessage(request: DocumentWorkerRequest): void {
    this.request = request
  }
  terminate(): void {
    this.terminated = true
  }
  emit(response: DocumentWorkerResponse): void {
    this.dispatchEvent(new MessageEvent('message', { data: response }))
  }
}

function pair(): WorkflowPairText {
  return {
    workflowId: 'inspector',
    generation: 2,
    savedGeneration: 2,
    definition: {
      id: 'definition',
      kind: 'definition',
      path: 'flow.yaml',
      revision: 3,
      savedRevision: 1,
      diskHash: 'original-hash',
      text: 'name: Example\ndescription: Keep comments\nnodes:\n  - id: draft\n    prompt: "Old" # keep\n',
    },
    companion: null,
  }
}

describe('worker-owned YAML mutations', () => {
  it('patches and validates a complete transaction with original identity and comments preserved', async () => {
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'hermes-legacy')!
    const request: MutateDocumentRequest = {
      type: 'mutate',
      requestId: 'edit-1',
      pair: pair(),
      contract,
      mutation: { type: 'set-field', document: 'definition', path: ['nodes', 0, 'prompt'], value: 'New' },
    }
    await expect(processDocumentWorkerRequest(request, createDocumentWorkerCache())).resolves.toMatchObject({
      type: 'mutation',
      requestId: 'edit-1',
      workflowId: 'inspector',
      pairGeneration: 2,
      definitionRevision: 3,
      contractDigest: contract.contract_digest,
      result: {
        ok: true,
        pair: {
          definition: {
            text: 'name: Example\ndescription: Keep comments\nnodes:\n  - id: draft\n    prompt: "New" # keep\n',
            revision: 4,
            savedRevision: 1,
            diskHash: 'original-hash',
          },
        },
        analysis: { structurallyValid: true, definitionRevision: 4 },
        transaction: {
          beforeRevisions: { definition: 3, companion: null },
          afterRevisions: { definition: 4, companion: null },
        },
      },
    })
  })

  it('rejects an Inspector dependency edit that would create a self-edge', async () => {
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'hermes-legacy')!
    const request: MutateDocumentRequest = {
      type: 'mutate',
      requestId: 'edit-2',
      pair: pair(),
      contract,
      mutation: { type: 'set-field', document: 'definition', path: ['nodes', 0, 'depends_on'], value: ['draft'] },
    }
    await expect(processDocumentWorkerRequest(request, createDocumentWorkerCache())).resolves.toMatchObject({
      type: 'mutation',
      result: { ok: false, code: 'mutation_invalid_workflow' },
    })
  })

  it('waits for a matching worker transaction, ignores stale identity, and terminates its worker', async () => {
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'hermes-legacy')!
    const endpoint = new MutationEndpoint()
    let settled = false
    const pending = applyWorkflowMutationInWorker(
      pair(),
      { type: 'set-field', document: 'definition', path: ['nodes', 0, 'prompt'], value: 'Worker edit' },
      contract,
      () => endpoint,
    ).then((result) => {
      settled = true
      return result
    })
    expect(endpoint.request?.type).toBe('mutate')
    const response = await processDocumentWorkerRequest(endpoint.request!, createDocumentWorkerCache())
    if (response.type !== 'mutation') throw new Error('Expected a worker mutation result')
    endpoint.emit({ ...response, definitionRevision: 999 })
    await Promise.resolve()
    expect(settled).toBe(false)
    endpoint.emit(response)
    await expect(pending).resolves.toMatchObject({
      ok: true,
      pair: { definition: { text: expect.stringContaining('"Worker edit" # keep') } },
    })
    expect(endpoint.terminated).toBe(true)
  })

  it.each(['error', 'messageerror'])('rejects %s without falling back to main-thread patching', async (type) => {
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'hermes-legacy')!
    const endpoint = new MutationEndpoint()
    const pending = applyWorkflowMutationInWorker(
      pair(),
      { type: 'set-field', document: 'definition', path: ['nodes', 0, 'prompt'], value: 'Never committed' },
      contract,
      () => endpoint,
    )
    const assertion = expect(pending).rejects.toThrow(/worker/i)
    endpoint.dispatchEvent(new Event(type))
    await assertion
    expect(endpoint.terminated).toBe(true)
  })

  it('bounds an unresponsive worker and terminates it', async () => {
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'hermes-legacy')!
    vi.useFakeTimers()
    try {
      const endpoint = new MutationEndpoint()
      const pending = applyWorkflowMutationInWorker(
        pair(),
        { type: 'set-field', document: 'definition', path: ['name'], value: 'Never committed' },
        contract,
        () => endpoint,
      )
      const assertion = expect(pending).rejects.toThrow(/timed out/i)
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
      expect(endpoint.terminated).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
