import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import type { Component } from 'svelte'
import type { FormField, WidgetProps } from '$src/lib/forms/types'
import ArrayField from './ArrayField.svelte'
import BooleanField from './BooleanField.svelte'
import CodeField from './CodeField.svelte'
import EnumField from './EnumField.svelte'
import JsonSchemaField from './JsonSchemaField.svelte'
import MapField from './MapField.svelte'
import NumberField from './NumberField.svelte'
import ObjectField from './ObjectField.svelte'
import TextAreaField from './TextAreaField.svelte'
import TextField from './TextField.svelte'

function field(widget: FormField['widget'], schema: Record<string, unknown>): FormField {
  return {
    id: `diagnostic-${widget}`,
    label: `Diagnostic ${widget}`,
    description: `Describe ${widget}.`,
    fieldPath: `nodes[].${widget}`,
    pathTemplate: ['nodes', '$node', widget],
    document: 'definition',
    widget,
    section: 'General',
    order: 1,
    status: 'supported',
    examples: ['value'],
    schema,
    required: false,
    hasDefault: false,
    constraints: Array.isArray(schema.enum) ? { enum: schema.enum } : {},
  }
}

const cases: readonly {
  name: string
  component: Component<WidgetProps>
  field: FormField
  value: unknown
}[] = [
  { name: 'text', component: TextField, field: field('text', { type: 'string' }), value: 'value' },
  { name: 'textarea', component: TextAreaField, field: field('textarea', { type: 'string' }), value: 'value' },
  { name: 'code', component: CodeField, field: field('code', { type: 'string' }), value: 'value' },
  { name: 'number', component: NumberField, field: field('number', { type: 'number' }), value: 1 },
  { name: 'boolean', component: BooleanField, field: field('boolean', { type: 'boolean' }), value: true },
  {
    name: 'enum',
    component: EnumField,
    field: field('enum', { type: 'string', enum: ['one', 'two'] }),
    value: 'one',
  },
  { name: 'json-schema', component: JsonSchemaField, field: field('json-schema', {}), value: true },
  {
    name: 'array',
    component: ArrayField,
    field: field('array', { type: 'array', items: { type: 'string' } }),
    value: ['one'],
  },
  { name: 'map', component: MapField, field: field('map', { type: 'object' }), value: { key: 'value' } },
  {
    name: 'object',
    component: ObjectField,
    field: field('object', { type: 'object', properties: { key: { type: 'string' } } }),
    value: { key: 'value' },
  },
]

describe('widget diagnostics', () => {
  it.each(cases)(
    'renders and references exact authoritative issues for $name controls',
    ({ component, field, value }) => {
      const issue = `Exact ${field.widget} issue.`
      const rendered = render(component, {
        field,
        value,
        present: true,
        issues: [
          {
            code: `issue-${field.widget}`,
            layer: 'contract',
            severity: 'error',
            blocking: true,
            message: issue,
            document: 'definition',
          },
        ],
      })

      const issueElement = screen.getByText(issue)
      expect(issueElement).toHaveAttribute('id', `${field.id}-issue`)
      const controls = [...rendered.container.querySelectorAll('input, select, textarea')]
      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) {
        expect(control).toHaveAttribute('aria-invalid', 'true')
        expect(control.getAttribute('aria-describedby')?.split(' ')).toContain(`${field.id}-issue`)
      }
    },
  )
})
