import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WorkflowProfile } from '$src/lib/contract/types'

const contractResolverTestState = vi.hoisted(() => ({
  missingActiveProfile: null as WorkflowProfile | null,
}))

vi.mock('$src/lib/contract/contract-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$src/lib/contract/contract-cache')>()
  return {
    ...actual,
    createContractCache(options: Parameters<typeof actual.createContractCache>[0]) {
      const cache = actual.createContractCache(options)
      return {
        ...cache,
        activeContract(profile: WorkflowProfile) {
          return contractResolverTestState.missingActiveProfile === profile ? undefined : cache.activeContract(profile)
        },
      }
    },
  }
})

import { executeCommand } from '$src/lib/commands/registry'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import type { WorkspaceNativeBridge } from '$src/lib/native/types'
import { clearCanvasState } from '$src/stores/canvas'
import { closeDocumentSession, $documentSession } from '$src/stores/documents'
import { createHistoryState, historyStore } from '$src/stores/history'
import { clearActiveLayout } from '$src/stores/layout'
import { showActivity, showEditorMode } from '$src/stores/shell'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'
import { $documentWorkspace } from '$src/features/documents/document-workspace-controller'
import { createDocumentWorkerCache, processDocumentWorkerRequest } from '$src/workers/document-worker'
import type { DocumentWorkerRequest, DocumentWorkerResponse } from '$src/workers/document-worker-protocol'
import App from './App.svelte'

const definitionText = `name: Profile migration
description: Exercises the rendered Inspector transaction path
nodes:
  - id: start
    bash: printf 'ok\\n'
`

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

function companionText(profile: WorkflowProfile): string {
  return `# Keep this companion comment\nlanguage_compatibility: ${profile} # Keep this field comment\n`
}

async function renderOpenWorkflow(profile: WorkflowProfile): Promise<{
  bridge: WorkspaceNativeBridge
  path: string
  rendered: { unmount(): void }
}> {
  const bridge = createBrowserBridge()
  const path = `migration-${profile}.yaml`
  await bridge.workspaceWrite({ relativePath: path, text: definitionText, expectedCurrentHash: null })
  await bridge.workspaceWrite({
    relativePath: path.replace(/\.yaml$/, '.hermes.yaml'),
    text: companionText(profile),
    expectedCurrentHash: null,
  })
  setNativeBridgeForTest(bridge)
  loadWorkspaceEntries('browser-workspace', 'Workspace', await bridge.workspaceScan())

  const rendered = render(App)
  await fireEvent.click(await screen.findByRole('treeitem', { name: new RegExp(`migration-${profile}\\.yaml`, 'i') }))
  await waitFor(() => {
    expect($documentSession.get().analysis?.structurallyValid).toBe(true)
    expect(($documentSession.get().analysis?.projection as { profile?: WorkflowProfile } | undefined)?.profile).toBe(
      profile,
    )
  })
  await fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
  await screen.findByRole('combobox', { name: 'Language compatibility' })
  return { bridge, path, rendered }
}

async function chooseProfile(profile: WorkflowProfile): Promise<void> {
  const select = screen.getByRole('combobox', { name: 'Language compatibility' })
  const option = within(select).getByRole('option', { name: profile })
  await fireEvent.change(select, { target: { value: option.getAttribute('value') } })
}

describe.sequential('App Inspector profile migration', () => {
  beforeAll(() => {
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
    if (!Range.prototype.getClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    }
    if (!Range.prototype.getBoundingClientRect) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }),
      })
    }
  })

  afterEach(() => {
    contractResolverTestState.missingActiveProfile = null
    setNativeBridgeForTest(undefined)
    clearCanvasState()
    clearWorkspace()
    closeDocumentSession()
    clearActiveLayout()
    showActivity('explorer')
    showEditorMode('visual')
    historyStore.set(createHistoryState())
    $documentWorkspace.set({
      conflict: null,
      recoveryOffers: [],
      saveOutcome: null,
      analysisError: null,
      missingChange: null,
    })
  })

  it.each([
    ['hermes-legacy', 'archon-2026-07'],
    ['archon-2026-07', 'hermes-legacy'],
  ] as const)(
    'commits %s to %s through the rendered Inspector as one contract-aware history transaction',
    async (from, to) => {
      const contracts = await loadBundledAuthoringContracts()
      const targetContract = contracts.find(({ profile }) => profile === to)!
      const { bridge, path, rendered } = await renderOpenWorkflow(from)

      try {
        const before = $documentSession.get()
        expect(historyStore.get().undo).toHaveLength(0)

        await chooseProfile(to)

        await waitFor(() => {
          expect($documentSession.get().pair?.companion?.text).toContain(`language_compatibility: ${to}`)
          expect($documentSession.get().revision?.contractDigest).toBe(targetContract.contract_digest)
          expect($documentSession.get().analysis).toMatchObject({
            structurallyValid: true,
            projection: { profile: to },
          })
        })
        expect($documentSession.get().pair?.companion?.text).toContain('# Keep this companion comment')
        expect($documentSession.get().pair?.companion?.text).toContain('# Keep this field comment')
        expect(historyStore.get().undo).toHaveLength(1)
        expect(historyStore.get().undo[0]).toMatchObject({
          before: { companion: companionText(from) },
          after: { companion: expect.stringContaining(`language_compatibility: ${to}`) },
        })
        expect($documentSession.get().pair?.definition.text).toBe(before.pair?.definition.text)

        await executeCommand('document.save', { surface: 'form', canMutate: true, hasSelection: false })
        await waitFor(async () =>
          expect((await bridge.workspaceRead(path.replace(/\.yaml$/, '.hermes.yaml'))).text).toContain(
            `language_compatibility: ${to}`,
          ),
        )
      } finally {
        rendered.unmount()
      }
    },
  )

  it('fails closed when the proposed profile has no exact active contract', async () => {
    const { bridge, path, rendered } = await renderOpenWorkflow('hermes-legacy')

    try {
      contractResolverTestState.missingActiveProfile = 'archon-2026-07'
      const before = $documentSession.get()
      const persistedBefore = await bridge.workspaceRead(path.replace(/\.yaml$/, '.hermes.yaml'))

      await chooseProfile('archon-2026-07')

      expect(
        await screen.findByText(
          'Cannot change Language compatibility to archon-2026-07 because no exact active contract is available. Activate the archon-2026-07 contract in Settings and try again.',
        ),
      ).toHaveAttribute('role', 'alert')
      expect($documentSession.get().pair).toBe(before.pair)
      expect($documentSession.get().revision?.contractDigest).toBe(before.revision?.contractDigest)
      expect($documentSession.get().analysis).toBe(before.analysis)
      expect(historyStore.get().undo).toHaveLength(0)
      expect(await bridge.workspaceRead(path.replace(/\.yaml$/, '.hermes.yaml'))).toEqual(persistedBefore)
    } finally {
      rendered.unmount()
    }
  })
})
