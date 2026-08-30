import loop24ManifestSource from '../../brands/loop24/brand.yaml?raw'
import type { WorkspaceChangedHandler, WorkspaceNativeBridge } from '$src/lib/native/types'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import type { ProgressSnapshot } from '$src/lib/progress/types'
import type { GitPathStatus } from '$src/lib/git/types'
import type { UpdateEvent, UpdateEventHandler, UpdateSnapshot } from '$src/lib/updates/types'
import { canonicalizeContractPayload } from '$src/lib/contract/canonical-json'
import type { ContractCacheStoredEntry } from '$src/lib/contract/contract-cache'
import { loadBrandManifest } from '$src/lib/branding/load-brand'
import type { StoredBrandPack } from '$src/lib/native/types'
import { createEditorMetricsCollector, installEditorMetrics } from '$src/lib/metrics/editor-metrics'
import { isWorkflowProjection } from '$src/features/canvas/project-canvas'
import { $documentSession } from '$src/stores/documents'
import { historyStore } from '$src/stores/history'

const DEFINITION_PATH = 'workflows/release-demo.yaml'
const COMPANION_PATH = 'workflows/release-demo.hermes.yaml'
const LONG_WINDOWS_ROOT = 'C:\\workspaces\\release\\nested\\workflow-studio-with-a-long-workspace-identity'
const LONG_WINDOWS_PATH =
  'C:\\workspaces\\release\\nested\\workflow-definitions\\international\\release-demo-with-an-exceptionally-long-name.yaml'
const LONG_GIT_SUBJECT =
  'Document the exceptionally long Windows release workflow subject without widening the Git workbench page'
const UNBROKEN_GIT_REF = 'r'.repeat(200)
const LONG_APPLICATION_NOTICE = `Could not open the selected workspace.\n${Array.from(
  { length: 30 },
  (_, index) =>
    `Path ${index + 1}: C:\\release-workspaces\\${'deeply-nested-workflow-directory\\'.repeat(4)}definition.yaml — permission denied`,
).join('\n')}`
const LONG_CREATE_VERSION_YAML = `${Array.from(
  { length: 24 },
  (_, index) => `future_setting_${index + 1}: preserved-${index + 1}`,
).join('\n')}
name: Long Create Version
description: Deterministic long findings fixture.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
`
const LONG_CREATE_VERSION_DIFF = `diff --git a/workflows/release-demo.yaml b/workflows/release-demo.yaml
--- a/workflows/release-demo.yaml
+++ b/workflows/release-demo.yaml
${Array.from({ length: 48 }, (_, index) => `+release-${index + 1}: ${'content-aware-workbench-'.repeat(5)}`).join('\n')}
`
const REPEATED_DIAGNOSTICS_YAML = `name: Repeated diagnostics
description: Exercise bounded Problems rendering.
nodes:
${Array.from({ length: 40 }, (_, index) => `  - id: duplicate\n    prompt: Diagnostic ${index + 1}.\n`).join('')}`
const ADVANCED_INSPECTOR_YAML = `name: Advanced Inspector
description: Exercise the complete bounded Advanced field surface.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
    provider: deterministic-provider
    model: deterministic-model-with-a-long-contained-identity
    effort: high
    fallbackModel: deterministic-fallback-model
    maxBudgetUsd: 12.5
    persist_session: true
    allowed_tools: [read_file, search_workspace]
    denied_tools: [network_write]
    skills: [release-review, offline-verification]
    systemPrompt: Keep every advanced inspector field deterministic and locally bounded.
    mcp: local-fixture
    betas: [content-aware-workbench]
    output_type: release-summary
  - id: publish
    command: /publish
    depends_on: [prepare]
`
const LONG_SETUP_LOGS = Array.from(
  { length: 12 },
  (_, index) =>
    `deterministic-setup-log-${index + 1}: deeply nested offline resource verification path ${'contracts/resources/loop24/'.repeat(5)}`,
)
const LONG_UPDATE_LOGS = Array.from(
  { length: 12 },
  (_, index) =>
    `deterministic-update-log-${index + 1}: signed updater verification message ${'macos/aarch64/offline/staging/'.repeat(5)}`,
)

