import loop24ManifestSource from '../../brands/loop24/brand.yaml?raw'
import type { WorkspaceNativeBridge } from '$src/lib/native/types'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import type { ProgressSnapshot } from '$src/lib/progress/types'
import type { GitPathStatus } from '$src/lib/git/types'
import type { UpdateEvent, UpdateEventHandler, UpdateSnapshot } from '$src/lib/updates/types'
import { $documentSession } from '$src/stores/documents'
import { createLargeWorkflowFixture } from '../../tests/performance/large-workflow'

const DEFINITION_PATH = 'workflows/release-demo.yaml'
const COMPANION_PATH = 'workflows/release-demo.hermes.yaml'
const AUTHORING_FILES = {
  [DEFINITION_PATH]: `name: Release demo
description: Verify the complete authoring path.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
`,
  [COMPANION_PATH]: `language_compatibility: archon-2026-07
tags: [release, e2e]
`,
} as const

interface E2EState {
  readonly scenario: string
  readonly setupRetries: number
  readonly updateChecks: number
  readonly updateDeferred: boolean
  readonly pairVersioned: boolean
  readonly unrelatedChangePresent: boolean
  readonly gitVersionRequest: {
    readonly root: string
    readonly definitionPath: string
    readonly companionPath: string | null
    readonly message: string
    readonly authorizationToken: string
  } | null
  readonly gitStatusEntries: readonly GitPathStatus[]
  readonly updateInstallRequests: number
  readonly updateCancelled: boolean
  readonly updateInstalled: boolean
  readonly updateRelaunched: boolean
  readonly activeBrandId: string
  readonly definitionText: string
  readonly companionText: string
  readonly workspacePaths: readonly string[]
  readonly layout: string | null
}

declare global {
  interface Window {
    __WORKFLOW_STUDIO_E2E__?: { snapshot(): Promise<E2EState> }
  }
}

function setupFailure(): ProgressSnapshot {
  return {
    runId: 'e2e-setup',
    sequence: 4,
    startedAt: 1_753_441_200_000,
    status: 'failed',
    cancellable: false,
    currentStageId: null,
    stages: [
      { id: 'app-data', label: 'Prepare application data', status: 'succeeded', durationMs: 4 },
      { id: 'resources', label: 'Verify bundled resources', status: 'failed', durationMs: 3 },
      { id: 'git', label: 'Detect Git', status: 'pending' },
    ],
    logs: ['Prepared app-data directories.', 'Resource digest mismatch in deterministic fixture.'],
    failure: { code: 'fixture_resource_failure', message: 'Bundled resource verification failed.' },
    savedLogAvailable: true,
  }
}

function setupSuccess(): ProgressSnapshot {
  return {
    runId: 'e2e-setup-retry',
    sequence: 8,
    startedAt: 1_753_441_201_000,
    status: 'succeeded',
    cancellable: false,
    currentStageId: null,
    stages: [
      { id: 'app-data', label: 'Prepare application data', status: 'succeeded', durationMs: 4 },
      { id: 'resources', label: 'Verify bundled resources', status: 'succeeded', durationMs: 3 },
      { id: 'git', label: 'Detect Git', status: 'succeeded', durationMs: 2 },
      { id: 'workspace', label: 'Restore workspace', status: 'succeeded', durationMs: 2 },
      { id: 'ready', label: 'Verify readiness', status: 'succeeded', durationMs: 1 },
    ],
    logs: ['All bundled resources verified.', 'Workflow Studio is ready.'],
    failure: null,
    savedLogAvailable: true,
  }
}

const UPDATE_RELEASE = {
  version: '0.2.0',
  notes: 'Deterministic signed updater acceptance fixture.',
  date: '2026-07-30T12:00:00Z',
  size: 4_096,
  platform: 'macos-aarch64',
} as const

