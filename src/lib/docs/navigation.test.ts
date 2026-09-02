import { describe, expect, it } from 'vitest'
import {
  DOCUMENTATION_TASKS,
  GUIDE_GROUPS,
  GUIDE_PRESENTATION,
  REFERENCE_ENTRY_POINTS,
  START_HERE,
} from './navigation'

const guideSources = import.meta.glob('../../../docs/app-guides/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Readonly<Record<string, string>>

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

  it('defines explicit search descriptions and journey order for every bundled guide', () => {
    expect(
      Object.values(GUIDE_PRESENTATION).every(
        (presentation) =>
          typeof presentation.description === 'string' &&
          presentation.description.trim().length > 0 &&
          Number.isInteger(presentation.order),
      ),
    ).toBe(true)

    expect(
      GUIDE_GROUPS.map(({ id }) =>
        Object.entries(GUIDE_PRESENTATION)
          .filter(([, presentation]) => presentation.group === id)
          .sort((left, right) => left[1].order - right[1].order)
          .map(([guideId]) => guideId),
      ),
    ).toEqual([
      ['quick-start', 'workflow-pairs'],
      ['dag-dependencies', 'conditions-and-outputs', 'loops-and-approvals'],
      ['retry-and-triggers', 'companion-policies', 'profiles-and-compatibility'],
      ['problems-and-validation', 'git-versions', 'troubleshooting'],
      ['keyboard-shortcuts'],
    ])
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

  it('has explicit journey metadata for every bundled guide and no missing guide resource', () => {
    const ids = Object.keys(guideSources)
      .map((path) => path.split('/').at(-1)!.replace(/\.md$/, ''))
      .sort()

    expect(Object.keys(GUIDE_PRESENTATION).sort()).toEqual(ids)
    expect(ids).toContain('quick-start')
    expect(ids).toContain('problems-and-validation')
    expect(ids).toContain('keyboard-shortcuts')
  })
})
