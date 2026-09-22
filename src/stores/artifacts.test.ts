import { expect, it } from 'vitest'
import { $artifactSession } from './artifacts'
import { createArtifactDocument, editArtifactDocument } from '$src/lib/artifacts/artifact-session'

it('publishes exact artifact drafts and clears selection without mutating the previous revision', () => {
  const initial = createArtifactDocument('workspace', 'a.py', 'python', 'saved', 'hash')
  const seen: (string | null)[] = []
  const stop = $artifactSession.subscribe((document) => seen.push(document?.text ?? null))
  $artifactSession.set(initial)
  $artifactSession.set(editArtifactDocument(initial, 'invalid(:\r\n'))
  $artifactSession.set(null)
  stop()
  expect(seen).toEqual([null, 'saved', 'invalid(:\r\n', null])
  expect(initial.text).toBe('saved')
})
