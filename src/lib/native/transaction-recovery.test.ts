import { expect, it } from 'vitest'
import { extractTransactionRecovery } from './transaction-recovery'
it('bounds a recovery receipt and explicitly accounts for omitted malformed or excess results', () => {
  const record = {
    relativePath: 'package/original.json',
    destinationPath: 'package/.recovery-123',
    status: 'partial',
    message: 'r'.repeat(2048),
  }
  const receipt = extractTransactionRecovery({
    pathResults: [null, { ...record, relativePath: 42 }, ...Array.from({ length: 130 }, () => record)],
  })
  expect(receipt.pathResults).toHaveLength(128)
  expect(receipt.omittedPathResults).toBe(4)
  expect(receipt.pathResults[0]).toEqual({ ...record, message: 'r'.repeat(1024) })
  expect(record.message).toHaveLength(2048)
})
it('keeps generic errors recoverable without fabricating locations and never truncates a recovery path', () => {
  expect(extractTransactionRecovery(new Error('Conflict'))).toEqual({ pathResults: [], omittedPathResults: 0 })
  const path = 'package/' + 'x'.repeat(32768)
  expect(
    extractTransactionRecovery({ pathResults: [{ relativePath: 'source', destinationPath: path, status: 'partial' }] }),
  ).toEqual({ pathResults: [], omittedPathResults: 1 })
})

it('retains exact absolute recovery locations from successful transactions and binary imports', () => {
  const retained = {
    relativePath: 'pkg/digests.json',
    destinationPath: 'C:/Users/me/AppData/Studio/recovery/original-123',
    status: 'recoveryRetained',
    message: 'Retained for manual recovery.',
  }
  for (const result of [
    { status: 'committed', results: [{ relativePath: 'pkg/digests.json', status: 'written' }, retained] },
    { relativePath: 'pkg/file.bin', recoveryResults: [retained] },
    { pathResults: [retained] },
  ]) {
    expect(extractTransactionRecovery(result)).toEqual({ pathResults: [retained], omittedPathResults: 0 })
  }
})

it('bounds inspection of unknown success arrays and reports uninspected results conservatively', () => {
  let inspected = 0
  const results = Array.from({ length: 1000 }, () => ({
    relativePath: 'pkg/file',
    get status() {
      inspected += 1
      return 'written'
    },
  }))
  const receipt = extractTransactionRecovery({ results })
  expect(inspected).toBeLessThanOrEqual(256)
  expect(receipt).toEqual({ pathResults: [], omittedPathResults: 744 })
})
