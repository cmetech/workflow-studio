import { describe, expect, it } from 'vitest'
import {
  DOCUMENTATION_TASKS,
  GUIDE_GROUPS,
  GUIDE_PRESENTATION,
  REFERENCE_ENTRY_POINTS,
  START_HERE,
} from './navigation'

describe('documentation navigation metadata', () => {
  it('keeps the first-use reading path and task destinations available', () => {
    expect(START_HERE.map(({ topicId }) => topicId)).toEqual([
      'guide:quick-start',
      'guide:workflow-pairs',
      'guide:dag-dependencies',
      'guide:problems-and-validation',
      'guide:keyboard-shortcuts',
    ])
    expect(DOCUMENTATION_TASKS.map(({ id, topicId }) => ({ id, topicId }))).toEqual(
      expect.arrayContaining([
        { id: 'create-workflow', topicId: 'guide:quick-start' },
        { id: 'fix-problem', topicId: 'guide:problems-and-validation' },
        { id: 'keyboard-shortcuts', topicId: 'guide:keyboard-shortcuts' },
      ]),
    )
  })

  it('keeps every guide in one journey with scenario copy', () => {
    expect(GUIDE_GROUPS.map(({ id }) => id)).toEqual([
      'getting-started',
      'build-graph',
      'configure-behavior',
      'review-recover',
      'use-application',
    ])
    expect(GUIDE_PRESENTATION['conditions-and-outputs']).toEqual(
      expect.objectContaining({ group: 'build-graph', useWhen: expect.stringMatching(/output|condition/i) }),
    )
    expect(Object.values(GUIDE_PRESENTATION).every(({ useWhen }) => useWhen.trim().length > 0)).toBe(true)
  })

  it('keeps reference entry points at concept level', () => {
    expect(REFERENCE_ENTRY_POINTS.map(({ group }) => group)).toEqual([
      'node-types',
      'common-node-settings',
      'workflow-fields',
      'companion-policy',
      'language-contract',
    ])
  })
})
