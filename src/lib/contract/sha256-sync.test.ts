import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { sha256Sync } from './sha256-sync'
it('matches SHA-256 across padding boundaries and UTF-8 authored values', () => {
  expect(sha256Sync('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  for (const text of ['', ...Array.from({ length: 130 }, (_, length) => 'x'.repeat(length)), '😀 é 🫠'.repeat(100)])
    expect(sha256Sync(text)).toBe(createHash('sha256').update(text).digest('hex'))
})
