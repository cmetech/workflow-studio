import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FormField } from '$src/lib/forms/types'
import ArrayField from './ArrayField.svelte'
import MapField from './MapField.svelte'
import ObjectField from './ObjectField.svelte'

function field(overrides: Partial<FormField>): FormField {
  return {
    id: 'structured',
    label: 'Structured',
    description: 'Structured field.',
    fieldPath: 'nodes[].structured',
    pathTemplate: ['nodes', '$node', 'structured'],
    document: 'definition',
    widget: 'object',
    section: 'Advanced',
    order: 1,
    status: 'supported',
    examples: [{}],
    schema: { type: 'object' },
    required: false,
    hasDefault: false,
    constraints: {},
    ...overrides,
  }
}

describe('recursive structured inspector controls', () => {
  it('edits array items with typed controls and enforces nested numeric constraints locally', async () => {
    const onCommit = vi.fn()
    const arrayField = field({
      id: 'deps',
      label: 'Attempts',
      widget: 'array',
      schema: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 3 } },
    })
    render(ArrayField, { field: arrayField, value: [2], present: true, onCommit })

    expect(screen.queryByRole('textbox', { name: 'Attempts' })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Add Attempts item' }))
    const items = screen.getAllByRole('spinbutton')
    await fireEvent.input(items[1]!, { target: { value: '0' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Attempts' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/must be at least 1/i)
    expect(onCommit).not.toHaveBeenCalled()

    await fireEvent.input(items[1]!, { target: { value: '3' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Attempts' }))
    expect(onCommit).toHaveBeenCalledWith({ field: arrayField, value: [2, 3] })
  })

  it('renders object properties recursively instead of a raw JSON textarea', async () => {
    const onCommit = vi.fn()
    const objectField = field({
      id: 'retry',
      label: 'Retry',
      schema: {
        type: 'object',
        required: ['max_attempts'],
        properties: {
          max_attempts: { type: 'integer', title: 'Max attempts', minimum: 1, maximum: 10 },
          on_error: { type: 'string', title: 'On error', enum: ['fail', 'continue'] },
        },
      },
    })
    render(ObjectField, {
      field: objectField,
      value: { max_attempts: 2, on_error: 'fail' },
      present: true,
      onCommit,
    })

    expect(screen.queryByRole('textbox', { name: 'Retry' })).not.toBeInTheDocument()
    await fireEvent.input(screen.getByRole('spinbutton', { name: 'Max attempts' }), { target: { value: '4' } })
    await fireEvent.change(screen.getByRole('combobox', { name: 'On error' }), { target: { value: '1' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Retry' }))
    expect(onCommit).toHaveBeenCalledWith({ field: objectField, value: { max_attempts: 4, on_error: 'continue' } })
  })

  it('keeps map keys as draft entries and blocks duplicate keys before serialization', async () => {
    const onCommit = vi.fn()
    const mapField = field({
      id: 'agents',
      label: 'Agents',
      widget: 'map',
      schema: {
        type: 'object',
        propertyNames: { pattern: '^[a-z]+$' },
        additionalProperties: {
          type: 'object',
          required: ['description'],
          properties: { description: { type: 'string', title: 'Description', minLength: 1 } },
        },
      },
    })
    render(MapField, {
      field: mapField,
      value: { reviewer: { description: 'Review.' }, writer: { description: 'Write.' } },
      present: true,
      onCommit,
    })

    expect(screen.queryByRole('textbox', { name: 'Agents' })).not.toBeInTheDocument()
    const keys = screen.getAllByRole('textbox', { name: /Agents key/i })
    await fireEvent.input(keys[1]!, { target: { value: 'reviewer' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Agents' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/map keys must be unique/i)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
