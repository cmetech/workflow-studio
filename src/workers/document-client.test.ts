import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { ContractDigest, DocumentAnalysis, TextDocumentState, WorkflowPairText } from '$src/lib/documents/types'
import { editDocumentText } from '$src/lib/documents/revisions'
import { DocumentClient, type DocumentWorkerEndpoint } from './document-client'
import type {
  AnalyzeDocumentRequest,
  AnalyzeDocumentResponse,
  DocumentWorkerRequest,
  DocumentWorkerResponse,
} from './document-worker-protocol'
import { createDocumentWorkerCache, processDocumentWorkerRequest } from './document-worker'

const contractDigest = `sha256:${'a'.repeat(64)}` as ContractDigest

const contract: AuthoringContract = {
  schema_version: 1,
  contract_reader_version: 1,
  profile: 'archon-2026-07',
  normalizer_version: 1,
  contract_digest: contractDigest,
  definition_schema: {},
  sidecar_schema: {},
  node_kinds: [],
  semantic_rules: [],
  compatibility_codes: {},
  documentation: { topics: [], examples: [] },
  limits: { max_document_bytes: 2 * 1024 * 1024 },
  extensions: {},
}

function document(kind: 'definition' | 'companion'): TextDocumentState {
  return {
    id: kind,
    kind,
    path: kind === 'definition' ? 'flow.yaml' : 'flow.hermes.yaml',
    text: `${kind}: value\n`,
    revision: 0,
    savedRevision: 0,
    diskHash: `hash-${kind}`,
  }
}

function pair(): WorkflowPairText {
  return {
    workflowId: 'flow',
    generation: 0,
    definition: document('definition'),
    companion: document('companion'),
  }
}

function successFor(request: AnalyzeDocumentRequest): AnalyzeDocumentResponse {
  const analysis: DocumentAnalysis = {
    workflowId: request.workflowId,
    pairGeneration: request.pairGeneration,
    definitionRevision: request.definition.revision,
    companionRevision: request.companion?.revision ?? null,
    contractDigest: request.contractDigest,
    issues: [],
    structurallyValid: true,
    projection: { name: request.workflowId },
  }

  return {
    type: 'analysis',
    requestId: request.requestId,
    workflowId: request.workflowId,
    pairGeneration: request.pairGeneration,
    definitionRevision: request.definition.revision,
    companionRevision: request.companion?.revision ?? null,
    profile: request.profile,
    contractDigest: request.contractDigest,
    reason: request.reason,
    analysis,
  }
}

class FakeWorker implements DocumentWorkerEndpoint {
  readonly messages: DocumentWorkerRequest[] = []
  private readonly listeners = new Set<(event: MessageEvent<DocumentWorkerResponse>) => void>()

  postMessage(message: DocumentWorkerRequest): void {
    this.messages.push(message)
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<DocumentWorkerResponse>) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<DocumentWorkerResponse>) => void): void {
    this.listeners.delete(listener)
  }

  emit(message: DocumentWorkerResponse): void {
    for (const listener of this.listeners) listener(new MessageEvent('message', { data: message }))
  }
}

function analyzeRequests(worker: FakeWorker): AnalyzeDocumentRequest[] {
  return worker.messages.filter((message): message is AnalyzeDocumentRequest => message.type === 'analyze')
}

