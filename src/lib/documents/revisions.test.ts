import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ContractDigest, DocumentAnalysis, TextDocumentState, WorkflowPairText } from './types'
import {
  acceptAnalysis,
  confirmDocumentSaved,
  confirmPairStructureSaved,
  createDocumentRevision,
  editDocumentText,
  isAnalysisCurrent,
  removeCompanion,
  setCompanion,
} from './revisions'
import { isDocumentPairDirty } from '$src/stores/documents'

const contractDigest = `sha256:${'a'.repeat(64)}` as ContractDigest

function document(kind: 'definition' | 'companion', revision = 0): TextDocumentState {
  return {
    id: kind,
    kind,
    path: kind === 'definition' ? 'flow.yaml' : 'flow.hermes.yaml',
    text: `${kind}: ${revision}\n`,
    revision,
    savedRevision: revision,
    diskHash: `hash-${kind}-${revision}`,
  }
}

function pair(): WorkflowPairText {
  return {
    workflowId: 'flow',
    generation: 0,
    savedGeneration: 0,
    definition: document('definition'),
    companion: document('companion'),
  }
}

function analysisFor(workflow: WorkflowPairText, digest = contractDigest): DocumentAnalysis {
  return {
    ...createDocumentRevision(workflow, digest),
    issues: [],
    structurallyValid: true,
    projection: { revision: workflow.definition.revision },
  }
}

describe('document revisions', () => {
  it('increments only the edited document revision and leaves its saved revision unchanged', () => {
    const initial = pair()
    const definitionEdit = editDocumentText(initial, 'definition', 'name: changed\n')
    const companionEdit = editDocumentText(definitionEdit, 'companion', 'language_compatibility: hermes-legacy\n')

    expect(definitionEdit.definition).toMatchObject({ revision: 1, savedRevision: 0, text: 'name: changed\n' })
    expect(definitionEdit.companion).toMatchObject({ revision: 0, savedRevision: 0 })
    expect(companionEdit.definition).toMatchObject({ revision: 1, savedRevision: 0 })
    expect(companionEdit.companion).toMatchObject({ revision: 1, savedRevision: 0 })
  })

  it('changes the saved revision and disk hash only after a confirmed write', () => {
    const edited = editDocumentText(pair(), 'definition', 'name: changed\n')

    expect(edited.definition).toMatchObject({ revision: 1, savedRevision: 0, diskHash: 'hash-definition-0' })

    const saved = confirmDocumentSaved(edited, 'definition', { revision: 1, diskHash: 'hash-confirmed' })

    expect(saved.definition).toMatchObject({ revision: 1, savedRevision: 1, diskHash: 'hash-confirmed' })
    expect(saved.companion).toEqual(edited.companion)
  })

  it('records the exact revision written when editing continues during a save', () => {
    const saving = editDocumentText(pair(), 'definition', 'name: saving\n')
    const editedAgain = editDocumentText(saving, 'definition', 'name: newer\n')

    const confirmed = confirmDocumentSaved(editedAgain, 'definition', {
      revision: saving.definition.revision,
      diskHash: 'hash-saving',
    })

    expect(confirmed.definition).toMatchObject({
      text: 'name: newer\n',
      revision: 2,
      savedRevision: 1,
      diskHash: 'hash-saving',
    })
  })

  it('increments pair generation when the companion is removed', () => {
    const initial = pair()
    const removed = removeCompanion(initial)

    expect(removed).toMatchObject({ generation: 1, companion: null })
    expect(removed.definition).toEqual(initial.definition)
    expect(removeCompanion(removed)).toBe(removed)
  })

  it('tracks companion-only addition and removal as dirty until the pair structure is confirmed saved', () => {
    const legacy = removeCompanion(pair())
    const savedLegacy = confirmPairStructureSaved(legacy, legacy.generation)
    const added = setCompanion(savedLegacy, document('companion'))
    const removedAgain = removeCompanion({ ...pair(), savedGeneration: pair().generation })

    expect(isDocumentPairDirty(added)).toBe(true)
    expect(isDocumentPairDirty(removedAgain)).toBe(true)
    expect(isDocumentPairDirty(confirmPairStructureSaved(added, added.generation))).toBe(false)
  })

  it('requires exact generation, document revisions, and contract digest for current analysis', () => {
    const current = createDocumentRevision(pair(), contractDigest)
    const candidate = analysisFor(pair())

    expect(isAnalysisCurrent(current, candidate)).toBe(true)
    expect(isAnalysisCurrent({ ...current, pairGeneration: 1 }, candidate)).toBe(false)
    expect(isAnalysisCurrent({ ...current, definitionRevision: 1 }, candidate)).toBe(false)
    expect(isAnalysisCurrent({ ...current, companionRevision: 1 }, candidate)).toBe(false)
    expect(isAnalysisCurrent({ ...current, contractDigest: `sha256:${'b'.repeat(64)}` }, candidate)).toBe(false)
  })

  it('never lets out-of-order responses regress the active analysis', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.array(fc.integer(), { minLength: 31, maxLength: 31 }),
        (editCount, orderingKeys) => {
          const states = [pair()]
          for (let index = 0; index < editCount; index += 1) {
            const previous = states[index]
            if (!previous) throw new Error('missing generated state')
            states.push(editDocumentText(previous, 'definition', `name: revision-${index + 1}\n`))
          }

          const currentPair = states.at(-1)
          if (!currentPair) throw new Error('missing current pair')

          const responses = states.map((state) => analysisFor(state))
          const responseOrder = responses
            .map((response, index) => ({ response, key: orderingKeys[index] ?? 0, index }))
            .sort((left, right) => left.key - right.key || left.index - right.index)
            .map(({ response }) => response)

          let session = {
            revision: createDocumentRevision(currentPair, contractDigest),
            analysis: null as DocumentAnalysis | null,
          }
          let acceptedRevision = -1

          for (const response of responseOrder) {
            session = acceptAnalysis(session, response)
            const nextRevision = session.analysis?.definitionRevision ?? -1
            expect(nextRevision).toBeGreaterThanOrEqual(acceptedRevision)
            acceptedRevision = nextRevision
          }

          expect(session.analysis?.definitionRevision).toBe(editCount)
        },
      ),
    )
  })
})
