import type { AuthoringContract } from '$src/lib/contract/types'
import { recordEditorMetric } from '$src/lib/metrics/editor-metrics'
import type { DocumentAnalysis, ValidationIssue, WorkflowPairText } from './types'
import { editDocumentText } from './revisions'
import type { WorkflowMutation } from '$src/lib/yaml/mutations'
import { patchWorkflowDocument, type MutationReference } from '$src/lib/yaml/patch-document'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'

export interface TransactionTexts {
  readonly definition: string
  readonly companion: string | null
}

export interface TransactionRevisions {
  readonly definition: number
  readonly companion: number | null
}

export interface TransactionSelectionHint {
  readonly document: 'definition' | 'companion'
  readonly nodeId?: string
  readonly path?: readonly (string | number)[]
}

export interface YamlTransaction {
  readonly mutation: WorkflowMutation
  readonly label: string
  readonly workflowId: string
  readonly pairGeneration: number
  readonly before: TransactionTexts
  readonly after: TransactionTexts
  readonly beforeRevisions: TransactionRevisions
  readonly afterRevisions: TransactionRevisions
  readonly selection: TransactionSelectionHint
}

export type ApplyWorkflowMutationResult =
  | { ok: true; pair: WorkflowPairText; transaction: YamlTransaction; analysis?: DocumentAnalysis }
  | {
      ok: false
      code: 'mutation_invalid_workflow'
      message: string
      issues: readonly ValidationIssue[]
    }
  | {
      ok: false
      code: 'mutation_requires_resolution'
      message: string
      references: readonly MutationReference[]
    }
  | {
      ok: false
      code:
        | 'mutation_document_missing'
        | 'mutation_invalid_yaml'
        | 'mutation_path_missing'
        | 'mutation_node_missing'
        | 'mutation_duplicate_node_id'
        | 'mutation_ambiguous_alias'
        | 'mutation_contract_invalid'
      message: string
    }

export type MutationAnalyzer = (pair: WorkflowPairText, contract: AuthoringContract) => Promise<DocumentAnalysis>

export async function applyWorkflowMutation(
  pair: WorkflowPairText,
  mutation: WorkflowMutation,
  contract: AuthoringContract,
  analyze: MutationAnalyzer = analyzeMutationLocally,
): Promise<ApplyWorkflowMutationResult> {
  const documentKind = 'document' in mutation ? mutation.document : 'definition'
  const currentDocument = documentKind === 'definition' ? pair.definition : pair.companion
  if (!currentDocument) {
    return {
      ok: false,
      code: 'mutation_document_missing',
      message: 'The requested workflow document is not present.',
    }
  }

  if (requiresStructuralValidation(mutation)) await yieldBeforeStructuralValidation()

  let proposedText: string
  if (mutation.type === 'replace-document') {
    proposedText = mutation.text
  } else {
    const patched = patchWorkflowDocument(currentDocument.text, mutation, contract)
    if (!patched.ok) return patched
    proposedText = patched.text
  }

  const proposedPair = editDocumentText(pair, documentKind, proposedText)
  let structuralAnalysis: DocumentAnalysis | undefined
  if (requiresStructuralValidation(mutation)) {
    const analysis = await analyze(proposedPair, contract)
    structuralAnalysis = analysis
    if (!analysis.structurallyValid && !(analysis.visuallyAuthorable && progressiveDraftMutation(mutation, contract))) {
      return {
        ok: false,
        code: 'mutation_invalid_workflow',
        message: 'The proposed YAML mutation would make the workflow structurally invalid.',
        issues: analysis.issues,
      }
    }
  }

  recordEditorMetric('yamlTransactions')
  return {
    ok: true,
    pair: proposedPair,
    ...(structuralAnalysis ? { analysis: structuralAnalysis } : {}),
    transaction: {
      mutation,
      label: mutationLabel(mutation),
      workflowId: pair.workflowId,
      pairGeneration: pair.generation,
      before: pairTexts(pair),
      after: pairTexts(proposedPair),
      beforeRevisions: pairRevisions(pair),
      afterRevisions: pairRevisions(proposedPair),
      selection: selectionHint(mutation),
    },
  }
}