function updateSnapshot(phase: UpdateSnapshot['phase'], sequence?: number): UpdateSnapshot {
  const failed = phase === 'failed'
  return {
    runId: 'e2e-update',
    sequence: sequence ?? (failed ? 3 : phase === 'available' ? 4 : 5),
    startedAt: 1_753_441_202_000,
    phase,
    cancellable: phase === 'downloading',
    release: UPDATE_RELEASE,
    downloadedBytes: 0,
    totalBytes: UPDATE_RELEASE.size,
    speedBytesPerSecond: null,
    logs: failed
      ? ['Downloaded metadata.', 'Signature fixture rejected before installation.']
      : ['Signed update available.'],
    failure: failed ? { code: 'fixture_signature_failure', message: 'Update signature verification failed.' } : null,
    savedLogAvailable: true,
    message: null,
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function installRuntimeBootstrap(): Promise<void> {
  const scenario = new URLSearchParams(location.search).get('scenario') ?? 'authoring'
  const largeCanvasFixture = scenario === 'large-canvas' ? createLargeWorkflowFixture() : null
  const initialFiles = largeCanvasFixture
    ? { ...AUTHORING_FILES, [DEFINITION_PATH]: largeCanvasFixture.yaml }
    : AUTHORING_FILES
  const base = createBrowserBridge({ initialFiles, selectedRoot: '/e2e/workspace' })
  let setupRetries = 0
  let updateChecks = 0
  let updateDeferred = false
  let pairVersioned = false
  let gitStatusEntries: GitPathStatus[] = [
    { path: DEFINITION_PATH, index: ' ', worktree: 'M', untracked: false },
    { path: 'notes/unrelated.txt', index: 'M', worktree: ' ', untracked: false },
  ]
  let gitVersionRequest: E2EState['gitVersionRequest'] = null
  let updateInstallRequests = 0
  let updateCancelled = false
  let updateInstalled = false
  let updateRelaunched = false
  const updateHandlers = new Set<UpdateEventHandler>()
  let layout: string | null = largeCanvasFixture
    ? JSON.stringify([
        {
          schemaVersion: 1,
          layout: {
            ...largeCanvasFixture.layout,
            workspaceId: 'browser-workspace',
            workflowPath: DEFINITION_PATH,
            viewport: { x: 80, y: 80, zoom: 1 },
          },
          savedHashes: null,
        },
      ])
    : null
  let brandSelection = 0
  let activeBrandId = 'loop24'

  const validManifest = loop24ManifestSource
    .replace('id: loop24', 'id: northstar')
    .replace('displayName: LOOP24 Workflow Studio', 'displayName: Northstar Studio')
  const maliciousManifest = validManifest.replace('logo: logo.svg', 'logo: https://attacker.invalid/logo.svg')
  const assetBytes = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path fill="#2455AA" d="M0 0h2v2z"/></svg>',
  )
  const assetHash = await sha256(assetBytes)
  const validManifestHash = await sha256(new TextEncoder().encode(validManifest))
  const maliciousManifestHash = await sha256(new TextEncoder().encode(maliciousManifest))

  const emitUpdate = async (event: UpdateEvent): Promise<void> => {
    await Promise.all([...updateHandlers].map((handler) => handler(event)))
  }

  const wait = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds))

  const runUpdateLifecycle = async (): Promise<void> => {
    await emitUpdate({
      type: 'download',
      runId: 'e2e-update',
      sequence: 7,
      timestamp: 1_753_441_202_200,
      downloadedBytes: UPDATE_RELEASE.size / 2,
      totalBytes: UPDATE_RELEASE.size,
      speedBytesPerSecond: 2_048,
    })
    if (scenario === 'setup-update-cancel' || updateCancelled) return

    await wait(250)
    await emitUpdate({
      type: 'phase',
      runId: 'e2e-update',
      sequence: 8,
      timestamp: 1_753_441_202_300,
      phase: 'verifying',
      cancellable: false,
    })
    await wait(250)
    await emitUpdate({
      type: 'phase',
      runId: 'e2e-update',
      sequence: 9,
      timestamp: 1_753_441_202_400,
      phase: 'installing',
      cancellable: false,
    })
    await wait(250)
    updateInstalled = true
    await emitUpdate({
      type: 'phase',
      runId: 'e2e-update',
      sequence: 10,
      timestamp: 1_753_441_202_500,
      phase: 'restart-required',
      cancellable: false,
    })
  }

  const bridge: WorkspaceNativeBridge = {
    ...base,
    setupStatus: async () =>
      scenario === 'setup-update' && setupRetries === 0
        ? { ready: false, snapshot: setupFailure() }
        : { ready: true, snapshot: null },
    setupStart: async () => {
      setupRetries += 1
      return setupSuccess()
    },
    updateStatus: async () => ({
      snapshot:
        scenario === 'setup-update'
          ? updateSnapshot('failed')
          : scenario === 'setup-update-cancel'
            ? updateSnapshot('available')
            : updateSnapshot('current'),
      startupCheckEnabled: false,
    }),
    updateCheck: async () => {
      updateChecks += 1
      return updateSnapshot('available')
    },
    updateDownloadInstall: async () => {
      updateInstallRequests += 1
      updateCancelled = false
      await emitUpdate({
        type: 'log',
        runId: 'e2e-update',
        sequence: 6,
        timestamp: 1_753_441_202_100,
        line: 'Download claim established.',
      })
      window.setTimeout(() => void runUpdateLifecycle(), 50)
      return updateSnapshot('downloading', 5)
    },
    updateCancel: async () => {
      updateCancelled = true
      await emitUpdate({
        type: 'phase',
        runId: 'e2e-update',
        sequence: 8,
        timestamp: 1_753_441_202_350,
        phase: 'cancelling',
        cancellable: false,
      })
      window.setTimeout(
        () =>
          void emitUpdate({
            type: 'phase',
            runId: 'e2e-update',
            sequence: 9,
            timestamp: 1_753_441_202_450,
            phase: 'recheck-required',
            cancellable: false,
            message: 'Cancellation finished. Run a fresh update check.',
          }),
        50,
      )
      return true
    },
    updateRelaunch: async () => {
      updateRelaunched = true
    },
    onUpdateEvent: async (handler) => {
      updateHandlers.add(handler)
      return () => updateHandlers.delete(handler)
    },
    updateDefer: async () => {
      updateDeferred = true
      return updateSnapshot('deferred')
    },
    gitDetect: async () => ({ root: '/e2e/workspace', branch: 'base', detachedHead: null }),
    gitStatus: async () => ({ entries: gitStatusEntries.map((entry) => ({ ...entry })) }),
    gitDiffPair: async () => ({
      working: pairVersioned ? '' : 'diff --git a/workflows/release-demo.yaml b/workflows/release-demo.yaml\n',
      index: '',
      authorizationToken: 'e2e-version-authorization',
    }),
    gitHistoryPair: async () => ({
      commits: pairVersioned
        ? [
            {
              oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              shortOid: 'aaaaaaaaaaaa',
              authorName: 'Workflow Tester',
              authoredAt: '2026-07-30T12:00:00Z',
              subject: 'Verify release workflow',
            },
          ]
        : [],
      authorizationToken: 'e2e-history-authorization',
    }),
    gitRetainHistoryAuthorization: async () => undefined,
    gitRetainVersionAuthorization: async () => undefined,
    gitCreatePairVersion: async (root, definitionPath, companionPath, message, authorizationToken) => {
      gitVersionRequest = { root, definitionPath, companionPath, message, authorizationToken }
      if (
        root !== '/e2e/workspace' ||
        definitionPath !== DEFINITION_PATH ||
        companionPath !== COMPANION_PATH ||
        message !== 'Verify release workflow' ||
        authorizationToken !== 'e2e-version-authorization'
      ) {
        throw new Error('The E2E version request escaped the exact workflow-pair authorization.')
      }
      pairVersioned = true
      const pairPaths = new Set([definitionPath, ...(companionPath ? [companionPath] : [])])
      gitStatusEntries = gitStatusEntries.filter(({ path }) => !pairPaths.has(path))
      return {
        outcome: 'committed',
        oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: { entries: gitStatusEntries.map((entry) => ({ ...entry })) },
        warnings: [],
      }
    },
    gitIsTracked: async () => true,
    brandChooseSource: async () => {
      brandSelection += 1
      const malicious = brandSelection === 1
      return {
        grantToken: malicious ? 'e2e-malicious-brand' : 'e2e-valid-brand',
        manifestText: malicious ? maliciousManifest : validManifest,
        manifestSha256: malicious ? maliciousManifestHash : validManifestHash,
      }
    },
    brandReadSourceAssets: async (_token, paths) =>
      paths.map((path) => ({ path, bytes: [...assetBytes], sha256: assetHash })),
    brandActivate: async (id) => {
      const activated = await base.brandActivate(id)
      activeBrandId = id
      return activated
    },
    layoutLoad: async () => layout,
    layoutSave: async (content) => {
      layout = content
    },
    onWorkspaceChanged: async () => () => undefined,
  }

  setNativeBridgeForTest(bridge)
  window.__WORKFLOW_STUDIO_E2E__ = {
    async snapshot(): Promise<E2EState> {
      const openPair = $documentSession.get().pair
      const definitionText = openPair?.definition.text ?? (await bridge.workspaceRead(DEFINITION_PATH)).text
      const companionText = openPair?.companion?.text ?? (await bridge.workspaceRead(COMPANION_PATH)).text
      const workspacePaths = (await bridge.workspaceScan())
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.relativePath)
        .sort()
      return {
        scenario,
        setupRetries,
        updateChecks,
        updateDeferred,
        pairVersioned,
        unrelatedChangePresent: gitStatusEntries.some(({ path }) => path === 'notes/unrelated.txt'),
        gitVersionRequest,
        gitStatusEntries: gitStatusEntries.map((entry) => ({ ...entry })),
        updateInstallRequests,
        updateCancelled,
        updateInstalled,
        updateRelaunched,
        activeBrandId,
        definitionText,
        companionText,
        workspacePaths,
        layout,
      }
    },
  }
}
