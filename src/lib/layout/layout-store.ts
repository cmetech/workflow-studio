import type { GraphScopeKey } from '$src/lib/projection/types'
import { emptyScopeLayout, type ScopeLayoutV1 } from './types'
import { validPosition } from './place-new-nodes'
import type { LayoutContentHashes, LayoutLoadRequest, LayoutRecordV2 } from './types'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const MAX_PANEL_SIZE = 10_000
const MAX_VIEWPORT_COORDINATE = 1_000_000

export interface LayoutNativePort {
  layoutLoad(): Promise<string | null>
  layoutSave(content: string): Promise<void>
}

interface StoredLayoutV2 {
  readonly schemaVersion: 2
  readonly layout: LayoutRecordV2
  readonly savedHashes: LayoutContentHashes | null
}

export interface LayoutStore {
  loadLayout(request: LayoutLoadRequest): Promise<LayoutRecordV2 | null>
  saveLayout(layout: LayoutRecordV2, savedHashes?: LayoutContentHashes): Promise<void>
  renameWorkflowPath(workspaceId: string, from: string, to: string): Promise<void>
}

class AppDataLayoutStore implements LayoutStore {
  private queue: Promise<void> = Promise.resolve()
  private loaded = false
  private entries: unknown[] = []

  constructor(private readonly native: LayoutNativePort) {}

  loadLayout(request: LayoutLoadRequest): Promise<LayoutRecordV2 | null> {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const direct = this.validEntries().filter(
        ({ value }) =>
          value.layout.workspaceId === request.workspaceId && value.layout.workflowPath === request.workflowPath,
      )
      if (direct.length > 0) return cloneLayout(latest(direct).value.layout)
      if (!request.savedHashes || !request.missingWorkflowPaths) return null

      const savedHashes = request.savedHashes
      const missing = new Set(request.missingWorkflowPaths)
      const candidates = this.validEntries().filter(
        ({ value }) =>
          value.layout.workspaceId === request.workspaceId &&
          missing.has(value.layout.workflowPath) &&
          sameHashes(value.savedHashes, savedHashes),
      )
      if (candidates.length !== 1) return null

      const candidate = candidates[0]!
      const migrated: StoredLayoutV2 = {
        ...candidate.value,
        layout: { ...candidate.value.layout, workflowPath: request.workflowPath },
      }
      this.entries[candidate.index] = migrated
      await this.persist()
      return cloneLayout(migrated.layout)
    })
  }

  saveLayout(layout: LayoutRecordV2, savedHashes?: LayoutContentHashes): Promise<void> {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const validated = sanitizeLayoutRecord(layout)
      if (!validated) throw new TypeError('Refusing to persist an invalid layout record.')
      if (savedHashes !== undefined && !validHashes(savedHashes)) {
        throw new TypeError('Refusing to persist invalid workflow content hashes.')
      }
      const next: StoredLayoutV2 = {
        schemaVersion: 2,
        layout: validated,
        savedHashes: savedHashes ? { ...savedHashes } : null,
      }
      const matches = this.validEntries().filter(
        ({ value }) =>
          value.layout.workspaceId === validated.workspaceId && value.layout.workflowPath === validated.workflowPath,
      )
      if (matches.length === 0) this.entries.push(next)
      else {
        this.entries[matches[0]!.index] = next
        for (const duplicate of matches.slice(1).reverse()) this.entries.splice(duplicate.index, 1)
      }
      await this.persist()
    })
  }

  renameWorkflowPath(workspaceId: string, from: string, to: string): Promise<void> {
    return this.exclusive(async () => {
      await this.ensureLoaded()
      const sources = this.validEntries().filter(
        ({ value }) => value.layout.workspaceId === workspaceId && value.layout.workflowPath === from,
      )
      const destinationExists = this.validEntries().some(
        ({ value }) => value.layout.workspaceId === workspaceId && value.layout.workflowPath === to,
      )
      if (sources.length !== 1 || destinationExists) return
      const source = sources[0]!
      this.entries[source.index] = {
        ...source.value,
        layout: { ...source.value.layout, workflowPath: to },
      } satisfies StoredLayoutV2
      await this.persist()
    })
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    const content = await this.native.layoutLoad()
    this.loaded = true
    if (content === null) return
    try {
      const value: unknown = JSON.parse(content)
      if (Array.isArray(value)) this.entries = value
    } catch {
      this.entries = []
    }
  }

  private validEntries(): { index: number; value: StoredLayoutV2 }[] {
    return this.entries.flatMap((entry, index) => {
      const value = parseStoredLayout(entry)
      return value ? [{ index, value }] : []
    })
  }

  private async persist(): Promise<void> {
    await this.native.layoutSave(JSON.stringify(this.entries))
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => undefined).then(operation)
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export function createLayoutStore(native: LayoutNativePort): LayoutStore {
  return new AppDataLayoutStore(native)
}

export function loadLayout(store: LayoutStore, request: LayoutLoadRequest): Promise<LayoutRecordV2 | null> {
  return store.loadLayout(request)
}

