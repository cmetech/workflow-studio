import contractText from '../../../contracts/workflow-package-v1.json?raw'
import vectorsText from '../../../contracts/workflow-package-v1-vectors.json?raw'
import provenance from '../../../contracts/workflow-package-provenance.json'
import { loadWorkflowPackageContract, loadWorkflowPackageVectors } from './package-contract-loader'
import type { WorkflowPackageContract, WorkflowPackageVectors } from './types'

let resources: Promise<{ contract: WorkflowPackageContract; vectors: WorkflowPackageVectors }> | undefined
function bundledResources() {
  resources ??= (async () => {
    const encoder = new TextEncoder()
    const contract = await loadWorkflowPackageContract(encoder.encode(contractText), {
      sha256: provenance.files['workflow-package-v1.json'],
    })
    const vectors = await loadWorkflowPackageVectors(encoder.encode(vectorsText), {
      sha256: provenance.files['workflow-package-v1-vectors.json'],
    })
    if (!contract.ok) throw new Error(contract.message)
    if (!vectors.ok) throw new Error(vectors.message)
    return Object.freeze({ contract: contract.contract, vectors: vectors.vectors })
  })()
  return resources
}
export async function loadBundledWorkflowPackageContract(): Promise<WorkflowPackageContract> {
  return (await bundledResources()).contract
}
export async function loadBundledWorkflowPackageVectors(): Promise<WorkflowPackageVectors> {
  return (await bundledResources()).vectors
}