function capacityWorkflowYaml(): string {
  const ids = Array.from({ length: 250 }, (_, index) => `node-${String(index).padStart(3, '0')}`)
  const incoming = new Map<string, string[]>()
  const connect = (sourceIndex: number, targetIndex: number): void => {
    const target = ids[targetIndex]!
    incoming.set(target, [...(incoming.get(target) ?? []), ids[sourceIndex]!])
  }
  for (let source = 0; source < ids.length - 1; source += 1) connect(source, source + 1)
  for (let source = 0; source < ids.length - 2; source += 1) {
    if (source !== 24) connect(source, source + 2)
  }
  for (let source = 0; source < 4; source += 1) connect(source, source + 3)

  return [
    'name: Fixed 250-node performance workflow',
    'description: Deterministic content-aware workbench capacity fixture.',
    'nodes:',
    ...ids.flatMap((id) => [
      `  - id: ${id}`,
      '    command: /capacity-step',
      ...(incoming.has(id)
        ? ['    depends_on:', ...incoming.get(id)!.map((dependency) => `      - ${dependency}`)]
        : []),
    ]),
    '',
  ].join('\n')
}

function capacityLayout() {
  const ids = Array.from({ length: 250 }, (_, index) => `node-${String(index).padStart(3, '0')}`)
  return {
    schemaVersion: 1 as const,
    workspaceId: 'browser-workspace',
    workflowPath: DEFINITION_PATH,
    nodePositions: Object.fromEntries(
      ids.map((id, index) => [id, { x: (index % 25) * 280, y: Math.floor(index / 25) * 150 }]),
    ),
    viewport: { x: 0, y: 0, zoom: 0.2 },
    panels: { left: 280, right: 320, problems: 180 },
    editorMode: 'visual' as const,
    updatedAt: '2026-08-30T00:00:00.000Z',
  }
}
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
  readonly definitionRevision: number
  readonly undoDepth: number
  readonly companionText: string
  readonly workspacePaths: readonly string[]
  readonly layout: string | null
  readonly projectionNodeCount: number
  readonly projectionEdgeCount: number
}

