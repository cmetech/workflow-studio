import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'
import type { ContractDigest, DocumentAnalysis, TextDocumentState, WorkflowPairText } from '$src/lib/documents/types'
import { editDocumentText } from '$src/lib/documents/revisions'
import { DocumentClient, type DocumentClientOptions, type DocumentWorkerEndpoint } from './document-client'
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
    savedGeneration: 0,
    definition: document('definition'),
    companion: document('companion'),
  }
}

function successFor(request: AnalyzeDocumentRequest): AnalyzeDocumentResponse {
  const analysis: DocumentAnalysis = {
    workflowId: request.workflowId,
    pairGeneration: request.pairGeneration,
    definitionPath: request.definition.path,
    companionPath: request.companion?.path ?? null,
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
    definitionPath: request.definition.path,
    companionPath: request.companion?.path ?? null,
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
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>()
  private readonly messageErrorListeners = new Set<(event: MessageEvent<unknown>) => void>()

  postMessage(message: DocumentWorkerRequest): void {
    this.messages.push(message)
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') this.listeners.add(listener as (event: MessageEvent<DocumentWorkerResponse>) => void)
    if (type === 'error') this.errorListeners.add(listener as (event: ErrorEvent) => void)
    if (type === 'messageerror') this.messageErrorListeners.add(listener as (event: MessageEvent<unknown>) => void)
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') this.listeners.delete(listener as (event: MessageEvent<DocumentWorkerResponse>) => void)
    if (type === 'error') this.errorListeners.delete(listener as (event: ErrorEvent) => void)
    if (type === 'messageerror') this.messageErrorListeners.delete(listener as (event: MessageEvent<unknown>) => void)
  }

  emit(message: DocumentWorkerResponse): void {
    for (const listener of this.listeners) listener(new MessageEvent('message', { data: message }))
  }

  emitError(): void {
    for (const listener of this.errorListeners) listener(new ErrorEvent('error', { message: 'worker crashed' }))
  }

  emitMessageError(): void {
    for (const listener of this.messageErrorListeners) listener(new MessageEvent('messageerror', { data: null }))
  }

  listenerCount(): number {
    return this.listeners.size + this.errorListeners.size + this.messageErrorListeners.size
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

  it.each([
    ['runtime error', (worker: FakeWorker) => worker.emitError(), 'Document analysis worker failed.'],
    [
      'message error',
      (worker: FakeWorker) => worker.emitMessageError(),
      'Document analysis worker returned an unreadable message.',
    ],
  ] as const)('rejects registration-only work on worker %s', async (_label, fail, message) => {
    const worker = new FakeWorker()
    const client = new DocumentClient(worker)
    const registration = client.registerContract(contract)
    let rejection: Error | null = null
    void registration.catch((error: Error) => (rejection = error))

    fail(worker)
    await Promise.resolve()

    expect(rejection).toMatchObject({ message })
    expect(vi.getTimerCount()).toBe(0)
    client.dispose()
  })

  it('rejects registration-only work after the bounded registration timeout', async () => {
    const worker = new FakeWorker()
    const client = new DocumentClient(worker, { registrationTimeoutMs: 1_000 })
    const registration = client.registerContract(contract)
    let rejection: Error | null = null
    void registration.catch((error: Error) => (rejection = error))

    vi.advanceTimersByTime(999)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1)
    await Promise.resolve()

    expect(rejection).toMatchObject({ message: 'Document analysis worker contract registration timed out.' })
    expect(vi.getTimerCount()).toBe(0)
    client.dispose()
  })

  it('clears a successful registration timeout', async () => {
    const worker = new FakeWorker()
    const client = new DocumentClient(worker, { registrationTimeoutMs: 1_000 })
    const registration = client.registerContract(contract)
    const request = worker.messages[0]
    if (!request || request.type !== 'contract-register') throw new Error('missing registration request')

    worker.emit({
      type: 'contract-registered',
      requestId: request.requestId,
      contractDigest: request.contractDigest,
      profile: request.profile,
    })

    await expect(registration).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
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

  it('rejects a response for old paths after an identity-preserving rename', () => {
    const worker = new FakeWorker()
    const accepted: DocumentAnalysis[] = []
    const client = new DocumentClient(worker, { onAnalysis: (analysis) => accepted.push(analysis) })
    const initial = pair()

    client.schedule(initial, contract, 'open')
    const oldRequest = analyzeRequests(worker)[0]!
    client.schedule(
      {
        ...initial,
        definition: { ...initial.definition, path: 'renamed.yaml' },
        companion: { ...initial.companion!, path: 'renamed.hermes.yaml' },
      },
      contract,
      'open',
    )

    const newestRequest = analyzeRequests(worker)[1]!
    worker.emit({ ...successFor(oldRequest), requestId: newestRequest.requestId })
    expect(accepted).toEqual([])
    client.dispose()
  })

  it('settles the current analysis with a typed error when the worker crashes', () => {
    const worker = new FakeWorker()
    const errors: { code: string; message: string }[] = []
    const client = new DocumentClient(worker, { onError: (error) => errors.push(error) })

    client.schedule(pair(), contract, 'explicit-validate')
    worker.emitError()

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'worker_runtime_error', message: 'Document analysis worker failed.' })
    client.dispose()
    expect(worker.listenerCount()).toBe(0)
  })

  it('settles the current analysis with a typed error when the worker cannot deserialize a message', () => {
    const worker = new FakeWorker()
    const errors: { code: string; message: string }[] = []
    const client = new DocumentClient(worker, { onError: (error) => errors.push(error) })

    client.schedule(pair(), contract, 'explicit-validate')
    worker.emitMessageError()

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'worker_message_error',
      message: 'Document analysis worker returned an unreadable message.',
    })
    client.dispose()
    expect(worker.listenerCount()).toBe(0)
  })

  it.each([
    ['runtime error', (worker: FakeWorker) => worker.emitError(), 'worker_runtime_error'],
    ['message error', (worker: FakeWorker) => worker.emitMessageError(), 'worker_message_error'],
  ] as const)('cancels a debounced edit after a worker %s', (_label, fail, code) => {
    const worker = new FakeWorker()
    const errors: { code: string }[] = []
    const client = new DocumentClient(worker, { onError: (error) => errors.push(error) })

    client.schedule(pair(), contract, 'edit')
    fail(worker)
    vi.advanceTimersByTime(180)

    expect(worker.messages).toEqual([])
    expect(errors).toEqual([expect.objectContaining({ code })])
    expect(vi.getTimerCount()).toBe(0)
    client.dispose()
  })

  it('settles a debounced edit when contract registration times out after dispatch', () => {
    const worker = new FakeWorker()
    const errors: { code: string; message: string }[] = []
    const client = new DocumentClient(worker, {
      onError: (error) => errors.push(error),
      registrationTimeoutMs: 1_000,
      analysisTimeoutMs: 5_000,
    })

    client.schedule(pair(), contract, 'edit')
    vi.advanceTimersByTime(180)
    expect(worker.messages.map(({ type }) => type)).toEqual(['contract-register', 'analyze'])
    vi.advanceTimersByTime(999)
    expect(errors).toEqual([])
    vi.advanceTimersByTime(1)

    expect(errors).toEqual([
      expect.objectContaining({
        code: 'worker_timeout',
        message: 'Document analysis worker contract registration timed out.',
      }),
    ])
    expect(vi.getTimerCount()).toBe(0)
    client.dispose()
  })

  it('settles a dispatched analysis after the bounded response timeout', () => {
    const worker = new FakeWorker()
    const errors: { code: string; message: string }[] = []
    const options = {
      onError: (error: { code: string; message: string }) => errors.push(error),
      analysisTimeoutMs: 1_000,
    } as DocumentClientOptions & { analysisTimeoutMs: number }
    const client = new DocumentClient(worker, options)

    client.schedule(pair(), contract, 'explicit-validate')
    vi.advanceTimersByTime(999)
    expect(errors).toEqual([])
    vi.advanceTimersByTime(1)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'worker_timeout', message: 'Document analysis worker timed out.' })
    client.dispose()
    expect(worker.listenerCount()).toBe(0)
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
        definitionPath: 'flow.yaml',
        companionPath: null,
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
        issues: [{ code: 'dag_rule_missing', blocking: true }],
      },
    })
  })
})
