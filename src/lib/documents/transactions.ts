import type { AuthoringContract } from '$src/lib/contract/types'
import type { ValidationIssue, WorkflowPairText } from './types'
import { editDocumentText } from './revisions'
import type { WorkflowMutation } from '$src/lib/yaml/mutations'
import { patchWorkflowDocument, type MutationReference } from '$src/lib/yaml/patch-document'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'

export interface TransactionTexts {
  definition: string
  companion: string | null
}

export interface TransactionRevisions {
  definition: number
  companion: number | null
}

export interface TransactionSelectionHint {
  document: 'definition' | 'companion'
  nodeId?: string
  path?: readonly (string | number)[]
}

export interface YamlTransaction {
  mutation: WorkflowMutation
  label: string
  workflowId: string
  pairGeneration: number
  before: TransactionTexts
  after: TransactionTexts
  beforeRevisions: TransactionRevisions
  afterRevisions: TransactionRevisions
  selection: TransactionSelectionHint
}

export type ApplyWorkflowMutationResult =
  | { ok: true; pair: WorkflowPairText; transaction: YamlTransaction }
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

export async function applyWorkflowMutation(
  pair: WorkflowPairText,
  mutation: WorkflowMutation,
  contract: AuthoringContract,
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

  let proposedText: string
  if (mutation.type === 'replace-document') {
    proposedText = mutation.text
  } else {
    const patched = patchWorkflowDocument(currentDocument.text, mutation, contract)
    if (!patched.ok) return patched
    proposedText = patched.text
  }

  const proposedPair = editDocumentText(pair, documentKind, proposedText)
  if (requiresStructuralValidation(mutation)) {
    const analysis = await analyzeWorkflowPair(
      {
        type: 'analyze',
        requestId: 'mutation-validation',
        workflowId: proposedPair.workflowId,
        pairGeneration: proposedPair.generation,
        definition: {
          path: proposedPair.definition.path,
          text: proposedPair.definition.text,
          revision: proposedPair.definition.revision,
        },
        companion: proposedPair.companion
          ? {
              path: proposedPair.companion.path,
              text: proposedPair.companion.text,
              revision: proposedPair.companion.revision,
            }
          : null,
        profile: contract.profile,
        contractDigest: contract.contract_digest,
        reason: 'explicit-validate',
      },
      contract,
    )
    if (!analysis.structurallyValid) {
      return {
        ok: false,
        code: 'mutation_invalid_workflow',
        message: 'The proposed YAML mutation would make the workflow structurally invalid.',
        issues: analysis.issues,
      }
    }
  }

  return {
    ok: true,
    pair: proposedPair,
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

function requiresStructuralValidation(mutation: WorkflowMutation): boolean {
  return mutation.type === 'rename-node' || mutation.type === 'set-dependencies' || mutation.type === 'delete-node'
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
