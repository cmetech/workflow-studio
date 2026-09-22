import { artifactRecoveryKey, type ArtifactDocument, type ArtifactLanguage } from '$src/lib/artifacts/types'
import type { WorkflowPairText } from '$src/lib/documents/types'
import {
  RECOVERY_SCHEMA_VERSION,
  type RecoveryBlob,
  type RecoveryRecord,
  type ArtifactRecoveryDraft,
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
    savedGeneration: pair.savedGeneration,
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
          .filter((draft): draft is RecoveryDraft => draft.schemaVersion === 1)
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
  private changeVersion = 0

  constructor(
    private readonly store: RecoveryStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  changed(pair: WorkflowPairText): void {
    this.changeVersion += 1
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
      if (pending) this.enqueueSave(pending, this.changeVersion)
    }, RECOVERY_IDLE_MS)
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const pending = this.pending
    this.pending = null
    if (pending) this.enqueueSave(pending, this.changeVersion)
    await this.queue
  }

  close(): Promise<void> {
    return this.flush()
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

  private enqueueSave(pair: WorkflowPairText, changeVersion: number): void {
    this.enqueue(async () => {
      try {
        await this.store.save(createRecoveryDraft(pair, this.now()))
      } catch (error: unknown) {
        if (changeVersion === this.changeVersion && !this.pending) this.pending = pair
        throw error
      }
    })
  }
}

interface ParsedRecoveryRecord {
  readonly blob: RecoveryBlob
  readonly draft: RecoveryRecord
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
    const draft = parseRecoveryRecord(blob.content)
    if (draft && recordKey(draft) === blob.key) records.push({ blob, draft })
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
    const current = latest.get(recordKey(record.draft))
    if (
      !current ||
      record.draft.updatedAt > current.draft.updatedAt ||
      (record.draft.updatedAt === current.draft.updatedAt && record.blob.id > current.blob.id)
    ) {
      latest.set(recordKey(record.draft), record)
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
      !Number.isSafeInteger(value.savedGeneration) ||
      (value.generation as number) < 0 ||
      (value.savedGeneration as number) < 0 ||
      (value.savedGeneration as number) > (value.generation as number) ||
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
      savedGeneration: value.savedGeneration as number,
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
    pair.generation !== pair.savedGeneration ||
    pair.definition.diskHash === null ||
    pair.definition.revision !== pair.definition.savedRevision ||
    (pair.companion !== null &&
      (pair.companion.diskHash === null || pair.companion.revision !== pair.companion.savedRevision))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export interface ArtifactRecoveryStore {
  save(draft: ArtifactRecoveryDraft): Promise<void>
  list(): Promise<readonly ArtifactRecoveryDraft[]>
  discard(artifactId: string): Promise<void>
}

export function createArtifactRecoveryDraft(document: ArtifactDocument, updatedAt: string): ArtifactRecoveryDraft {
  return {
    schemaVersion: 2,
    recordType: 'artifact',
    artifactId: document.artifactId,
    workspaceId: document.workspaceId,
    path: document.path,
    language: document.language,
    text: document.text,
    revision: document.revision,
    savedRevision: document.savedRevision,
    diskHash: document.diskHash,
    updatedAt,
  }
}

export function createArtifactRecoveryStore(native: RecoveryNativePort): ArtifactRecoveryStore {
  return {
    async save(draft) {
      await native.recoveryWrite({ key: draft.artifactId, content: JSON.stringify(draft) })
      await prune(native)
    },
    async list() {
      return (await prune(native))
        .map(({ draft }) => draft)
        .filter((draft): draft is ArtifactRecoveryDraft => draft.schemaVersion === 2)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.artifactId.localeCompare(b.artifactId))
    },
    async discard(artifactId) {
      const inventory = await readInventory(native)
      await Promise.all(
        inventory.blobs.filter((blob) => blob.key === artifactId).map((blob) => native.recoveryDelete(blob.id)),
      )
    },
  }
}

function recordKey(draft: RecoveryRecord): string {
  return draft.schemaVersion === 1 ? draft.workflowId : draft.artifactId
}

function parseRecoveryRecord(content: string): RecoveryRecord | null {
  const workflow = parseRecoveryDraft(content)
  if (workflow) return workflow
  try {
    const value: unknown = JSON.parse(content)
    if (
      !isRecord(value) ||
      value.schemaVersion !== 2 ||
      value.recordType !== 'artifact' ||
      typeof value.workspaceId !== 'string' ||
      !value.workspaceId ||
      typeof value.artifactId !== 'string' ||
      typeof value.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.updatedAt))
    )
      return null
    const document = parseDocumentDraft(value)
    const languages: readonly string[] = ['python', 'typescript', 'javascript', 'markdown', 'json', 'yaml', 'text']
    if (
      !document ||
      typeof value.language !== 'string' ||
      !languages.includes(value.language) ||
      document.revision < 0 ||
      document.savedRevision < 0 ||
      document.savedRevision > document.revision ||
      !document.path ||
      document.path.includes('\\') ||
      document.path.includes('\0') ||
      document.path.startsWith('/') ||
      document.path.split('/').some((part) => part === '..' || part === '.' || part === '') ||
      value.artifactId !== artifactRecoveryKey(value.workspaceId, document.path)
    )
      return null
    return {
      ...document,
      schemaVersion: 2,
      recordType: 'artifact',
      workspaceId: value.workspaceId,
      artifactId: value.artifactId,
      language: value.language as ArtifactLanguage,
      updatedAt: value.updatedAt,
    }
  } catch {
    return null
  }
}