export function saveLayout(
  store: LayoutStore,
  layout: LayoutRecordV2,
  savedHashes?: LayoutContentHashes,
): Promise<void> {
  return store.saveLayout(layout, savedHashes)
}

interface ScheduledLayout {
  readonly sequence: number
  readonly layout: LayoutRecordV2
}

export class LayoutPersistenceController {
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: ScheduledLayout | null = null
  private failed: { scheduled: ScheduledLayout; error: unknown } | null = null
  private sequence = 0
  private successfulSequence = 0
  private flushRequested = false
  private retryFailedRequested = false
  private runner: Promise<void> | null = null
  private flushPromise: Promise<void> | null = null
  private closePromise: Promise<void> | null = null
  private flushing = false
  private closing = false
  private closed = false

  constructor(private readonly persist: (layout: LayoutRecordV2, sequence: number) => Promise<void>) {}

  pointerMoved(_layout: LayoutRecordV2): void {
    void _layout
    // Pointer frames update only canvas state. Persistence begins after drag completion.
  }

  dragCompleted(layout: LayoutRecordV2): void {
    this.schedule(layout, 300)
  }

  viewportOrPanelsChanged(layout: LayoutRecordV2): void {
    this.schedule(layout, 500)
  }

  flush(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.flushPromise) return this.flushPromise
    this.flushing = true
    this.cancelTimer()
    const operation = this.finishFlush().finally(() => {
      this.flushing = false
      if (this.flushPromise === operation) this.flushPromise = null
    })
    this.flushPromise = operation
    return operation
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.cancelTimer()
    this.closePromise = this.finishClose().finally(() => {
      if (!this.closed) this.closing = false
      this.closePromise = null
    })
    return this.closePromise
  }

  private schedule(layout: LayoutRecordV2, delay: number): void {
    if (this.closed) return
    this.sequence += 1
    this.pending = { sequence: this.sequence, layout: cloneLayout(layout) }
    this.cancelTimer()
    if (this.closing || this.flushing) {
      void this.requestFlush(false)
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.requestFlush(false)
    }, delay)
  }

  private async finishClose(): Promise<void> {
    await this.finishFlush()
    this.closed = true
    this.closing = false
  }

  private async finishFlush(): Promise<void> {
    do {
      await this.requestFlush(true)
      await Promise.resolve()
    } while (this.pending !== null || this.runner !== null)
    if (this.failed) throw this.failed.error
  }

  private requestFlush(retryFailed: boolean): Promise<void> {
    this.flushRequested = true
    this.retryFailedRequested ||= retryFailed
    if (!this.runner) {
      this.runner = this.runFlushes().finally(() => {
        this.runner = null
      })
    }
    return this.runner
  }

  private async runFlushes(): Promise<void> {
    while (this.flushRequested) {
      this.flushRequested = false
      const candidate = this.takeCandidate()
      if (!candidate) continue
      try {
        await this.persist(candidate.layout, candidate.sequence)
        this.successfulSequence = Math.max(this.successfulSequence, candidate.sequence)
        if (this.failed && this.failed.scheduled.sequence <= this.successfulSequence) this.failed = null
      } catch (error: unknown) {
        if (!this.failed || candidate.sequence >= this.failed.scheduled.sequence) {
          this.failed = { scheduled: candidate, error }
        }
      }
    }
  }

  private takeCandidate(): ScheduledLayout | null {
    if (this.pending && this.pending.sequence > this.successfulSequence) {
      const pending = this.pending
      this.pending = null
      this.retryFailedRequested = false
      return pending
    }
    if (this.retryFailedRequested && this.failed) {
      this.retryFailedRequested = false
      return this.failed.scheduled
    }
    this.retryFailedRequested = false
    return null
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}

export function sanitizeLayoutRecord(value: unknown): LayoutRecordV2 | null {
  if (
    !isRecord(value) ||
    ![1, 2].includes(value.schemaVersion as number) ||
    !nonEmptyString(value.workspaceId) ||
    !nonEmptyString(value.workflowPath) ||
    !validPanels(value.panels) ||
    !validEditorMode(value.editorMode) ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt))
  )
    return null
  let scopeLayouts: LayoutRecordV2['scopeLayouts']
  let activeScopeKey: GraphScopeKey = 'root'
  if (value.schemaVersion === 1) {
    const root = sanitizeScopeLayout({
      ...emptyScopeLayout(),
      nodePositions: value.nodePositions,
      viewport: value.viewport,
    })
    if (!root) return null
    scopeLayouts = { root }
  } else {
    if (
      !isRecord(value.scopeLayouts) ||
      !Object.hasOwn(value.scopeLayouts, 'root') ||
      !validScopeKey(value.activeScopeKey)
    )
      return null
    const entries: [GraphScopeKey, ScopeLayoutV1][] = []
    for (const [key, scope] of Object.entries(value.scopeLayouts)) {
      const parsed = sanitizeScopeLayout(scope)
      if (!validScopeKey(key) || !parsed) return null
      entries.push([key, parsed])
    }
    scopeLayouts = Object.fromEntries(entries) as LayoutRecordV2['scopeLayouts']
    // Keep a missing active key until accepted projection reconciliation can explain the fallback.
    activeScopeKey = value.activeScopeKey
  }
  return {
    schemaVersion: 2,
    workspaceId: value.workspaceId,
    workflowPath: value.workflowPath,
    activeScopeKey,
    scopeLayouts,
    panels: { ...value.panels },
    editorMode: value.editorMode,
    updatedAt: value.updatedAt,
  }
}

