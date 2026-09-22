import { atom } from 'nanostores'
import type { ArtifactDocument } from '$src/lib/artifacts/types'

export const $artifactSession = atom<ArtifactDocument | null>(null)
