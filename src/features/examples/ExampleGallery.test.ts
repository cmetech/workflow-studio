import { fireEvent, render, screen, within } from '@testing-library/svelte'
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

const sequentialExample: ExampleDescriptor = {
  ...example,
  id: 'sequential',
  title: 'Sequential chain',
  summary: 'Two dependent nodes.',
  concepts: ['dependencies'],
  highlightedNodeIds: ['first', 'second'],
  definitionPath: 'examples/sequential/workflow.yaml',
  definitionText: 'name: Sequential\n',
}

describe('ExampleGallery', () => {
  it('omits its standalone landmark and title when embedded in a workbench page', () => {
    render(ExampleGallery, {
      catalogState: { phase: 'ready', examples: [example] },
      topicLabels: {},
      onCreateEditableCopy: vi.fn(),
      onOpenDocumentation: vi.fn(),
      embedded: true,
    } as never)

    expect(screen.queryByRole('region', { name: 'Examples' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Examples' })).not.toBeInTheDocument()
  })

  it('previews immutable example YAML and delegates editable-copy creation', async () => {
    const onCreateEditableCopy = vi.fn(async () => undefined)
    const onOpenDocumentation = vi.fn()
    render(ExampleGallery, {
      catalogState: { phase: 'ready', examples: [example, sequentialExample] },
      topicLabels: { 'hermes-legacy:workflow-definition': 'Workflow definition' },
      onCreateEditableCopy,
      onOpenDocumentation,
    })

    const minimalCard = screen.getByRole('article', { name: 'Minimal prompt' })
    expect(within(minimalCard).getByText('hermes-legacy')).toBeVisible()
    expect(within(minimalCard).getByText('starter')).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: 'Preview Minimal prompt' }))
    expect(screen.getByRole('region', { name: 'Minimal prompt preview' })).toHaveTextContent('name: Minimal')
    expect(screen.getByRole('button', { name: 'Back to Examples' })).toBeVisible()
    expect(screen.queryByRole('article', { name: 'Sequential chain' })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Create Editable Copy: Minimal prompt' }))
    expect(onCreateEditableCopy).toHaveBeenCalledWith(example)
    const topic = screen.getByRole('button', { name: 'Open documentation: Workflow definition' })
    await fireEvent.keyDown(topic, { key: 'Enter' })
    await fireEvent.click(topic)
    expect(onOpenDocumentation).toHaveBeenCalledWith(example, 'workflow-definition', topic)
  })

  it('renders loading independently from a resolved empty catalog', async () => {
    const props = {
      catalogState: { phase: 'loading' } as const,
      topicLabels: {},
      onCreateEditableCopy: vi.fn(),
      onOpenDocumentation: vi.fn(),
    }
    const { rerender } = render(ExampleGallery, props)

    expect(screen.getByRole('status')).toHaveTextContent('Loading validated examples…')

    await rerender({ ...props, catalogState: { phase: 'empty' } })
    expect(screen.getByRole('status')).toHaveTextContent('No bundled examples are available.')
    expect(screen.queryByText('Loading validated examples…')).not.toBeInTheDocument()
  })

  it('offers retry only for a recoverable catalog error', async () => {
    const onRetry = vi.fn(async () => undefined)
    render(ExampleGallery, {
      catalogState: { phase: 'error', message: 'Catalog could not be read.' },
      topicLabels: {},
      onCreateEditableCopy: vi.fn(),
      onOpenDocumentation: vi.fn(),
      onRetry,
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Catalog could not be read.')
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading examples' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
