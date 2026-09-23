import { createHash } from 'node:crypto'
import { beforeAll, expect, it } from 'vitest'
import vectors from '../../contracts/workflow-package-v1-vectors.json'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { loadBundledWorkflowPackageContract } from '$src/lib/package-contract/bundled-package-contract'
import { composePackageDigest, generatePackageDigests, verifyPackageDigests } from '$src/lib/packages/digest'
let contract: Awaited<ReturnType<typeof loadBundledWorkflowPackageContract>>
beforeAll(async () => {
  contract = await loadBundledWorkflowPackageContract()
})
it.each(vectors.digestVectors)(
  'preserves pinned Hermes bytes and digest through the native snapshot boundary: $name',
  async (vector) => {
    const bytes = new Map(
      vector.files.map((file) => [
        file.path,
        file.content.encoding === 'utf-8'
          ? new TextEncoder().encode(file.content.value)
          : new Uint8Array(Buffer.from(file.content.value, 'base64')),
      ]),
    )
    for (const root of ['', 'packages/portable']) {
      const prefix = root ? root + '/' : ''
      const native = createBrowserBridge({
        initialFiles: {},
        initialArtifacts: Object.fromEntries([...bytes].map(([path, data]) => [prefix + path, data])),
      })
      const snapshot = await native.workspaceHashPackage(root)
      expect(
        snapshot.files.map((file) => file.relativePath),
        vector.name,
      ).toEqual(vector.expectedSortedPaths)
      for (const file of snapshot.files) {
        expect(file.size).toBe(bytes.get(file.relativePath)!.length)
        expect(file.sha256).toBe(createHash('sha256').update(bytes.get(file.relativePath)!).digest('hex'))
      }
      expect(await composePackageDigest(snapshot.files, contract.digest_rules)).toBe(vector.expectedPackageDigest)
      const generated = await generatePackageDigests(snapshot.files, contract)
      expect(await verifyPackageDigests(generated, snapshot.files, contract)).toEqual({ ok: true })
    }
  },
)
