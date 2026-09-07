import routedShowcaseSource from '../../tests/e2e/fixtures/loop-group-showcase.yaml?raw'
import loop24ManifestSource from '../../brands/loop24/brand.yaml?raw'
import archonContractSource from '../../contracts/archon-2026-07-v6.json?raw'
import { NativeError, type WorkspaceChangedHandler, type WorkspaceNativeBridge } from '$src/lib/native/types'
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
import { isAnalysisCurrent } from '$src/lib/documents/revisions'
import { $activeLayout } from '$src/stores/layout'
import { $documentSession, receiveDocumentAnalysis } from '$src/stores/documents'
import { historyStore } from '$src/stores/history'
import {
  bundledLoopGroupExamples,
  createOversizedBodyFixture,
  createScopedCapacityFixture,
} from '$src/e2e/loop-group-fixtures'
import type { GraphScopeKey } from '$src/lib/projection/types'
import type { LayoutRecordV2 } from '$src/lib/layout/types'

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
const EXPORT_BLOCKING_YAML = `name: Blocked export
description: Deterministic structurally invalid export fixture.
nodes:
  - id: publish
    command: /publish
    depends_on: [missing]
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

export function installApplicationReadiness(readiness: {
  readonly flushRecoveryPersistence: () => Promise<void>
}): void {
  if (!window.__WORKFLOW_STUDIO_E2E__) throw new Error('E2E fixture controls were not installed.')
  window.__WORKFLOW_STUDIO_E2E__.flushRecoveryPersistence = readiness.flushRecoveryPersistence
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

const DOCUMENT_CONTROLS_SAVED_YAML = `name: Save and revert fixture
description: Preserve the exact saved workflow text.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
`

const DOCUMENT_CONTROLS_RECOVERY_YAML = DOCUMENT_CONTROLS_SAVED_YAML.replace(
  'description: Preserve the exact saved workflow text.',
  'description: Restore this exact recovery draft before reverting.',
)

const DOCUMENT_CONTROLS_EXTERNAL_YAML = DOCUMENT_CONTROLS_SAVED_YAML.replace(
  'description: Preserve the exact saved workflow text.',
  'description: This exact text changed outside Workflow Studio.',
)

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
  readonly analysisDefinitionRevision: number | null
  readonly analysisIssues: readonly { readonly code: string; readonly line?: number; readonly column?: number }[]
  readonly undoDepth: number
  readonly companionText: string
  readonly workspacePaths: readonly string[]
  readonly layout: string | null
  readonly projectionNodeCount: number
  readonly projectionEdgeCount: number
}

interface CapacityProbe {
  readonly definitionRevision: number
  readonly analysisRevision: number | null
  readonly analysisCurrent: boolean
  readonly nodeCount: number
  readonly edgeCount: number
  readonly commandApplied: boolean
  readonly layoutPosition: { readonly x: number; readonly y: number } | null
}

interface PersistedLayoutProbe {
  readonly saveCount: number
  readonly position: { readonly x: number; readonly y: number } | null
}

interface E2EScopeSnapshot {
  readonly workflowId: string | null
  readonly definitionRevision: number
  readonly activeScopeKey: GraphScopeKey | null
  readonly selectedNodeIds: readonly string[]
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number } | null
  readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>
  readonly focusTarget: Readonly<Record<string, unknown>> | null
  readonly inspector: { readonly tab: string; readonly scrollTop: number } | null
  readonly canvasScroll: { readonly left: number; readonly top: number } | null
  readonly yamlScroll: number
  readonly problemsScroll: number
  readonly mountedSvelteFlowCount: number
}

declare global {
  interface Window {
    __WORKFLOW_STUDIO_E2E__?: {
      snapshot(): Promise<E2EState>
      capacityProbe(nodeId: string): CapacityProbe
      persistedLayoutProbe(nodeId: string): PersistedLayoutProbe
      triggerExternalChange(): Promise<void>
      prepareCapacityConnection(): Promise<void>
      metrics(): ReturnType<ReturnType<typeof createEditorMetricsCollector>['snapshot']>
      resetMetrics(): void
      scopeSnapshot(): E2EScopeSnapshot
      projectionScopes(): readonly {
        readonly scopeKey: GraphScopeKey
        readonly nodeCount: number
        readonly edgeCount: number
        readonly capacity: 'visual' | 'yaml-only'
      }[]
      persistedScopeLayout(scopeKey: GraphScopeKey): {
        readonly saveCount: number
        readonly scope: LayoutRecordV2['scopeLayouts'][GraphScopeKey] | null
      }
      stageExternalDefinitionChange(): Promise<void>
      prepareScopedConnection(scopeKey: GraphScopeKey, source: string, target: string): Promise<void>
      flushRecoveryPersistence(): Promise<void>
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
  const scopedCapacityFixture = scenario === 'loop-group-scoped-capacity' ? createScopedCapacityFixture() : null
  const oversizedBodyFixture = scenario === 'loop-group-oversized-body' ? createOversizedBodyFixture() : null
  const loopGroupAuthoringDefinition = `${bundledLoopGroupExamples.iterationContext.definition}  # retained visual-authoring augmentation
  - id: polish
    depends_on: [seed]
    loop_group:
      until: complete
      max_iterations: 3
      nodes:
        - id: draft
          prompt: |-
            Draft a concise summary.
          provider: &retained_provider "deterministic-provider"
        - id: review
          depends_on: [draft]
          prompt: Review the body outputs.
          provider: *retained_provider
          model: retained-model
