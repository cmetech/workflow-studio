import type { ArtifactLanguage } from '$src/lib/artifacts/types'

export const RECOVERY_SCHEMA_VERSION = 1 as const

export interface ArtifactRecoveryDraft extends RecoveryDocumentDraft {
  readonly schemaVersion: 2
  readonly recordType: 'artifact'
  readonly artifactId: string
  readonly workspaceId: string
  readonly language: ArtifactLanguage
  readonly updatedAt: string
}

export type RecoveryRecord = RecoveryDraft | ArtifactRecoveryDraft

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
  readonly savedGeneration: number
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
