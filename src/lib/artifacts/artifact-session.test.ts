import { expect, it } from 'vitest'
import {
  createArtifactDocument,
  editArtifactDocument,
  confirmArtifactSaved,
  reloadArtifactDocument,
} from './artifact-session'

it('preserves invalid exact text and monotonic revisions across edits, saves and reloads', () => {
  const initial = createArtifactDocument('workspace', 'scripts/a.py', 'python', 'ok\r\n', 'disk')
  const edited = editArtifactDocument(initial, 'def broken(:\r\n')
  const newer = editArtifactDocument(edited, 'def later(:\n')
  const saved = confirmArtifactSaved(newer, edited, 'saved')
  expect(saved).toMatchObject({ text: newer.text, revision: 2, savedRevision: 1, dirty: true, diskHash: 'saved' })
  expect(reloadArtifactDocument(saved, 'external', 'external-hash')).toMatchObject({
    revision: 3,
    savedRevision: 3,
    dirty: false,
    origin: 'disk',
  })
  expect(confirmArtifactSaved(newer, { ...edited, path: 'other.py' }, 'wrong')).toBe(newer)
})
