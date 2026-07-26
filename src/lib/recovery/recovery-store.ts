import type { WorkflowPairText } from '$src/lib/documents/types'
import {
  RECOVERY_SCHEMA_VERSION,
  type RecoveryBlob,
  type RecoveryDocumentDraft,
  type RecoveryDraft,
  type RecoveryWriteRequest,
} from './types'

const RECOVERY_IDLE_MS = 750
const MAX_DRAFTS = 50
const MAX_RECOVERY_BYTES = 64 * 1024 * 1024

export interface RecoveryNativePort {
  recoveryList(): Promise<readonly RecoveryBlob[]>
  recoveryWrite(request: RecoveryWriteRequest): Promise<void>
  recoveryDelete(id: string): Promise<void>
}

export interface RecoveryStore {
  save(draft: RecoveryDraft): Promise<void>
  list(): Promise<readonly RecoveryDraft[]>
  discard(workflowId: string): Promise<void>
}

export interface RecoveryDiskPair {
  readonly definitionText: string
  readonly companionText: string | null
}

export function createRecoveryDraft(pair: WorkflowPairText, updatedAt: string): RecoveryDraft {
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    workflowId: pair.workflowId,
    generation: pair.generation,
    definition: documentDraft(pair.definition),
    companion: pair.companion ? documentDraft(pair.companion) : null,
    updatedAt,
  }
}

export function shouldOfferRecovery(draft: RecoveryDraft, disk: RecoveryDiskPair): boolean {
  return draft.definition.text !== disk.definitionText || (draft.companion?.text ?? null) !== disk.companionText
}

export function createRecoveryStore(native: RecoveryNativePort): RecoveryStore {
  return {
    async save(draft) {
      await native.recoveryWrite({ key: draft.workflowId, content: JSON.stringify(draft) })
      await prune(native)
    },
    async list() {
      return prune(native).then((records) =>
        latestRecords(records)
          .map(({ draft }) => draft)
          .sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) || left.workflowId.localeCompare(right.workflowId),
          ),
      )
    },
    async discard(workflowId) {
      const inventory = await readInventory(native)
      const ids = inventory.blobs.filter((blob) => blob.key === workflowId).map((blob) => blob.id)
      await Promise.all(ids.map((id) => native.recoveryDelete(id)))
    },
  }
}

export class RecoveryDraftController {
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: WorkflowPairText | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: RecoveryStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  changed(pair: WorkflowPairText): void {
    if (!isDirty(pair)) {
      this.cancelTimer()
      this.pending = null
      this.enqueue(() => this.store.discard(pair.workflowId))
      return
    }
    this.pending = pair
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      const pending = this.pending
      this.pending = null
      if (pending) this.enqueue(() => this.store.save(createRecoveryDraft(pending, this.now())))
    }, RECOVERY_IDLE_MS)
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const pending = this.pending
    this.pending = null
    if (pending) this.enqueue(() => this.store.save(createRecoveryDraft(pending, this.now())))
    await this.queue
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private enqueue(operation: () => Promise<void>): void {
    const next = this.queue.catch(() => undefined).then(operation)
    this.queue = next
    void next.catch(() => undefined)
  }
}

interface ParsedRecoveryRecord {
  readonly blob: RecoveryBlob
  readonly draft: RecoveryDraft
}

interface RecoveryInventory {
  readonly blobs: readonly RecoveryBlob[]
  readonly records: readonly ParsedRecoveryRecord[]
  readonly invalid: readonly RecoveryBlob[]
}

async function readInventory(native: RecoveryNativePort): Promise<RecoveryInventory> {
  const blobs = await native.recoveryList()
  const records: ParsedRecoveryRecord[] = []
  const invalid: RecoveryBlob[] = []
  for (const blob of blobs) {
    const draft = parseRecoveryDraft(blob.content)
    if (draft && draft.workflowId === blob.key) records.push({ blob, draft })
    else invalid.push(blob)
  }
  return { blobs, records, invalid }
}

async function prune(native: RecoveryNativePort): Promise<ParsedRecoveryRecord[]> {
  const inventory = await readInventory(native)
  for (const blob of inventory.invalid) await native.recoveryDelete(blob.id)

  const allRecords = [...inventory.records]
  const latestIds = new Set(latestRecords(allRecords).map(({ blob }) => blob.id))
  const superseded = allRecords
    .filter(({ blob }) => !latestIds.has(blob.id))
    .sort(
      (left, right) =>
        left.draft.updatedAt.localeCompare(right.draft.updatedAt) || left.blob.id.localeCompare(right.blob.id),
    )
  for (const record of superseded) await native.recoveryDelete(record.blob.id)

  const records = allRecords
    .filter(({ blob }) => latestIds.has(blob.id))
    .sort(
      (left, right) =>
        left.draft.updatedAt.localeCompare(right.draft.updatedAt) || left.blob.id.localeCompare(right.blob.id),
    )
  let totalBytes = records.reduce((total, record) => total + record.blob.size, 0)
  while (records.length > MAX_DRAFTS || totalBytes > MAX_RECOVERY_BYTES) {
    const removed = records.shift()
    if (!removed) break
    await native.recoveryDelete(removed.blob.id)
    totalBytes -= removed.blob.size
  }
  return records
}

function latestRecords(records: readonly ParsedRecoveryRecord[]): ParsedRecoveryRecord[] {
  const latest = new Map<string, ParsedRecoveryRecord>()
  for (const record of records) {
    const current = latest.get(record.draft.workflowId)
    if (
      !current ||
      record.draft.updatedAt > current.draft.updatedAt ||
      (record.draft.updatedAt === current.draft.updatedAt && record.blob.id > current.blob.id)
    ) {
      latest.set(record.draft.workflowId, record)
    }
  }
  return [...latest.values()]
}

function parseRecoveryDraft(content: string): RecoveryDraft | null {
  try {
    const value: unknown = JSON.parse(content)
    if (!isRecord(value)) return null
    if (
      value.schemaVersion !== RECOVERY_SCHEMA_VERSION ||
      typeof value.workflowId !== 'string' ||
      !Number.isSafeInteger(value.generation) ||
      typeof value.updatedAt !== 'string'
    ) {
      return null
    }
    const definition = parseDocumentDraft(value.definition)
    const companion = value.companion === null ? null : parseDocumentDraft(value.companion)
    if (!definition || (value.companion !== null && !companion)) return null
    return {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      workflowId: value.workflowId,
      generation: value.generation as number,
      definition,
      companion,
      updatedAt: value.updatedAt,
    }
  } catch {
    return null
  }
}

function parseDocumentDraft(value: unknown): RecoveryDocumentDraft | null {
  if (!isRecord(value)) return null
  if (
    typeof value.path !== 'string' ||
    typeof value.text !== 'string' ||
    !Number.isSafeInteger(value.revision) ||
    !Number.isSafeInteger(value.savedRevision) ||
    !(typeof value.diskHash === 'string' || value.diskHash === null)
  ) {
    return null
  }
  return {
    path: value.path,
    text: value.text,
    revision: value.revision as number,
    savedRevision: value.savedRevision as number,
    diskHash: value.diskHash,
  }
}

function documentDraft(document: WorkflowPairText['definition']): RecoveryDocumentDraft {
  return {
    path: document.path,
    text: document.text,
    revision: document.revision,
    savedRevision: document.savedRevision,
    diskHash: document.diskHash,
  }
}

function isDirty(pair: WorkflowPairText): boolean {
  return (
    pair.definition.revision !== pair.definition.savedRevision ||
    (pair.companion !== null && pair.companion.revision !== pair.companion.savedRevision)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
