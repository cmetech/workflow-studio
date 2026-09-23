import { beforeAll, describe, expect, it } from 'vitest'
import {
  loadBundledWorkflowPackageContract,
  loadBundledWorkflowPackageVectors,
} from '../package-contract/bundled-package-contract'
import type { WorkflowPackageContract } from '../package-contract/types'
import {
  composePackageDigest,
  orderPackageFileHashes,
  packagePayloadLimitError,
  generatePackageDigests,
  verifyPackageDigests,
  type PackageFileHash,
} from './digest'

let contract: WorkflowPackageContract
beforeAll(async () => {
  contract = await loadBundledWorkflowPackageContract()
})
async function hash(path: string, bytes: Uint8Array): Promise<PackageFileHash> {
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  return { relativePath: path, size: bytes.length, sha256 }
}
describe('package digest composition', () => {
  it('replays both exported publisher-claim rejection vectors', async () => {
    const actual = [await hash('workflow-package.json', new TextEncoder().encode('{}'))]
    for (const vector of (await loadBundledWorkflowPackageVectors()).validationVectors.filter(
      (v) => v.document === 'digests.json',
    )) {
      const result = await verifyPackageDigests(JSON.stringify(vector.value), actual, contract)
      expect(result, vector.name).toMatchObject({
        ok: false,
        code: (vector.expected as { diagnosticCode: string }).diagnosticCode,
      })
    }
  })
  it('generates schema-validated exact claims and rejects stale bytes or malicious claims', async () => {
    const files = [
      await hash('workflow-package.json', new TextEncoder().encode('{}')),
      await hash('assets/x.bin', new Uint8Array([0, 1, 255])),
    ]
    const text = await generatePackageDigests(files, contract)
    expect(await verifyPackageDigests(text, files, contract)).toEqual({ ok: true })
    expect(text).toBe(await generatePackageDigests([...files].reverse(), contract))
    expect(await verifyPackageDigests(text, [files[0]!], contract)).toMatchObject({
      ok: false,
      code: 'package_digest_mismatch',
    })
    const raw = JSON.parse(text)
    raw.files.reverse()
    expect(await verifyPackageDigests(JSON.stringify(raw), files, contract)).toMatchObject({
      ok: false,
      code: 'package_digest_invalid',
    })
    raw.files.reverse()
    raw.packageDigest = '0'.repeat(64)
    expect(await verifyPackageDigests(JSON.stringify(raw), files, contract)).toMatchObject({
      ok: false,
      code: 'package_digest_mismatch',
    })
    raw.files.push({ ...raw.files[0] })
    expect(await verifyPackageDigests(JSON.stringify(raw), files, contract)).toMatchObject({
      ok: false,
      code: 'package_digest_invalid',
    })
  })
  it('executes every package-file boundary recipe including its expected digest', async () => {
    type Content = { encoding: string; value?: string; repeat?: string; count?: number }
    const bytes = (content: Content) =>
      content.encoding === 'base64'
        ? Uint8Array.from(atob(content.value!), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(content.value ?? content.repeat!.repeat(content.count!))
    for (const vector of (await loadBundledWorkflowPackageVectors()).boundaryVectors.filter(
      (v) => (v.recipe as { kind: string }).kind === 'packageFiles',
    )) {
      const recipe = vector.recipe as {
        files: { path: string; content: Content }[]
        generatedFiles: { pathTemplate: string; startIndex: number; count: number; content: Content }[]
      }
      const files: PackageFileHash[] = []
      for (const file of recipe.files) files.push(await hash(file.path, bytes(file.content)))
      for (const generator of recipe.generatedFiles) {
        const data = bytes(generator.content)
        for (let index = generator.startIndex; index < generator.startIndex + generator.count; index++) {
          const path = generator.pathTemplate.replace(/\{index:0(\d+)d\}/g, (_, digits: string) =>
            String(index).padStart(Number(digits), '0'),
          )
          files.push(await hash(path, data))
        }
      }
      const expected = vector.expected as { diagnosticCode: string | null; packageDigest: string }
      expect(packagePayloadLimitError(files, contract), vector.name).toBe(expected.diagnosticCode)
      expect(await composePackageDigest(files, contract.digest_rules), vector.name).toBe(expected.packageDigest)
    }
  })
  it('replays every pinned exact-byte digest vector', async () => {
    for (const vector of (await loadBundledWorkflowPackageVectors()).digestVectors) {
      const source = vector.files as {
        path: string
        content: { encoding: string; value: string }
        expected: { size: number; sha256: string }
      }[]
      const files = await Promise.all(
        source.map(async (file) => {
          const bytes =
            file.content.encoding === 'utf-8'
              ? new TextEncoder().encode(file.content.value)
              : Uint8Array.from(atob(file.content.value), (c) => c.charCodeAt(0))
          const result = await hash(file.path, bytes)
          expect(result.size, vector.name).toBe(file.expected.size)
          expect(result.sha256, vector.name).toBe(file.expected.sha256)
          return result
        }),
      )
      expect(
        orderPackageFileHashes(files, contract.digest_rules).map((f) => f.relativePath),
        vector.name,
      ).toEqual(vector.expectedSortedPaths)
      expect(await composePackageDigest(files, contract.digest_rules), vector.name).toBe(vector.expectedPackageDigest)
    }
  })
  it('excludes only the root digest and preserves nested digest bytes', async () => {
    const files = await Promise.all(
      ['digests.json', 'nested/digests.json', 'script.py'].map((path) => hash(path, new TextEncoder().encode(path))),
    )
    expect(orderPackageFileHashes(files, contract.digest_rules).map((f) => f.relativePath)).toEqual([
      'nested/digests.json',
      'script.py',
    ])
    expect(await composePackageDigest(files, contract.digest_rules)).toBe(
      await composePackageDigest(files.slice(1), contract.digest_rules),
    )
    expect(await composePackageDigest(files, contract.digest_rules)).not.toBe(
      await composePackageDigest(files.slice(2), contract.digest_rules),
    )
  })
  it.each(['../escape', 'a\\b', '.git/config', 'A/../b', 'e\u0301.txt', '\ud800'])(
    'rejects noncanonical path %j',
    async (path) => {
      await expect(composePackageDigest([await hash(path, new Uint8Array())], contract.digest_rules)).rejects.toThrow()
    },
  )
  it('rejects duplicate, casefold and file/directory collisions', async () => {
    for (const paths of [
      ['a', 'a'],
      ['a', 'A'],
      ['a', 'a/b'],
      ['A/x', 'a/y'],
    ]) {
      const files = await Promise.all(paths.map((path) => hash(path, new Uint8Array())))
      await expect(composePackageDigest(files, contract.digest_rules)).rejects.toThrow()
    }
  })
  it('rejects unsafe numeric sizes and malformed SHA bytes', async () => {
    const file = await hash('file', new Uint8Array())
    for (const size of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])
      await expect(composePackageDigest([{ ...file, size }], contract.digest_rules)).rejects.toThrow()
    for (const sha256 of ['', 'a'.repeat(63), 'z'.repeat(64), file.sha256.toUpperCase()])
      await expect(composePackageDigest([{ ...file, sha256 }], contract.digest_rules)).rejects.toThrow()
  })
})