function analyzeMutationLocally(pair: WorkflowPairText, contract: AuthoringContract): Promise<DocumentAnalysis> {
  return analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'mutation-validation',
      workflowId: pair.workflowId,
      pairGeneration: pair.generation,
      definition: {
        path: pair.definition.path,
        text: pair.definition.text,
        revision: pair.definition.revision,
      },
      companion: pair.companion
        ? {
            path: pair.companion.path,
            text: pair.companion.text,
            revision: pair.companion.revision,
          }
        : null,
      profile: contract.profile,
      contractDigest: contract.contract_digest,
      reason: 'explicit-validate',
    },
    contract,
  )
}

async function yieldBeforeStructuralValidation(): Promise<void> {
  const browserScheduler = (globalThis as typeof globalThis & { readonly scheduler?: { yield?: () => Promise<void> } })
    .scheduler
  if (browserScheduler?.yield) await browserScheduler.yield()
}

function progressiveDraftMutation(mutation: WorkflowMutation, contract: AuthoringContract): boolean {
  if (mutation.type === 'add-node') return true
  if (mutation.type !== 'set-field' && mutation.type !== 'delete-field') return false
  if (mutation.document !== 'definition') return true
  const dagRule = contract.semantic_rules.find(({ id }) => id === 'workflow-dag-v1')
  const nodesPath =
    typeof dagRule?.parameters.nodes_path === 'string' ? dagRule.parameters.nodes_path.split('.') : ['nodes']
  const idField = typeof dagRule?.parameters.id_field === 'string' ? dagRule.parameters.id_field : 'id'
  const dependenciesField =
    typeof dagRule?.parameters.dependencies_field === 'string' ? dagRule.parameters.dependencies_field : 'depends_on'
  if (!nodesPath.every((token, index) => mutation.path[index] === token)) return true
  const field = mutation.path[nodesPath.length + 1]
  return field !== idField && field !== dependenciesField
}

function requiresStructuralValidation(mutation: WorkflowMutation): boolean {
  return mutation.type !== 'replace-document'
}

function pairTexts(pair: WorkflowPairText): TransactionTexts {
  return { definition: pair.definition.text, companion: pair.companion?.text ?? null }
}

function pairRevisions(pair: WorkflowPairText): TransactionRevisions {
  return { definition: pair.definition.revision, companion: pair.companion?.revision ?? null }
}

function mutationLabel(mutation: WorkflowMutation): string {
  switch (mutation.type) {
    case 'set-field':
      return `Set ${mutation.path.join('.')}`
    case 'delete-field':
      return `Delete ${mutation.path.join('.')}`
    case 'add-node':
      return `Add node ${String(mutation.node.id ?? '')}`.trimEnd()
    case 'delete-node':
      return `Delete node ${mutation.nodeId}`
    case 'rename-node':
      return `Rename node ${mutation.from} to ${mutation.to}`
    case 'set-dependencies':
      return `Set dependencies for ${mutation.nodeId}`
    case 'replace-document':
      return `Replace ${mutation.document} YAML`
  }
}

function selectionHint(mutation: WorkflowMutation): TransactionSelectionHint {
  switch (mutation.type) {
    case 'set-field':
    case 'delete-field':
      return { document: mutation.document, path: mutation.path }
    case 'add-node':
      return { document: 'definition', ...(typeof mutation.node.id === 'string' ? { nodeId: mutation.node.id } : {}) }
    case 'delete-node':
      return { document: 'definition' }
    case 'rename-node':
      return { document: 'definition', nodeId: mutation.to }
    case 'set-dependencies':
      return { document: 'definition', nodeId: mutation.nodeId, path: ['depends_on'] }
    case 'replace-document':
      return { document: mutation.document }
  }
}