`
  const scopedProblemsDefinition = `name: Scoped loop group problems
description: Repairable scoped findings with repeated child identifiers.
nodes:
  - id: refine
    loop_group:
      until: complete
      max_iterations: 2
      nodes:
        - id: draft
          prompt: Refine this draft.
  - id: polish
    loop_group:
      until: complete
      max_iterations: 2
      nodes:
        - id: draft
          prompt: Polish this draft.
`
  const emptyDraftDefinition = `name: Empty loop group draft
description: Repair the empty group visually.
nodes:
  - id: empty
    loop_group:
      nodes: []
`
  const largeCanvasLayout = scenario === 'large-canvas' ? capacityLayout() : null
  const metrics = createEditorMetricsCollector()
  installEditorMetrics(metrics)
  const largeCanvasDefinition = largeCanvasLayout
    ? `${Array.from({ length: 8 }, (_, index) => `future_large_canvas_finding_${index + 1}: retained`).join('\n')}\n${capacityWorkflowYaml()}`
    : null
  const loopGroupFiles = scopedCapacityFixture
    ? {
        [DEFINITION_PATH]: scopedCapacityFixture.definition,
        [COMPANION_PATH]: scopedCapacityFixture.companion,
      }
    : oversizedBodyFixture
      ? {
          [DEFINITION_PATH]: oversizedBodyFixture.definition,
          [COMPANION_PATH]: oversizedBodyFixture.companion,
        }
      : scenario === 'loop-group-authoring' || scenario === 'loop-group-state-restoration'
        ? {
            [DEFINITION_PATH]: loopGroupAuthoringDefinition,
            [COMPANION_PATH]: bundledLoopGroupExamples.iterationContext.companion,
            'workflows/other.yaml': bundledLoopGroupExamples.currentOutput.definition,
            'workflows/other.hermes.yaml': bundledLoopGroupExamples.currentOutput.companion,
          }
        : scenario === 'loop-group-scoped-problems'
          ? {
              [DEFINITION_PATH]: scopedProblemsDefinition,
              [COMPANION_PATH]: bundledLoopGroupExamples.currentOutput.companion,
            }
          : scenario === 'loop-group-empty-draft'
            ? {
                [DEFINITION_PATH]: emptyDraftDefinition,
                [COMPANION_PATH]: bundledLoopGroupExamples.currentOutput.companion,
                'workflows/other.yaml': bundledLoopGroupExamples.currentOutput.definition,
                'workflows/other.hermes.yaml': bundledLoopGroupExamples.currentOutput.companion,
              }
            : null
  const initialFiles =
    scenario === 'routed-showcase'
      ? {
          ...AUTHORING_FILES,
          [DEFINITION_PATH]: routedShowcaseSource,
          'workflows/other.yaml': AUTHORING_FILES[DEFINITION_PATH],
          'workflows/other.hermes.yaml': AUTHORING_FILES[COMPANION_PATH],
        }
      : loopGroupFiles
        ? { ...AUTHORING_FILES, ...loopGroupFiles }
        : largeCanvasLayout
          ? {
              ...AUTHORING_FILES,
              [DEFINITION_PATH]: largeCanvasDefinition!,
              [COMPANION_PATH]: 'language_compatibility: hermes-legacy\ntags: [release, e2e]\n',
            }
          : scenario === 'document-controls-recovery'
            ? {
                ...AUTHORING_FILES,
                [DEFINITION_PATH]: DOCUMENT_CONTROLS_SAVED_YAML,
              }
            : scenario === 'long-create-version'
              ? {
                  ...AUTHORING_FILES,
                  [DEFINITION_PATH]: LONG_CREATE_VERSION_YAML,
                  [COMPANION_PATH]: 'language_compatibility: hermes-legacy\ntags: [release, e2e]\n',
                }
              : scenario === 'repeated-diagnostics'
                ? { ...AUTHORING_FILES, [DEFINITION_PATH]: REPEATED_DIAGNOSTICS_YAML }
                : scenario === 'export-blocking-modal'
                  ? { ...AUTHORING_FILES, [DEFINITION_PATH]: EXPORT_BLOCKING_YAML }
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
  let layout: string | null = scopedCapacityFixture
    ? JSON.stringify([{ schemaVersion: 2, layout: scopedCapacityFixture.layout, savedHashes: null }])
    : largeCanvasLayout
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
  let persistedCapacityLayout: ReturnType<typeof capacityLayout> | LayoutRecordV2 | null =
    scopedCapacityFixture?.layout ?? largeCanvasLayout
  let persistedLayoutSaveCount = 0
  let brandSelection = 0
  let activeBrandId = scenario === 'active-brand-removal-modal' ? 'northstar' : 'loop24'

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
  const activeBrandPack: StoredBrandPack = {
    manifest: loadBrandManifest(validManifest),
    assets: [
      { path: 'logo.svg', bytes: [...assetBytes] },
      { path: 'mark.svg', bytes: [...assetBytes] },
    ],
    revision: 'e2e-active-brand',
  }
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
  const longValidContractEntries: readonly ContractCacheStoredEntry[] = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const payload = {
        ...(JSON.parse(archonContractSource) as Record<string, unknown>),
        normalizer_version: 100 + index,
      }
      const digest = `sha256:${await sha256(new TextEncoder().encode(canonicalizeContractPayload(payload)))}` as const
      return {
        digest,
        profile: 'archon-2026-07' as const,
        schemaVersion: 1,
        normalizerVersion: 100 + index,
        readerVersion: 3,
        source: {
          kind: 'user' as const,
          identifier: `C:\\contracts\\cached\\${'deeply-nested-contract-directory\\'.repeat(4)}contract-${index + 1}.json`,
        },
        content: JSON.stringify({ ...payload, contract_digest: digest }),
        active: false,
      }
    }),
  )
  const invalidLongContractEntry: ContractCacheStoredEntry = {
    digest: `sha256:${'f'.repeat(64)}`,
    profile: 'archon-2026-07',
    schemaVersion: 1,
    normalizerVersion: 999,
    readerVersion: 3,
    source: { kind: 'user', identifier: 'C:\\contracts\\cached\\invalid-contract.json' },
    content: '{"contract_reader_version":3}',
    active: false,
  }
  const longContractEntries = [...longValidContractEntries, invalidLongContractEntry]

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
      scenario === 'long-settings'
        ? { packs: longBrandPacks, warnings: [] }
        : scenario === 'active-brand-removal-modal'
          ? { packs: [activeBrandPack], warnings: [] }
          : base.brandListPacks(),
    brandLoadPack: async (id) => {
      if (scenario === 'long-settings') {
        const pack = longBrandPacks.find(({ manifest }) => manifest.id === id)
        if (pack) return pack
      }
      if (scenario === 'active-brand-removal-modal' && id === activeBrandPack.manifest.id) return activeBrandPack
      return base.brandLoadPack(id)
    },
    brandLoadActive: async () =>
      scenario === 'active-brand-removal-modal'
        ? { id: activeBrandPack.manifest.id, pack: activeBrandPack, recovered: false, warning: null }
        : base.brandLoadActive(),
    recoveryList: async () => {
      if (scenario !== 'recovery-modal' && scenario !== 'document-controls-recovery') return base.recoveryList()
      const [definitionDisk, companionDisk] = await Promise.all([
        base.workspaceRead(DEFINITION_PATH),
        base.workspaceRead(COMPANION_PATH),
      ])
      const content = JSON.stringify({
        schemaVersion: 1,
        workflowId: `workflow:browser-workspace:${DEFINITION_PATH}`,
        generation: scenario === 'document-controls-recovery' ? 0 : 1,
        savedGeneration: 0,
        definition: {
          path: DEFINITION_PATH,
          text:
            scenario === 'document-controls-recovery'
              ? DOCUMENT_CONTROLS_RECOVERY_YAML
              : AUTHORING_FILES[DEFINITION_PATH].replace('Release demo', 'Recovered release demo'),
          revision: 1,
          savedRevision: 0,
          diskHash: scenario === 'document-controls-recovery' ? definitionDisk.sha256 : null,
        },
        companion: {
          path: COMPANION_PATH,
          text: AUTHORING_FILES[COMPANION_PATH],
          revision: 0,
          savedRevision: 0,
          diskHash: scenario === 'document-controls-recovery' ? companionDisk.sha256 : 'e2e-companion-hash',
        },
        updatedAt: '2026-08-30T12:00:00.000Z',
      })
      return [
        { id: 'e2e-recovery.wsr', key: `workflow:browser-workspace:${DEFINITION_PATH}`, content, size: content.length },
      ]
    },
    chooseExportDirectory: async () =>
      scenario === 'export-collision-modal' ? '/e2e/exports' : base.chooseExportDirectory(),
    externalExportYamlPair: async (request) => {
      if (scenario === 'export-collision-modal' && !request.overwrite) {
        throw new NativeError('destination_exists', 'The selected export files already exist.')
      }
      return base.externalExportYamlPair(request)
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
    gitDetect: async () =>
      scenario === 'initialize-repository-modal'
        ? null
        : {
            root: scenario === 'long-git' ? LONG_WINDOWS_ROOT : '/e2e/workspace',
            branch:
              scenario === 'unbroken-git-ref'
                ? UNBROKEN_GIT_REF
                : scenario === 'long-git'
                  ? 'feature/document-the-exceptionally-long-windows-release-workflow-reference'
                  : 'base',
            detachedHead: null,
          },
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
      persistedLayoutSaveCount += 1
      const entries = JSON.parse(content) as Array<{
        readonly layout?: ReturnType<typeof capacityLayout> | LayoutRecordV2
      }>
      persistedCapacityLayout =
        entries.find(
          (entry) => entry.layout?.workspaceId === 'browser-workspace' && entry.layout.workflowPath === DEFINITION_PATH,
        )?.layout ?? null
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
    capacityProbe(nodeId): CapacityProbe {
      const session = $documentSession.get()
      const projection = session.analysis?.projection
      const workflow = isWorkflowProjection(projection) ? projection : null
      const position = $activeLayout.get()?.scopeLayouts[$activeLayout.get()!.activeScopeKey]?.nodePositions[nodeId]
      return {
        definitionRevision: session.pair?.definition.revision ?? 0,
        analysisRevision: session.analysis?.definitionRevision ?? null,
        analysisCurrent: Boolean(
          session.revision && session.analysis && isAnalysisCurrent(session.revision, session.analysis),
        ),
        nodeCount: workflow?.graphs[0]?.nodes.length ?? 0,
        edgeCount: workflow?.graphs[0]?.edges.length ?? 0,
        commandApplied: workflow?.graphs[0]?.nodes.find(({ id }) => id === nodeId)?.value === '/capacity-edited',
        layoutPosition: position ? { x: position.x, y: position.y } : null,
      }
    },
    persistedLayoutProbe(nodeId): PersistedLayoutProbe {
      const position =
        persistedCapacityLayout && 'scopeLayouts' in persistedCapacityLayout
          ? persistedCapacityLayout.scopeLayouts[persistedCapacityLayout.activeScopeKey]?.nodePositions[nodeId]
          : persistedCapacityLayout?.nodePositions[nodeId]
      return {
        saveCount: persistedLayoutSaveCount,
        position: position ? { x: position.x, y: position.y } : null,
      }
    },
    scopeSnapshot(): E2EScopeSnapshot {
      const session = $documentSession.get()
      const active = $activeLayout.get()
      const scope = active ? active.scopeLayouts[active.activeScopeKey] : null
      return {
        workflowId: session.pair?.workflowId ?? null,
        definitionRevision: session.pair?.definition.revision ?? 0,
        activeScopeKey: active?.activeScopeKey ?? null,
        selectedNodeIds: scope?.selectedNodeIds ?? [],
        viewport: scope?.viewport ? { ...scope.viewport } : null,
        positions: scope
          ? Object.fromEntries(Object.entries(scope.nodePositions).map(([id, position]) => [id, { ...position }]))
          : {},
        focusTarget: scope?.focusTarget ? { ...scope.focusTarget } : null,
        inspector: scope?.inspector ? { ...scope.inspector } : null,
        canvasScroll: scope?.canvasScroll ? { ...scope.canvasScroll } : null,
        yamlScroll: document.querySelector<HTMLElement>('.cm-scroller')?.scrollTop ?? 0,
        problemsScroll: document.querySelector<HTMLElement>('[data-scroll-owner="problems"]')?.scrollTop ?? 0,
        mountedSvelteFlowCount: document.querySelectorAll('.svelte-flow').length,
      }
    },
    projectionScopes() {
      const projection = $documentSession.get().analysis?.projection
      if (!isWorkflowProjection(projection)) return []
      return projection.graphs.map((graph) => ({
        scopeKey: graph.scope.key,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        capacity: graph.capacity.status,
      }))
    },
    persistedScopeLayout(scopeKey) {
      const record =
        persistedCapacityLayout && 'scopeLayouts' in persistedCapacityLayout ? persistedCapacityLayout : null
      const scope = record?.scopeLayouts[scopeKey]
      return {
        saveCount: persistedLayoutSaveCount,
        scope: scope ? structuredClone(scope) : null,
      }
    },
    async stageExternalDefinitionChange(): Promise<void> {
      const current = await base.workspaceRead(DEFINITION_PATH)
      await base.workspaceWrite({
        relativePath: DEFINITION_PATH,
        text: DOCUMENT_CONTROLS_EXTERNAL_YAML,
        expectedCurrentHash: current.sha256,
      })
    },
    async prepareScopedConnection(scopeKey, source, target): Promise<void> {
      const session = $documentSession.get()
      const pair = session.pair
      const projection = session.analysis?.projection
      if (!pair || !isWorkflowProjection(projection)) throw new Error('No projected workflow is active.')
      const graph = projection.graphs.find(({ scope }) => scope.key === scopeKey)
      const node = graph?.nodes.find(({ id }) => id === target)
      if (!graph || !node || !node.dependsOn.includes(source)) {
        throw new Error(`The deterministic scoped edge ${source} -> ${target} is unavailable.`)
      }
      const rootIndent = scopeKey === 'root' ? '  ' : '        '
      const nodeMarker = `${rootIndent}- id: ${target}\n`
      const scopeStart =
        scopeKey === 'root' ? 0 : pair.definition.text.indexOf(`  - id: ${scopeKey.slice('loop-group:'.length)}\n`)
      const start = pair.definition.text.indexOf(nodeMarker, scopeStart)
      const nextMarker = pair.definition.text.indexOf(`\n${rootIndent}- id: `, start + nodeMarker.length)
      const end = nextMarker < 0 ? pair.definition.text.length : nextMarker + 1
      const block = pair.definition.text.slice(start, end)
      const dependencyIndent = `${rootIndent}  `
      const dependencyLine = new RegExp(`^${dependencyIndent}depends_on:\\n(?:${dependencyIndent}  - .+\\n)+`, 'm')
      const match = dependencyLine.exec(block)
      if (scopeStart < 0 || start < 0 || !match) {
        throw new Error('The deterministic scoped dependency block could not be located.')
      }
      const dependencies = node.dependsOn.filter((id) => id !== source)
      const replacement = dependencies.length
        ? `${dependencyIndent}depends_on:\n${dependencies.map((id) => `${dependencyIndent}  - ${id}\n`).join('')}`
        : ''
      const nextText = `${pair.definition.text.slice(0, start)}${block.replace(dependencyLine, replacement)}${pair.definition.text.slice(end)}`
      const current = await base.workspaceRead(DEFINITION_PATH)
      await base.workspaceWrite({ relativePath: DEFINITION_PATH, text: nextText, expectedCurrentHash: current.sha256 })
      await Promise.all(
        [...workspaceChangeHandlers].map((handler) => handler({ paths: [DEFINITION_PATH], kind: 'modify' })),
      )
    },
    async flushRecoveryPersistence(): Promise<void> {
      throw new Error('The application recovery controller is not ready.')
    },
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
        analysisDefinitionRevision: $documentSession.get().analysis?.definitionRevision ?? null,
        analysisIssues:
          $documentSession.get().analysis?.issues.map(({ code, line, column }) => ({
            code,
            ...(line === undefined ? {} : { line }),
            ...(column === undefined ? {} : { column }),
          })) ?? [],
        undoDepth: historyStore.get().undo.length,
        companionText,
        workspacePaths,
        layout,
        projectionNodeCount: isWorkflowProjection(activeProjection)
          ? (activeProjection.graphs[0]?.nodes.length ?? 0)
          : 0,
        projectionEdgeCount: isWorkflowProjection(activeProjection)
          ? (activeProjection.graphs[0]?.edges.length ?? 0)
          : 0,
      }
    },
  }
  if (scenario === 'loop-group-scoped-problems') {
    let injected = false
    let unsubscribe: () => void = () => undefined
    unsubscribe = $documentSession.subscribe((session) => {
      if (injected || !session.revision || !session.analysis?.projection) return
      injected = true
      queueMicrotask(() => {
        receiveDocumentAnalysis({
          ...session.revision!,
          structurallyValid: false,
          visuallyAuthorable: true,
          ...(session.analysis!.referenceIndex ? { referenceIndex: session.analysis!.referenceIndex } : {}),
          projection: session.analysis!.projection,
          issues: [
            {
              code: 'e2e_scoped_child',
              layer: 'semantic',
              severity: 'error',
              blocking: true,
              message: 'Repair the repeated draft prompt.',
              document: 'definition',
              scopeKey: 'loop-group:refine',
              groupId: 'refine',
              nodeId: 'draft',
              field: 'prompt',
              path: '/nodes/0/loop_group/nodes/0/prompt',
              line: 9,
              column: 19,
            },
            {
              code: 'e2e_group_control',
              layer: 'semantic',
              severity: 'error',
              blocking: true,
              message: 'Repair the refine stopping condition.',
              document: 'definition',
              scopeKey: 'loop-group:refine',
              groupId: 'refine',
              nodeId: 'refine',
              field: 'until',
              path: '/nodes/0/loop_group/until',
              line: 6,
              column: 14,
            },
            {
              code: 'e2e_yaml_fallback',
              layer: 'semantic',
              severity: 'error',
              blocking: true,
              message: 'Inspect the exact workflow description.',
              document: 'definition',
              path: '/description',
              line: 2,
              column: 1,
            },
          ],
        })
        unsubscribe()
      })
    })
  }
  if (scenario === 'loop-group-scoped-capacity') {
    let injectedRevision = -1
    $documentSession.subscribe((session) => {
      if (
        !session.revision ||
        !session.analysis?.projection ||
        session.analysis.definitionRevision === injectedRevision ||
        session.analysis.issues.some(({ code }) => code.startsWith('e2e_capacity_advisory_'))
      )
        return
      injectedRevision = session.analysis.definitionRevision
      queueMicrotask(() => {
        if (!$documentSession.get().revision || $documentSession.get().pair?.definition.revision !== injectedRevision)
          return
        receiveDocumentAnalysis({
          ...session.revision!,
          structurallyValid: session.analysis!.structurallyValid,
          ...(session.analysis!.visuallyAuthorable ? { visuallyAuthorable: true } : {}),
          ...(session.analysis!.referenceIndex ? { referenceIndex: session.analysis!.referenceIndex } : {}),
          projection: session.analysis!.projection,
          issues: [
            ...session.analysis!.issues,
            ...Array.from({ length: 20 }, (_, index) => ({
              code: `e2e_capacity_advisory_${index}`,
              layer: 'operational' as const,
              severity: 'warning' as const,
              blocking: false,
              message: `Deterministic capacity advisory ${index + 1}.`,
              document: 'definition' as const,
              scopeKey: 'loop-group:root-000' as const,
              groupId: 'root-000',
              nodeId: `body-0-${String(index).padStart(3, '0')}`,
              path: `/nodes/0/loop_group/nodes/${index}/prompt`,
            })),
          ],
        })
      })
    })
  }
  if (scenario === 'loop-group-state-restoration') {
    let injectedRevision = -1
    $documentSession.subscribe((session) => {
      if (
        !session.revision ||
        !session.analysis?.projection ||
        session.analysis.definitionRevision === injectedRevision ||
        session.analysis.issues.some(({ code }) => code.startsWith('e2e_state_advisory_'))
      )
        return
      injectedRevision = session.analysis.definitionRevision
      queueMicrotask(() => {
        if (!$documentSession.get().revision || $documentSession.get().pair?.definition.revision !== injectedRevision)
          return
        receiveDocumentAnalysis({
          ...session.revision!,
          structurallyValid: session.analysis!.structurallyValid,
          ...(session.analysis!.visuallyAuthorable ? { visuallyAuthorable: true } : {}),
          ...(session.analysis!.referenceIndex ? { referenceIndex: session.analysis!.referenceIndex } : {}),
          projection: session.analysis!.projection,
          issues: [
            ...session.analysis!.issues,
            ...Array.from({ length: 20 }, (_, index) => ({
              code: `e2e_state_advisory_${index}`,
              layer: 'operational' as const,
              severity: 'warning' as const,
              blocking: false,
              message: `Deterministic state advisory ${index + 1}.`,
              document: 'definition' as const,
              scopeKey: 'loop-group:polish' as const,
              groupId: 'polish',
              nodeId: index % 2 === 0 ? 'draft' : 'review',
              field: 'prompt',
              path: `/nodes/2/loop_group/nodes/${index % 2}/prompt`,
            })),
          ],
        })
      })
    })
  }
}