function sanitizeScopeLayout(value: unknown): ScopeLayoutV1 | null {
  if (
    !isRecord(value) ||
    !isRecord(value.nodePositions) ||
    !validViewport(value.viewport) ||
    !Array.isArray(value.selectedNodeIds) ||
    !value.selectedNodeIds.every(nonEmptyString) ||
    !isRecord(value.inspector) ||
    !nonEmptyString(value.inspector.tab) ||
    !scrollCoordinate(value.inspector.scrollTop) ||
    !isRecord(value.canvasScroll) ||
    !scrollCoordinate(value.canvasScroll.left) ||
    !scrollCoordinate(value.canvasScroll.top)
  )
    return null
  const focus = value.focusTarget
  if (
    focus !== undefined &&
    (!isRecord(focus) ||
      !['canvas', 'node', 'scope-heading'].includes(focus.kind as string) ||
      (focus.kind === 'node' && !nonEmptyString(focus.nodeId)) ||
      (focus.nodeId !== undefined && !nonEmptyString(focus.nodeId)))
  )
    return null
  return {
    nodePositions: Object.fromEntries(
      Object.entries(value.nodePositions)
        .filter(([id, position]) => id && validPosition(position))
        .map(([id, position]) => [id, { ...(position as { x: number; y: number }) }]),
    ),
    viewport: { ...value.viewport },
    selectedNodeIds: [...new Set(value.selectedNodeIds as string[])],
    ...(focus === undefined
      ? {}
      : {
          focusTarget: { ...(focus as unknown as NonNullable<ScopeLayoutV1['focusTarget']>) } as NonNullable<
            ScopeLayoutV1['focusTarget']
          >,
        }),
    inspector: { tab: value.inspector.tab, scrollTop: value.inspector.scrollTop },
    canvasScroll: { left: value.canvasScroll.left, top: value.canvasScroll.top },
    problemsScroll: scrollCoordinate(value.problemsScroll) ? value.problemsScroll : 0,
  }
}

function scrollCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validScopeKey(value: unknown): value is GraphScopeKey {
  return value === 'root' || (typeof value === 'string' && value.startsWith('loop-group:') && value.length > 11)
}

function parseStoredLayout(value: unknown): StoredLayoutV2 | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    !isRecord(value.layout) ||
    value.layout.schemaVersion !== value.schemaVersion
  )
    return null
  const layout = sanitizeLayoutRecord(value.layout)
  const savedHashes = value.savedHashes === null ? null : parseHashes(value.savedHashes)
  if (!layout || (value.savedHashes !== null && !savedHashes)) return null
  return { schemaVersion: 2, layout, savedHashes }
}

function parseHashes(value: unknown): LayoutContentHashes | null {
  if (!isRecord(value)) return null
  const hashes = { definition: value.definition, companion: value.companion }
  return validHashes(hashes) ? hashes : null
}

function validHashes(value: unknown): value is LayoutContentHashes {
  return (
    isRecord(value) &&
    typeof value.definition === 'string' &&
    /^[a-f0-9]{64}$/.test(value.definition) &&
    (value.companion === null || (typeof value.companion === 'string' && /^[a-f0-9]{64}$/.test(value.companion)))
  )
}

function sameHashes(left: LayoutContentHashes | null, right: LayoutContentHashes): boolean {
  return left?.definition === right.definition && left.companion === right.companion
}

function validViewport(value: unknown): value is { x: number; y: number; zoom: number } {
  return (
    isRecord(value) &&
    boundedCoordinate(value.x) &&
    boundedCoordinate(value.y) &&
    typeof value.zoom === 'number' &&
    Number.isFinite(value.zoom) &&
    value.zoom >= MIN_ZOOM &&
    value.zoom <= MAX_ZOOM
  )
}

function validPanels(value: unknown): value is { left: number; right: number; problems: number } {
  return isRecord(value) && panelSize(value.left) && panelSize(value.right) && panelSize(value.problems)
}

function boundedCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_VIEWPORT_COORDINATE
}

function panelSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PANEL_SIZE
}

function validEditorMode(value: unknown): value is LayoutRecordV2['editorMode'] {
  return value === 'visual' || value === 'split' || value === 'yaml'
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function latest(entries: readonly { index: number; value: StoredLayoutV2 }[]): {
  index: number
  value: StoredLayoutV2
} {
  return [...entries].sort(
    (left, right) =>
      right.value.layout.updatedAt.localeCompare(left.value.layout.updatedAt) || right.index - left.index,
  )[0]!
}

function cloneLayout(layout: LayoutRecordV2): LayoutRecordV2 {
  return structuredClone(layout)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
