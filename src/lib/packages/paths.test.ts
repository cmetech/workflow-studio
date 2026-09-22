import { describe, expect, it } from 'vitest'
import { packagePathError, packagePathIdentity } from './paths'

describe('pinned Unicode package path behavior', () => {
  it.each([
    ['Stra\u00dfe', 'STRASSE'],
    ['\u03c2', '\u03c3'],
    ['\ufb00', 'ff'],
    ['\u0130', 'i\u0307'],
    ['\uac00', '\u1100\u1161'],
  ])('gives %s and %s the same canonical identity', (left, right) => {
    expect(packagePathIdentity(left)).toBe(packagePathIdentity(right))
  })

  it('rejects non-NFC paths instead of silently rewriting them', () => {
    expect(packagePathError('cafe\u0301.yaml')).toBe('package_path_collision')
    expect(packagePathError('caf\u00e9.yaml')).toBeNull()
    expect(packagePathError('\u1100\u1161.yaml')).toBe('package_path_collision')
    expect(packagePathError('\uac00.yaml')).toBeNull()
  })

  it('uses the pinned Unicode table rather than host-version case changes', () => {
    // These Cyrillic characters were unassigned in Unicode 14 and must remain distinct at this pin.
    expect(packagePathIdentity('\u1c89')).not.toBe(packagePathIdentity('\u1c8a'))
  })
})