describe('DocumentClient', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces edits for 180ms and replaces only a pending timer', () => {
    const worker = new FakeWorker()
    const client = new DocumentClient(worker)
    const initial = pair()

    client.schedule(initial, contract, 'edit')
    vi.advanceTimersByTime(179)
    expect(analyzeRequests(worker)).toHaveLength(0)

    const edited = editDocumentText(initial, 'definition', 'name: newest\n')
    client.schedule(edited, contract, 'edit')
    vi.advanceTimersByTime(179)
    expect(analyzeRequests(worker)).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(analyzeRequests(worker)).toHaveLength(1)
    expect(analyzeRequests(worker)[0]?.definition).toMatchObject({ text: 'name: newest\n', revision: 1 })
    client.dispose()
  })

  it.each(['open', 'explicit-validate', 'contract-change'] as const)('dispatches %s analysis immediately', (reason) => {
    const worker = new FakeWorker()
    const client = new DocumentClient(worker)

    client.schedule(pair(), contract, reason)

    expect(analyzeRequests(worker)).toHaveLength(1)
    expect(analyzeRequests(worker)[0]?.reason).toBe(reason)
    client.dispose()
  })

  it('registers a validated contract once per digest before analysis', () => {
    const worker = new FakeWorker()
    const client = new DocumentClient(worker)

    client.schedule(pair(), contract, 'open')
    client.schedule(pair(), contract, 'explicit-validate')

    expect(worker.messages.map((message) => message.type)).toEqual(['contract-register', 'analyze', 'analyze'])
    expect(worker.messages[0]).toMatchObject({ contractDigest, contract })
    client.dispose()
  })

  it('keeps dispatched work running and ignores its response after a newer revision is scheduled', () => {
    const worker = new FakeWorker()
    const accepted: DocumentAnalysis[] = []
    const client = new DocumentClient(worker, { onAnalysis: (analysis) => accepted.push(analysis) })
    const initial = pair()

    client.schedule(initial, contract, 'open')
    const first = analyzeRequests(worker)[0]
    if (!first) throw new Error('missing first request')

    const edited = editDocumentText(initial, 'definition', 'name: newest\n')
    client.schedule(edited, contract, 'explicit-validate')
    const second = analyzeRequests(worker)[1]
    if (!second) throw new Error('missing second request')

    worker.emit(successFor(first))
    expect(accepted).toEqual([])

    worker.emit(successFor(second))
    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.definitionRevision).toBe(1)
    expect(analyzeRequests(worker)).toHaveLength(2)
    client.dispose()
  })
})

describe('document worker protocol', () => {
  it('returns a typed missing-contract response without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const request: AnalyzeDocumentRequest = {
      type: 'analyze',
      requestId: 'request-1',
      workflowId: 'flow',
      pairGeneration: 0,
      definition: { path: 'flow.yaml', text: 'name: Flow\n', revision: 0 },
      companion: null,
      profile: 'archon-2026-07',
      contractDigest,
      reason: 'open',
    }

    try {
      await expect(processDocumentWorkerRequest(request, createDocumentWorkerCache())).resolves.toEqual({
        type: 'analysis-error',
        requestId: 'request-1',
        workflowId: 'flow',
        pairGeneration: 0,
        definitionRevision: 0,
        companionRevision: null,
        profile: 'archon-2026-07',
        contractDigest,
        reason: 'open',
        code: 'contract_not_registered',
        message: 'The requested authoring contract is not registered in this worker.',
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('caches registered contracts and echoes analysis identity exactly', async () => {
    const cache = createDocumentWorkerCache()
    await processDocumentWorkerRequest(
      {
        type: 'contract-register',
        requestId: 'register-1',
        contractDigest,
        profile: contract.profile,
        contract,
      },
      cache,
    )
    const request: AnalyzeDocumentRequest = {
      type: 'analyze',
      requestId: 'request-2',
      workflowId: 'flow',
      pairGeneration: 3,
      definition: { path: 'flow.yaml', text: 'name: Flow\n', revision: 7 },
      companion: { path: 'flow.hermes.yaml', text: 'language_compatibility: archon-2026-07\n', revision: 4 },
      profile: 'archon-2026-07',
      contractDigest,
      reason: 'explicit-validate',
    }

    const response = await processDocumentWorkerRequest(request, cache)

    expect(response).toMatchObject({
      type: 'analysis',
      requestId: 'request-2',
      workflowId: 'flow',
      pairGeneration: 3,
      definitionRevision: 7,
      companionRevision: 4,
      profile: 'archon-2026-07',
      contractDigest,
      reason: 'explicit-validate',
      analysis: {
        workflowId: 'flow',
        pairGeneration: 3,
        definitionRevision: 7,
        companionRevision: 4,
        contractDigest,
        structurallyValid: false,
        issues: [{ code: 'analysis_not_implemented', blocking: true }],
      },
    })
  })
})
