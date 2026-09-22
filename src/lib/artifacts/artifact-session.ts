import { artifactRecoveryKey, type ArtifactDocument, type ArtifactLanguage, type ArtifactSyncOrigin } from './types'

export function createArtifactDocument(
  workspaceId: string,
  path: string,
  language: ArtifactLanguage,
  text: string,
  diskHash: string | null,
  readOnly = false,
): ArtifactDocument {
  return {
    artifactId: artifactRecoveryKey(workspaceId, path),
    workspaceId,
    path,
    language,
    text,
    diskHash,
    revision: 0,
    savedRevision: 0,
    dirty: diskHash === null,
    origin: 'disk',
    readOnly,
  }
}

export function editArtifactDocument(
  document: ArtifactDocument,
  text: string,
  origin: ArtifactSyncOrigin = 'user',
): ArtifactDocument {
  if (document.readOnly || document.text === text) return document
  return { ...document, text, revision: document.revision + 1, dirty: true, origin }
}

export function confirmArtifactSaved(
  current: ArtifactDocument,
  captured: ArtifactDocument,
  diskHash: string,
): ArtifactDocument {
  if (
    current.artifactId !== captured.artifactId ||
    current.path !== captured.path ||
    captured.revision < current.savedRevision ||
    captured.revision > current.revision
  )
    return current
  return { ...current, savedRevision: captured.revision, diskHash, dirty: current.revision !== captured.revision }
}

export function reloadArtifactDocument(document: ArtifactDocument, text: string, diskHash: string): ArtifactDocument {
  const revision = document.revision + 1
  return { ...document, text, diskHash, revision, savedRevision: revision, dirty: false, origin: 'disk' }
}
