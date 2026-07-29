<script lang="ts">
  import type { DocumentationIndex } from '$src/lib/docs/types'
  import type { FormField } from '$src/lib/forms/types'

  interface Props {
    field: FormField | undefined
    index?: DocumentationIndex | undefined
  }

  let { field, index }: Props = $props()
  const canonicalFieldId = $derived(field?.id.split('@/')[0])
  const topic = $derived(canonicalFieldId ? index?.byId.get(`field:${canonicalFieldId}`) : undefined)
</script>

{#if !field}
  <p>Select a node to view contract documentation.</p>
{:else}
  <article aria-label={`${field.label} documentation`} data-topic-id={`field:${canonicalFieldId}`}>
    <h3>{topic?.title ?? field.label}</h3>
    <p>{topic?.description ?? field.description}</p>
    {#if topic?.body}<pre>{topic.body}</pre>{/if}
    {#if (topic?.examples ?? field.examples).length > 0}<pre>{JSON.stringify(
          (topic?.examples ?? field.examples)[0],
          null,
          2,
        )}</pre>{/if}
  </article>
{/if}
