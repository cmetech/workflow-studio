import { describe, expect, it } from 'vitest'
import { profileLabel, workflowCopy } from './workflow-copy'

describe('presentation copy', () => {
  it.each([
    ['Hermes workflows and HERMES docs', 'loop24 workflows and loop24 docs'],
    ['.hermes.yaml', '.hermes.yaml'],
    ['hermes-legacy', 'hermes-legacy'],
    ['/opt/hermes/workflow.yaml', '/opt/hermes/workflow.yaml'],
    ['C:\\tools\\hermes\\workflow.yaml', 'C:\\tools\\hermes\\workflow.yaml'],
    ['my_hermes_identifier', 'my_hermes_identifier'],
    ['Hermes. Next step.', 'loop24. Next step.'],
  ])('formats %s while preserving technical tokens', (input, expected) => {
    expect(workflowCopy(input)).toBe(expected)
  })

  it('labels the legacy profile without changing other profile values', () => {
    expect(profileLabel('hermes-legacy')).toBe('Legacy')
    expect(profileLabel('v1')).toBe('v1')
  })
})
