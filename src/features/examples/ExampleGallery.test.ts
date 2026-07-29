import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { ExampleDescriptor } from '$src/lib/examples/types'
import ExampleGallery from './ExampleGallery.svelte'

const example: ExampleDescriptor = {
  id: 'minimal',
  title: 'Minimal prompt',
  summary: 'One prompt node.',
  difficulty: 'starter',
  profiles: ['hermes-legacy'],
  profile: 'hermes-legacy',
  concepts: ['prompt'],
  highlightedNodeIds: ['prompt'],
  highlightedFieldIds: ['prompt.node.prompt'],
  documentationTopicIds: ['workflow-definition'],
  definitionPath: 'examples/minimal/workflow.yaml',
  companionPath: null,
  definitionText: 'name: Minimal\n',
  companionText: null,
  readOnly: true,
}

describe('ExampleGallery', () => {
  it('previews immutable example YAML and delegates editable-copy creation', async () => {
    const onCreateEditableCopy = vi.fn(async () => undefined)
    const onOpenDocumentation = vi.fn()
    render(ExampleGallery, {
      examples: [example],
      topicLabels: { 'hermes-legacy:workflow-definition': 'Workflow definition' },
      onCreateEditableCopy,
      onOpenDocumentation,
    })

    expect(screen.getByText('hermes-legacy')).toBeVisible()
    expect(screen.getByText('starter')).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: 'Preview Minimal prompt' }))
    expect(screen.getByLabelText('Example preview')).toHaveTextContent('name: Minimal')
    await fireEvent.click(screen.getByRole('button', { name: 'Create Editable Copy: Minimal prompt' }))
    expect(onCreateEditableCopy).toHaveBeenCalledWith(example)
    const topic = screen.getByRole('button', { name: 'Open documentation: Workflow definition' })
    await fireEvent.keyDown(topic, { key: 'Enter' })
    await fireEvent.click(topic)
    expect(onOpenDocumentation).toHaveBeenCalledWith(example, 'workflow-definition')
  })
})
