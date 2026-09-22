import { jsonLanguage } from '@codemirror/lang-json'
import { parseUniqueJson } from './manifest'

/** Replace one existing top-level JSON value without serializing unrelated fields. */
export function replaceManifestProperty(text: string, key: string, value: unknown): string {
  const parsed = parseUniqueJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Package manifest must be an object.')
  const replacement = JSON.stringify(value)
  if (replacement === undefined) throw new Error('Package manifest value must be JSON.')
  const properties = jsonLanguage.parser.parse(text).topNode.getChild('Object')?.getChildren('Property') ?? []
  const property = properties.find((property) => {
    const name = property.getChild('PropertyName')
    return name && JSON.parse(text.slice(name.from, name.to)) === key
  })
  const node = property?.lastChild
  if (!node) throw new Error(`Package manifest field is unavailable: ${key}`)
  return text.slice(0, node.from) + replacement + text.slice(node.to)
}
