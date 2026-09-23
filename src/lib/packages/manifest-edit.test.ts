import { expect, it } from 'vitest'
import { replaceManifestProperty } from './manifest-edit'

it('changes only the existing property value and preserves unknown large integer bytes', () => {
  const source = '{ "id": "old", "version": "1.0.0", "future": 9007199254740993, "nested": {"id":"stay"} }\n'
  expect(replaceManifestProperty(source, 'id', 'new')).toBe(source.replace('"old"', '"new"'))
  expect(replaceManifestProperty(source, 'version', '2.0.0')).toBe(source.replace('"1.0.0"', '"2.0.0"'))
})
it('rejects duplicate keys before making an ambiguous source edit', () => {
  expect(() => replaceManifestProperty('{"id":"a","id":"b"}', 'id', 'c')).toThrow()
  expect(() => replaceManifestProperty('{"id":"a","future":{"x":1,"x":2}}', 'id', 'c')).toThrow()
})
