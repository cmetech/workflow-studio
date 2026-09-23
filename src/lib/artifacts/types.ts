export type ArtifactLanguage = 'python' | 'typescript' | 'javascript' | 'markdown' | 'json' | 'yaml' | 'text'
export type ArtifactSyncOrigin = 'user' | 'disk' | 'recovery'

export interface ArtifactDocument {
  readonly artifactId: string
  readonly workspaceId: string
  readonly path: string
  readonly language: ArtifactLanguage
  readonly text: string
  readonly revision: number
  readonly savedRevision: number
  readonly diskHash: string | null
  readonly dirty: boolean
  readonly origin: ArtifactSyncOrigin
  readonly readOnly: boolean
}

export function artifactRecoveryKey(workspaceId: string, path: string): string {
  return `artifact:${encodeURIComponent(workspaceId)}:${encodeURIComponent(path)}`
}
