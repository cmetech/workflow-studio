import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { expect, it, vi } from 'vitest'
import CommandEditor from './CommandEditor.svelte'

it('supports keyboard edit/preview/reference tabs without rewriting the command', async () => {
  const text = '---\ndescription: Example\n---\n# Body\n'
  const onTextChange = vi.fn()
  render(CommandEditor, {
    path: 'commands/review.md',
    text,
    onTextChange,
    onSave: vi.fn(),
    references: [
      {
        workflowPath: 'main.yaml',
        nodeId: 'review',
        fieldPath: 'nodes[].command',
        kind: 'command',
        ownership: 'packaged',
        artifactPath: 'commands/review.md',
        reference: 'review',
        ruleId: 'nodes[].command',
      },
    ],
  })
  await tick()
  expect(screen.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true')
  await fireEvent.keyDown(screen.getByRole('tab', { name: 'Edit' }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Preview' })).toHaveFocus()
  expect(screen.getByRole('heading', { name: 'Body' })).toBeVisible()
  expect(screen.getByRole('article', { name: 'Command preview' })).not.toHaveTextContent('description: Example')
  await fireEvent.keyDown(screen.getByRole('tab', { name: 'Preview' }), { key: 'End' })
  expect(screen.getByRole('tab', { name: 'References' })).toHaveFocus()
  expect(screen.getByText('main.yaml — review')).toBeVisible()
  await fireEvent.keyDown(screen.getByRole('tab', { name: 'References' }), { key: 'Home' })
  expect(screen.getByRole('tab', { name: 'Edit' })).toHaveFocus()
  expect(screen.getByRole('textbox', { name: 'commands/review.md' })).toBeVisible()
  expect(onTextChange).not.toHaveBeenCalled()
})
it('shows frontmatter problems while permitting invalid draft saves', async () => {
  const onSave = vi.fn()
  render(CommandEditor, {
    path: 'commands/bad.md',
    text: '---\nkey: [invalid\n---\nBody',
    onTextChange: vi.fn(),
    onSave,
  })
  await tick()
  expect(screen.getByRole('list', { name: 'Command problems' }).children.length).toBeGreaterThan(0)
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledOnce()
})
