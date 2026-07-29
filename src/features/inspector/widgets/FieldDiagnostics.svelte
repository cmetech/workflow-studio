<script lang="ts">
  import type { ValidationIssue } from '$src/lib/documents/types'
  import type { FormField } from '$src/lib/forms/types'

  interface Props {
    field: FormField
    issues?: readonly ValidationIssue[]
    localErrors?: readonly string[]
  }

  let { field, issues = [], localErrors = [] }: Props = $props()
  const messages = $derived([...issues.map(({ message }) => message), ...localErrors])
</script>

<p id={`${field.id}-description`} class="help">{field.description}</p>
{#if messages.length > 0}<p id={`${field.id}-issue`} class="issue" role="alert">{messages.join(' ')}</p>{/if}

<style>
  p {
    margin: 0.25rem 0;
    color: var(--color-text-muted);
    font-size: 0.68rem;
  }
  .issue {
    color: var(--color-danger);
  }
</style>
