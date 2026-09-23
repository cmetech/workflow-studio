import { fireEvent, render, screen } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import PackageInspector from './PackageInspector.svelte'
it('preserves unknown properties when editing publishing fields from current JSON', async () => {
  const change = vi.fn()
  render(PackageInspector, {
    text: JSON.stringify({ displayName: 'Before', unknown: { keep: true } }),
    onTextChange: change,
    onAdvanced: vi.fn(),
  })
  await fireEvent.input(screen.getByLabelText('Display name'), { target: { value: 'After' } })
  expect(JSON.parse(change.mock.calls[0]![0])).toEqual({ displayName: 'After', unknown: { keep: true } })
})
it('keeps invalid source recoverable and does not offer stale form fields', () => {
  render(PackageInspector, { text: '{broken', onTextChange: vi.fn(), onAdvanced: vi.fn() })
  expect(screen.getByRole('alert')).toHaveTextContent(/JSON/)
  expect(screen.queryByLabelText('Display name')).toBeNull()
})
it('preserves exact unknown JSON number bytes during a targeted publishing edit', async () => {
  const change = vi.fn()
  const text = '{ "displayName": "Before", "future": 900719925474099312345 }'
  render(PackageInspector, { text, onTextChange: change, onAdvanced: vi.fn() })
  await fireEvent.input(screen.getByLabelText('Display name'), { target: { value: 'After' } })
  expect(change).toHaveBeenCalledWith('{ "displayName": "After", "future": 900719925474099312345 }')
})
it('edits package identity and tags while preserving unrelated source', async () => {
  const change = vi.fn()
  render(PackageInspector, {
    text: '{"id":"old","tags":["one"],"future":true}',
    onTextChange: change,
    onAdvanced: vi.fn(),
  })
  await fireEvent.input(screen.getByLabelText('Package ID'), { target: { value: 'new' } })
  expect(JSON.parse(change.mock.calls[0]![0])).toEqual({ id: 'new', tags: ['one'], future: true })
  await fireEvent.input(screen.getByLabelText('Tags'), { target: { value: 'one, two' } })
  expect(JSON.parse(change.mock.calls[1]![0])).toEqual({ id: 'old', tags: ['one', 'two'], future: true })
})
