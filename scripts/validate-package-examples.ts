import { analyzeCapturedPackage } from '../src/features/packages/package-analysis-pure'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { loadBundledResourceSet } from '../src/lib/contract/bundled-resource-manifest'
import { loadWorkflowPackageContract } from '../src/lib/package-contract/package-contract-loader'
import { loadResourceResolutionContract } from '../src/lib/package-contract/resource-contract-loader'
import { parsePackageExampleCatalog, validatePackageExample } from '../src/lib/examples/package-example-analysis'
import type { PackageExampleDescriptor } from '../src/lib/examples/types'

export async function loadPackageExampleContracts(directory = resolve('contracts')) {
  const provenance = JSON.parse(await readFile(join(directory, 'workflow-package-provenance.json'), 'utf8')) as {
    files: Record<string, string>
  }
  const contract = await loadWorkflowPackageContract(await readFile(join(directory, 'workflow-package-v1.json')), {
    sha256: provenance.files['workflow-package-v1.json']!,
  })
  const resources = await loadResourceResolutionContract(
    await readFile(join(directory, 'workflow-package-resource-resolution-v1.json')),
    { sha256: provenance.files['workflow-package-resource-resolution-v1.json']! },
  )
  if (!contract.ok) throw new Error(contract.message)
  if (!resources.ok) throw new Error(resources.message)
  const authoring = await loadBundledResourceSet(await readFile(join(directory, 'manifest.json'), 'utf8'), (file) =>
    readFile(join(directory, file), 'utf8'),
  )
  return {
    analyze: analyzeCapturedPackage,
    contract: contract.contract,
    resourceContract: resources.contract,
    authoring: authoring.contracts,
  }
}
export async function readPackageExampleFiles(root: string): Promise<PackageExampleDescriptor['files']> {
  const files: { path: string; text: string }[] = []
  async function visit(directory: string): Promise<void> {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('Package examples cannot contain symlinks.')
    const names = await readdir(directory)
    if (!names.length) throw new Error('Package examples cannot contain empty directories.')
    for (const name of names) {
      const path = join(directory, name),
        metadata = await lstat(path)
      if (metadata.isSymbolicLink()) throw new Error('Package examples cannot contain symlinks.')
      if (metadata.isDirectory()) await visit(path)
      else if (metadata.isFile())
        files.push({
          path: relative(root, path).replaceAll('\\', '/'),
          text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(path)),
        })
      else throw new Error('Package examples require ordinary files.')
    }
  }
  await visit(root)
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
export async function validatePackageExamples(
  root = resolve('examples/packages'),
  contractsDirectory = resolve('contracts'),
): Promise<readonly string[]> {
  const errors: string[] = []
  try {
    const catalog = parsePackageExampleCatalog(await readFile(join(root, 'catalog.yaml'), 'utf8'))
    const contracts = await loadPackageExampleContracts(contractsDirectory)
    for (const row of catalog) {
      try {
        let packageRoot = root
        for (const segment of row.path.split('/')) {
          packageRoot = join(packageRoot, segment)
          const metadata = await lstat(packageRoot)
          if (metadata.isSymbolicLink() || !metadata.isDirectory())
            throw new Error('Package catalog paths cannot contain links or non-directories.')
        }
        const example: PackageExampleDescriptor = {
          ...row,
          files: await readPackageExampleFiles(packageRoot),
          readOnly: true,
        }
        errors.push(...(await validatePackageExample(example, contracts)).map((error) => `${row.id}: ${error}`))
      } catch (error) {
        errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return errors
}
