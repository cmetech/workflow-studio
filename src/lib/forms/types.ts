import type { Component } from 'svelte'
import type { ContractItemStatus, FieldDescriptor } from '$src/lib/contract/types'
import type { DocumentKind, ValidationIssue } from '$src/lib/documents/types'

export type SupportedWidgetId =
  'text' | 'textarea' | 'code' | 'number' | 'boolean' | 'enum' | 'array' | 'map' | 'object' | 'json-schema'

export interface FormConstraints {
  readonly minimum?: number
  readonly maximum?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly enum?: readonly unknown[]
}

export interface FormField {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly fieldPath: string
  readonly pathTemplate: readonly (string | number)[]
  readonly document: DocumentKind
  readonly nodeKinds?: readonly string[]
  readonly widget: string
  readonly section: string
  readonly order: number
  readonly status: ContractItemStatus
  readonly examples: readonly unknown[]
  readonly schema: Readonly<Record<string, unknown>>
  readonly required: boolean
  readonly hasDefault: boolean
  readonly defaultValue?: unknown
  readonly unit?: string
  readonly compatibilityCode?: string
  readonly constraints: FormConstraints
}

export interface FormFieldCommit {
  readonly field: FormField
  readonly value?: unknown
  readonly remove?: boolean
}

export interface WidgetProps {
  readonly field: FormField
  readonly value?: unknown
  readonly present: boolean
  readonly disabled?: boolean
  readonly issues?: readonly ValidationIssue[]
  readonly onCommit?: ((commit: FormFieldCommit) => void | Promise<void>) | undefined
}

export interface WidgetDefinition {
  readonly id: SupportedWidgetId
  readonly component: Component<WidgetProps>
  readonly accepts: (field: FormField) => boolean
}

export type WidgetResolution =
  | { readonly ok: true; readonly definition: WidgetDefinition }
  | {
      readonly ok: false
      readonly code: 'contract_reader_unsupported_widget'
      readonly message: string
    }

export interface FormCoverageIssue {
  readonly code:
    | 'field_widget_unsupported'
    | 'field_widget_incompatible'
    | 'field_documentation_missing'
    | 'field_section_invalid'
    | 'field_order_invalid'
    | 'field_path_duplicate'
    | 'field_order_duplicate'
    | 'field_schema_missing'
  readonly fieldPath: string
  readonly message: string
}

export function descriptorToFallbackField(field: FieldDescriptor): FormField {
  return {
    id: field.id,
    label: field.label,
    description: field.description,
    fieldPath: field.field_path,
    pathTemplate: field.field_path
      .replaceAll('[*]', '[]')
      .split('.')
      .flatMap((part) => (part.endsWith('[]') ? [part.slice(0, -2), '$node'] : [part])),
    document: field.applicability.documents[0] === 'sidecar' ? 'companion' : 'definition',
    ...(field.applicability.node_kinds ? { nodeKinds: field.applicability.node_kinds } : {}),
    widget: field.widget,
    section: field.section,
    order: field.order,
    status: field.status,
    examples: field.examples,
    schema: {},
    required: false,
    hasDefault: false,
    constraints: {},
  }
}
