import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import legacyContractText from '../../contracts/hermes-legacy-v1.json?raw'
import { canonicalizeContractPayload, sha256Hex } from '$src/lib/contract/canonical-json'
import type { ContractCacheStoredEntry } from '$src/lib/contract/contract-cache'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import type { WorkspaceNativeBridge } from '$src/lib/native/types'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'
import { closeDocumentSession } from '$src/stores/documents'
import { createDocumentWorkerCache, processDocumentWorkerRequest } from '$src/workers/document-worker'
import type { DocumentWorkerRequest, DocumentWorkerResponse } from '$src/workers/document-worker-protocol'

type AppComponent = (typeof import('./App.svelte'))['default']

const definitionText = `name: Cached companion
description: Uses the restored active contract
nodes:
  - id: collect
    command: /collect
`

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

async function cachedLegacyEntry(): Promise<ContractCacheStoredEntry> {
  const payload = JSON.parse(legacyContractText) as Record<string, unknown>
  const sidecarSchema = payload.sidecar_schema as { properties: Record<string, unknown> }
  delete sidecarSchema.properties.language_compatibility
  payload.normalizer_version = 2
  payload.contract_digest = `sha256:${await sha256Hex(canonicalizeContractPayload(payload))}`
  const content = JSON.stringify(payload)

  return {
    digest: payload.contract_digest as `sha256:${string}`,
    profile: 'hermes-legacy',
    schemaVersion: payload.schema_version as number,
    normalizerVersion: payload.normalizer_version as number,
    readerVersion: payload.contract_reader_version as number,
    source: { kind: 'user', identifier: '/cached/hermes-legacy-v2.json' },
    content,
    active: true,
  }
}

class RealDocumentWorker {
  private readonly cache = createDocumentWorkerCache()
  private readonly listeners = new Set<(event: MessageEvent<DocumentWorkerResponse>) => void>()

  postMessage(message: DocumentWorkerRequest): void {
    void processDocumentWorkerRequest(message, this.cache).then((response) => {
      queueMicrotask(() => {
        for (const listener of this.listeners) listener(new MessageEvent('message', { data: response }))
      })
    })
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<DocumentWorkerResponse>) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<DocumentWorkerResponse>) => void): void {
    this.listeners.delete(listener)
  }

  terminate(): void {
    this.listeners.clear()
  }
}

describe('App companion contract readiness', () => {
  let App: AppComponent
  let bridge: WorkspaceNativeBridge
  const hydration = deferred<readonly ContractCacheStoredEntry[]>()
  const hydrationStarted = deferred<void>()

  beforeAll(async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
    vi.stubGlobal('Worker', RealDocumentWorker)
    bridge = createBrowserBridge()
    await bridge.workspaceWrite({ relativePath: 'existing.yaml', text: definitionText, expectedCurrentHash: null })
    setNativeBridgeForTest({
      ...bridge,
      contractCacheLoad: () => {
        hydrationStarted.resolve()
        return hydration.promise
      },
    })
    App = (await import('./App.svelte')).default
  }, 30_000)

  afterEach(() => {
    clearWorkspace()
    closeDocumentSession()
  })

  afterAll(() => {
    hydration.resolve([])
    setNativeBridgeForTest(undefined)
    vi.unstubAllGlobals()
  })

  it('waits for hydration and creates YAML from the exact restored active same-profile contract', async () => {
    loadWorkspaceEntries('browser-workspace', 'Workspace', await bridge.workspaceScan())
    const rendered = render(App)

    try {
      await hydrationStarted.promise
      await fireEvent.contextMenu(screen.getByRole('treeitem', { name: /existing.yaml, legacy workflow/i }))

      const createCompanion = screen.getByRole('menuitem', { name: 'Create Companion' })
      expect(createCompanion).toBeDisabled()
      await expect(bridge.workspaceRead('existing.hermes.yaml')).rejects.toMatchObject({ code: 'path_not_found' })

      hydration.resolve([await cachedLegacyEntry()])
      await waitFor(() => expect(createCompanion).toBeEnabled())
      await fireEvent.click(createCompanion)

      let companionText: string | null = null
      await waitFor(async () => {
        companionText = await bridge
          .workspaceRead('existing.hermes.yaml')
          .then(({ text }) => text)
          .catch(() => null)
        expect(companionText).not.toBeNull()
      })
      expect(companionText).toBe('{}\n')
      expect(companionText).not.toContain('language_compatibility')
    } finally {
      rendered.unmount()
      hydration.resolve([])
    }
  })
})