declare global {
  interface Window {
    __WORKFLOW_STUDIO_E2E__?: {
      snapshot(): Promise<E2EState>
      triggerExternalChange(): Promise<void>
      prepareCapacityConnection(): Promise<void>
      metrics(): ReturnType<ReturnType<typeof createEditorMetricsCollector>['snapshot']>
      resetMetrics(): void
    }
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
    logs: ['Prepared app-data directories.', 'Resource digest mismatch in deterministic fixture.', ...LONG_SETUP_LOGS],
    failure: {
      code: 'fixture_resource_failure',
      message: `Bundled resource verification failed. ${'deeply nested offline resource verification path '.repeat(8)}`,
    },
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
  notes: `Deterministic signed updater acceptance fixture. ${'signed updater verification message '.repeat(12)}`,
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
      ? ['Downloaded metadata.', 'Signature fixture rejected before installation.', ...LONG_UPDATE_LOGS]
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
  const largeCanvasLayout = scenario === 'large-canvas' ? capacityLayout() : null
  const metrics = createEditorMetricsCollector()
  installEditorMetrics(metrics)
  const largeCanvasDefinition = largeCanvasLayout
    ? `${Array.from({ length: 8 }, (_, index) => `future_large_canvas_finding_${index + 1}: retained`).join('\n')}\n${capacityWorkflowYaml()}`
    : null
  const initialFiles = largeCanvasLayout
    ? {
        ...AUTHORING_FILES,
        [DEFINITION_PATH]: largeCanvasDefinition!,
        [COMPANION_PATH]: 'language_compatibility: hermes-legacy\ntags: [release, e2e]\n',
      }
    : scenario === 'long-create-version'
      ? {
          ...AUTHORING_FILES,
          [DEFINITION_PATH]: LONG_CREATE_VERSION_YAML,
          [COMPANION_PATH]: 'language_compatibility: hermes-legacy\ntags: [release, e2e]\n',
        }
      : scenario === 'repeated-diagnostics'
        ? { ...AUTHORING_FILES, [DEFINITION_PATH]: REPEATED_DIAGNOSTICS_YAML }
        : scenario === 'advanced-inspector'
          ? { ...AUTHORING_FILES, [DEFINITION_PATH]: ADVANCED_INSPECTOR_YAML }
          : AUTHORING_FILES
  const selectedRoot = scenario === 'long-git' ? LONG_WINDOWS_ROOT : '/e2e/workspace'
  const base = createBrowserBridge({ initialFiles, selectedRoot })
  let setupRetries = 0
  let updateChecks = 0
  let updateDeferred = false
  let pairVersioned = false
  let gitStatusEntries: GitPathStatus[] =
    scenario === 'long-git'
      ? [
          {
            path: DEFINITION_PATH,
            originalPath: LONG_WINDOWS_PATH,
            index: 'R',
            worktree: ' ',
            untracked: false,
          },
          { path: 'notes/unrelated.txt', index: 'M', worktree: ' ', untracked: false },
        ]
      : [
          { path: DEFINITION_PATH, index: ' ', worktree: 'M', untracked: false },
          { path: 'notes/unrelated.txt', index: 'M', worktree: ' ', untracked: false },
        ]
  let gitVersionRequest: E2EState['gitVersionRequest'] = null
  let updateInstallRequests = 0
  let updateCancelled = false
  let updateInstalled = false
  let updateRelaunched = false
  const updateHandlers = new Set<UpdateEventHandler>()
  const workspaceChangeHandlers = new Set<WorkspaceChangedHandler>()
  let layout: string | null = largeCanvasLayout
    ? JSON.stringify([
        {
          schemaVersion: 1,
          layout: {
            ...largeCanvasLayout,
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
  const bundledManifest = loadBrandManifest(loop24ManifestSource)
  const longBrandPacks: readonly StoredBrandPack[] = Array.from({ length: 12 }, (_, index) => ({
    manifest: {
      ...bundledManifest,
      id: `deterministic-brand-${String(index + 1).padStart(2, '0')}`,
      displayName: `Deterministic brand ${String(index + 1).padStart(2, '0')} ${'contained-name-'.repeat(5)}`,
    },
    assets: [
      { path: 'logo.svg', bytes: [...assetBytes] },
      { path: 'mark.svg', bytes: [...assetBytes] },
    ],
    revision: `e2e-long-settings-brand-${index + 1}`,
  }))
  const longContractEntries: readonly ContractCacheStoredEntry[] = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const payload = {
        contract_reader_version: 2,
        schema_version: 1,
        normalizer_version: index + 1,
        profile: index % 2 === 0 ? ('archon-2026-07' as const) : ('hermes-legacy' as const),
        fixture_identity: `deterministic-contract-${index + 1}-${'bounded-identity-'.repeat(5)}`,
      }
      const digest = `sha256:${await sha256(new TextEncoder().encode(canonicalizeContractPayload(payload)))}` as const
      return {
        digest,
        profile: payload.profile,
        schemaVersion: payload.schema_version,
        normalizerVersion: payload.normalizer_version,
        readerVersion: payload.contract_reader_version,
        source: {
          kind: 'user' as const,
          identifier: `C:\\contracts\\cached\\${'deeply-nested-contract-directory\\'.repeat(4)}contract-${index + 1}.json`,
        },
        content: JSON.stringify({ ...payload, contract_digest: digest }),
        active: false,
      }
    }),
  )

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
    contractCacheLoad: async () =>
      scenario === 'long-settings' ? { entries: longContractEntries, advisories: [] } : base.contractCacheLoad(),
    brandListPacks: async () =>
      scenario === 'long-settings' ? { packs: longBrandPacks, warnings: [] } : base.brandListPacks(),
    brandLoadPack: async (id) => {
      if (scenario === 'long-settings') {
        const pack = longBrandPacks.find(({ manifest }) => manifest.id === id)
        if (pack) return pack
      }
      return base.brandLoadPack(id)
    },
    chooseWorkspaceFolder: async () => {
      if (scenario === 'long-application-notice') throw new Error(LONG_APPLICATION_NOTICE)
      return base.chooseWorkspaceFolder()
    },
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
    gitDetect: async () => ({
      root: scenario === 'long-git' ? LONG_WINDOWS_ROOT : '/e2e/workspace',
      branch:
        scenario === 'unbroken-git-ref'
          ? UNBROKEN_GIT_REF
          : scenario === 'long-git'
            ? 'feature/document-the-exceptionally-long-windows-release-workflow-reference'
            : 'base',
      detachedHead: null,
    }),
    gitStatus: async () => ({ entries: gitStatusEntries.map((entry) => ({ ...entry })) }),
    gitDiffPair: async () => ({
      working: pairVersioned
        ? ''
        : scenario === 'long-create-version'
          ? LONG_CREATE_VERSION_DIFF
          : 'diff --git a/workflows/release-demo.yaml b/workflows/release-demo.yaml\n',
      index: '',
      authorizationToken: 'e2e-version-authorization',
    }),
    gitHistoryPair: async () => ({
      commits:
        scenario === 'long-git'
          ? [
              {
                oid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                shortOid: 'bbbbbbbbbbbb',
                authorName: 'A Very Long Release Automation Author Identity For Containment Verification',
                authoredAt: '2026-08-30T12:00:00Z',
                subject: LONG_GIT_SUBJECT,
              },
            ]
          : pairVersioned
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
    onWorkspaceChanged: async (handler) => {
      workspaceChangeHandlers.add(handler)
      return () => workspaceChangeHandlers.delete(handler)
    },
  }

  setNativeBridgeForTest(bridge)
  window.__WORKFLOW_STUDIO_E2E__ = {
    metrics: () => metrics.snapshot(),
    resetMetrics: () => metrics.reset(),
    async triggerExternalChange(): Promise<void> {
      const current = await base.workspaceRead(DEFINITION_PATH)
      await base.workspaceWrite({
        relativePath: DEFINITION_PATH,
        text: AUTHORING_FILES[DEFINITION_PATH].replace('Release demo', 'External release demo'),
        expectedCurrentHash: current.sha256,
      })
      await Promise.all(
        [...workspaceChangeHandlers].map((handler) => handler({ paths: [DEFINITION_PATH], kind: 'modify' })),
      )
    },
    async prepareCapacityConnection(): Promise<void> {
      if (!largeCanvasDefinition) throw new Error('The capacity connection fixture requires the large canvas scenario.')
      const nodeStart = largeCanvasDefinition.indexOf('  - id: node-026\n')
      const nodeEnd = largeCanvasDefinition.indexOf('  - id: node-027\n', nodeStart)
      const nodeBlock = largeCanvasDefinition.slice(nodeStart, nodeEnd)
      const preparedBlock = nodeBlock.replace('    depends_on:\n      - node-025\n', '')
      if (nodeStart < 0 || nodeEnd < 0 || preparedBlock === nodeBlock) {
        throw new Error('The deterministic capacity edge could not be prepared.')
      }
      const current = await base.workspaceRead(DEFINITION_PATH)
      await base.workspaceWrite({
        relativePath: DEFINITION_PATH,
        text: `${largeCanvasDefinition.slice(0, nodeStart)}${preparedBlock}${largeCanvasDefinition.slice(nodeEnd)}`,
        expectedCurrentHash: current.sha256,
      })
      await Promise.all(
        [...workspaceChangeHandlers].map((handler) => handler({ paths: [DEFINITION_PATH], kind: 'modify' })),
      )
    },
    async snapshot(): Promise<E2EState> {
      const openPair = $documentSession.get().pair
      const activeProjection = $documentSession.get().analysis?.projection
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
        definitionRevision: openPair?.definition.revision ?? 0,
        undoDepth: historyStore.get().undo.length,
        companionText,
        workspacePaths,
        layout,
        projectionNodeCount: isWorkflowProjection(activeProjection) ? activeProjection.nodes.length : 0,
        projectionEdgeCount: isWorkflowProjection(activeProjection) ? activeProjection.edges.length : 0,
      }
    },
  }
}
