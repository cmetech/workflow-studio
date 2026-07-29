import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import type { FormField } from '$src/lib/forms/types'
import { fieldsForNode } from '$src/lib/forms/widget-registry'
import ArrayField from './ArrayField.svelte'
import JsonSchemaField from './JsonSchemaField.svelte'
import MapField from './MapField.svelte'
import NumberField from './NumberField.svelte'
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

  it('selects the object branch of production hookSpecificOutput and authors its nested const and enum fields', async () => {
    const onCommit = vi.fn()
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )!
    const hookOutput = fieldsForNode(productionContract, 'command').find(
      ({ fieldPath }) => fieldPath === 'nodes[].hooks.*[].response.hookSpecificOutput',
    )!

    render(ObjectField, { field: hookOutput, value: null, present: true, onCommit })
    const branch = screen.getByRole('combobox', { name: 'Hookspecificoutput type' })
    await fireEvent.change(branch, { target: { value: '1' } })
    expect(screen.getByRole('combobox', { name: 'Hookeventname' })).toHaveDisplayValue('ConfigChange')
    await fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    expect(screen.getByRole('combobox', { name: 'Action' })).toHaveDisplayValue('accept')

    await fireEvent.click(screen.getByRole('button', { name: 'Apply Hookspecificoutput' }))
    expect(onCommit).toHaveBeenCalledWith({
      field: hookOutput,
      value: { hookEventName: 'ConfigChange', action: 'accept' },
    })
  })

  it('keeps both production thinking branches typed with const and branch-local numeric constraints', async () => {
    const onCommit = vi.fn()
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )!
    const thinking = fieldsForNode(productionContract, 'command').find(
      ({ fieldPath }) => fieldPath === 'nodes[].thinking',
    )!

    render(ObjectField, { field: thinking, value: 'adaptive', present: true, onCommit })
    const branch = screen.getByRole('combobox', { name: 'Thinking type' })
    const scalar = screen.getByRole('combobox', { name: 'Thinking value' })
    expect(scalar).toHaveDisplayValue('adaptive')
    await fireEvent.change(scalar, { target: { value: '1' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Thinking' }))
    expect(onCommit).toHaveBeenLastCalledWith({ field: thinking, value: 'disabled' })

    await fireEvent.change(branch, { target: { value: '1' } })
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveDisplayValue('enabled')
    const budget = screen.getByRole('spinbutton', { name: /budget tokens/i })
    await fireEvent.input(budget, { target: { value: '0' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Thinking' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/budget tokens must be at least 1/i)

    await fireEvent.input(budget, { target: { value: '8' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Thinking' }))
    expect(onCommit).toHaveBeenLastCalledWith({ field: thinking, value: { type: 'enabled', budgetTokens: 8 } })
  })

  it('allows dynamic keys when additionalProperties is omitted and still enforces duplicate and property-name rules', async () => {
    const onCommit = vi.fn()
    const freeFormMap = field({
      id: 'free-form',
      label: 'Free form',
      widget: 'map',
      schema: { type: 'object', propertyNames: { pattern: '^[a-z]+$' } },
    })
    render(MapField, { field: freeFormMap, value: { reviewer: 'Review.' }, present: true, onCommit })

    await fireEvent.click(screen.getByRole('button', { name: 'Add Free form entry' }))
    const keys = screen.getAllByRole('textbox', { name: /Free form key/i })
    await fireEvent.input(keys[1]!, { target: { value: 'reviewer' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Free form' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/map keys must be unique/i)

    await fireEvent.input(keys[1]!, { target: { value: 'Writer' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Free form' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/key "Writer" is not allowed/i)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('offers dynamic entry creation for a production free-form map with omitted additionalProperties', async () => {
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )!
    const updatedInput = fieldsForNode(productionContract, 'command').find(
      ({ fieldPath }) => fieldPath === 'nodes[].hooks.*[].response.hookSpecificOutput.updatedInput',
    )!
    expect(Object.hasOwn(updatedInput.schema, 'additionalProperties')).toBe(false)

    render(MapField, { field: updatedInput, value: {}, present: true })
    expect(screen.getByRole('button', { name: 'Add Updatedinput entry' })).toBeEnabled()
  })

  it('round-trips every published production json-schema example across the full JSON value domain', async () => {
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )!
    const jsonFields = productionContract.node_kinds
      .flatMap(({ id }) => fieldsForNode(productionContract, id))
      .filter(
        (candidate, index, fields) =>
          candidate.widget === 'json-schema' && fields.findIndex(({ id }) => id === candidate.id) === index,
      )
    expect(jsonFields.length).toBeGreaterThan(0)

    for (const jsonField of jsonFields) {
      const onCommit = vi.fn()
      const example = structuredClone(jsonField.examples[0])
      const rendered = render(JsonSchemaField, { field: jsonField, value: example, present: true, onCommit })
      await fireEvent.click(rendered.getByRole('button', { name: `Apply ${jsonField.label}` }))
      expect(onCommit, jsonField.fieldPath).toHaveBeenCalledWith({ field: jsonField, value: example })
      rendered.unmount()
    }
  })

  it('enforces the production loop conditional requirement and selected gate-message branch constraints locally', async () => {
    const onCommit = vi.fn()
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )!
    const loop = fieldsForNode(productionContract, 'loop').find(({ fieldPath }) => fieldPath === 'nodes[].loop')!

    const first = render(ObjectField, {
      field: loop,
      value: { max_iterations: 3, prompt: 'Try again.', until: 'done', interactive: true },
      present: true,
      onCommit,
    })
    await fireEvent.click(first.getByRole('button', { name: 'Apply Loop' }))
    expect(first.getByRole('alert')).toHaveTextContent(/loop requires gate message/i)
    expect(onCommit).not.toHaveBeenCalled()
    first.unmount()

    const second = render(ObjectField, {
      field: loop,
      value: { max_iterations: 3, prompt: 'Try again.', until: 'done', interactive: true, gate_message: 0 },
      present: true,
      onCommit,
    })
    await fireEvent.click(second.getByRole('button', { name: 'Apply Loop' }))
    expect(second.getByRole('alert')).toHaveTextContent(/gate message uses a disallowed value/i)
    expect(onCommit).not.toHaveBeenCalled()
    second.unmount()
  })

  it('rejects the production exclusive-minimum timeout before committing and accepts a positive value', async () => {
    const onCommit = vi.fn()
    const productionContract = (await loadBundledAuthoringContracts()).find(
      ({ profile }) => profile === 'archon-2026-07',
    )!
    const timeout = fieldsForNode(productionContract, 'bash').find(({ fieldPath }) => fieldPath === 'nodes[].timeout')!
    render(NumberField, { field: timeout, value: 0, present: true, onCommit })

    await fireEvent.click(screen.getByRole('button', { name: 'Apply Timeout' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/timeout must be greater than 0/i)
    expect(onCommit).not.toHaveBeenCalled()

    await fireEvent.input(screen.getByRole('spinbutton', { name: 'Timeout' }), { target: { value: '1' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Timeout' }))
    expect(onCommit).toHaveBeenCalledWith({ field: timeout, value: 1 })
  })

  it('preserves authoritative structured issues alongside local draft validation errors', async () => {
    const constrained = field({
      id: 'constrained',
      label: 'Constrained',
      widget: 'array',
      schema: { type: 'array', minItems: 2, items: { type: 'string' } },
    })
    render(ArrayField, {
      field: constrained,
      value: ['one'],
      present: true,
      issues: [
        {
          code: 'authoritative',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'Authoritative array issue.',
          document: 'definition',
        },
      ],
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Apply Constrained' }))
    expect(screen.getByText(/authoritative array issue/i)).toBeVisible()
    expect(screen.getByText(/constrained must have at least 2 items/i)).toBeVisible()
  })
})
