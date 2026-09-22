<script lang="ts">
  import { jsonLanguage } from '@codemirror/lang-json'
  let {
    text,
    onTextChange,
    onAdvanced,
    readOnly = false,
  }: { text: string; onTextChange: (text: string) => void; onAdvanced: () => void; readOnly?: boolean } = $props()
  const fields = [
    ['id', 'Package ID'],
    ['displayName', 'Display name'],
    ['version', 'Version'],
    ['description', 'Description'],
    ['license', 'License'],
    ['publisher', 'Publisher'],
  ] as const
  const parsed = $derived.by(() => {
    try {
      const value: unknown = JSON.parse(text)
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
    } catch {
      return null
    }
  })
  function edit(key: string, value: string | readonly string[]) {
    if (!parsed || readOnly) return
    const object = jsonLanguage.parser.parse(text).topNode.getChild('Object')
    if (!object) return
    const properties = object.getChildren('Property')
    const property = [...properties].reverse().find((property) => {
      const name = property.getChild('PropertyName')
      return name && JSON.parse(text.slice(name.from, name.to)) === key
    })
    const node = property?.lastChild
    if (node) onTextChange(text.slice(0, node.from) + JSON.stringify(value) + text.slice(node.to))
    else
      onTextChange(
        text.slice(0, object.to - 1) +
          (properties.length ? ',' : '') +
          JSON.stringify(key) +
          ': ' +
          JSON.stringify(value) +
          text.slice(object.to - 1),
      )
  }
</script>

<section aria-label="Package inspector">
  <h2>Publishing metadata</h2>
  {#if parsed}{#each fields as [key, label] (key)}<label
        >{label}<input
          value={typeof parsed[key] === 'string' ? parsed[key] : ''}
          disabled={readOnly}
          oninput={(event) => edit(key, event.currentTarget.value)}
        /></label
      >{/each}
    <label
      >Tags<input
        disabled={readOnly}
        value={Array.isArray(parsed.tags) ? parsed.tags.join(', ') : ''}
        oninput={(event) =>
          edit(
            'tags',
            event.currentTarget.value
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
          )}
      /></label
    >
  {:else}<p role="alert">Repair the JSON source to edit publishing fields. Your draft is preserved.</p>{/if}
  <button onclick={onAdvanced}>Advanced Source</button>
</section>

<style>
  section {
    padding: var(--space-3);
  }
  label {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }
  input {
    min-width: 0;
  }
</style>
