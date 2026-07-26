export const RECOVERY_SCHEMA_VERSION = 1 as const

export interface RecoveryDocumentDraft {
  readonly path: string
  readonly text: string
  readonly revision: number
  readonly savedRevision: number
  readonly diskHash: string | null
}

export interface RecoveryDraft {
  readonly schemaVersion: typeof RECOVERY_SCHEMA_VERSION
  readonly workflowId: string
  readonly generation: number
  readonly definition: RecoveryDocumentDraft
  readonly companion: RecoveryDocumentDraft | null
  readonly updatedAt: string
}

export interface RecoveryBlob {
  readonly id: string
  readonly key: string
  readonly content: string
  readonly size: number
}

export interface RecoveryWriteRequest {
  readonly key: string
  readonly content: string
}
