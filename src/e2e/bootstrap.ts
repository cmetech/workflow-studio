import loop24ManifestSource from '../../brands/loop24/brand.yaml?raw'
import type { WorkspaceNativeBridge } from '$src/lib/native/types'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { setNativeBridgeForTest } from '$src/lib/native/bridge'
import type { ProgressSnapshot } from '$src/lib/progress/types'
import type { UpdateSnapshot } from '$src/lib/updates/types'

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

function updateSnapshot(phase: UpdateSnapshot['phase']): UpdateSnapshot {
  const failed = phase === 'failed'
  return {
    runId: 'e2e-update',
    sequence: failed ? 3 : phase === 'available' ? 4 : 5,
    startedAt: 1_753_441_202_000,
    phase,
    cancellable: false,
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
  const base = createBrowserBridge({ initialFiles: AUTHORING_FILES, selectedRoot: '/e2e/workspace' })
  let setupRetries = 0
  let updateChecks = 0
  let updateDeferred = false
  let pairVersioned = false
  const unrelatedChangePresent = true
  let layout: string | null = null
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
      snapshot: scenario === 'setup-update' ? updateSnapshot('failed') : updateSnapshot('current'),
      startupCheckEnabled: false,
    }),
    updateCheck: async () => {
      updateChecks += 1
      return updateSnapshot('available')
    },
    updateDefer: async () => {
      updateDeferred = true
      return updateSnapshot('deferred')
    },
    gitDetect: async () => ({ root: '/e2e/workspace', branch: 'base', detachedHead: null }),
    gitStatus: async () => ({
      entries: [
        ...(pairVersioned ? [] : [{ path: DEFINITION_PATH, index: ' ', worktree: 'M', untracked: false }]),
        ...(unrelatedChangePresent
          ? [{ path: 'notes/unrelated.txt', index: 'M', worktree: ' ', untracked: false }]
          : []),
      ],
    }),
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
    gitCreatePairVersion: async () => {
      pairVersioned = true
      return {
        outcome: 'committed',
        oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: { entries: [{ path: 'notes/unrelated.txt', index: 'M', worktree: ' ', untracked: false }] },
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
      const definition = await bridge.workspaceRead(DEFINITION_PATH)
      const companion = await bridge.workspaceRead(COMPANION_PATH)
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
        unrelatedChangePresent,
        activeBrandId,
        definitionText: definition.text,
        companionText: companion.text,
        workspacePaths,
        layout,
      }
    },
  }
}
