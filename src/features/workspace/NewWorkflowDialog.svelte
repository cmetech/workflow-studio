<script lang="ts">
  import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
  import { requiredFirstNodeFields, type NewWorkflowInput } from './workspace-actions'

  interface Props {
    contracts: readonly AuthoringContract[]
    onCreate?: (input: NewWorkflowInput) => void | Promise<void>
    onCancel?: () => void
  }

  let { contracts, onCreate, onCancel }: Props = $props()
  function initialContract(): AuthoringContract | undefined {
    return contracts.find(({ profile }) => profile === 'archon-2026-07') ?? contracts[0]
  }
  let profile = $state<WorkflowProfile>(initialContract()?.profile ?? 'hermes-legacy')
  let name = $state('')
  let description = $state('')
  let firstNodeId = $state('')
  let firstNodeKind = $state(initialContract()?.node_kinds.find(({ status }) => status === 'supported')?.id ?? '')
  let firstNodeValues = $state<Record<string, string>>({})
  const activeContract = $derived(contracts.find((contract) => contract.profile === profile))
  const kinds = $derived(activeContract?.node_kinds.filter(({ status }) => status === 'supported') ?? [])
  const descriptor = $derived(kinds.find(({ id }) => id === firstNodeKind) ?? kinds[0])
  const fields = $derived(descriptor?.fields.filter(({ status }) => status === 'supported') ?? [])
  const requiredFields = $derived(
    activeContract && descriptor ? requiredFirstNodeFields(activeContract, descriptor) : [],
  )
  const requiredIds = $derived(new Set(requiredFields.map(({ id }) => id)))
  const complete = $derived(
    name.trim().length > 0 &&
      description.trim().length > 0 &&
      firstNodeId.trim().length > 0 &&
      Boolean(descriptor) &&
      requiredFields.every(({ id }) => (firstNodeValues[id] ?? '').trim().length > 0),
  )

  function chooseProfile(value: WorkflowProfile): void {
    profile = value
    firstNodeKind =
      contracts.find((contract) => contract.profile === value)?.node_kinds.find(({ status }) => status === 'supported')
        ?.id ?? ''
    firstNodeValues = {}
  }

  function submit(): void {
    if (!complete || !descriptor) return
    void onCreate?.({ name, description, profile, firstNodeId, firstNodeKind: descriptor.id, firstNodeValues })
  }
</script>

<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="new-workflow-title">
  <h2 id="new-workflow-title">New Workflow</h2>
  <label>Name <input bind:value={name} /></label>
  <label>Description <textarea bind:value={description}></textarea></label>
  <label>
    Profile
    <select value={profile} onchange={(event) => chooseProfile(event.currentTarget.value as WorkflowProfile)}>
      {#each contracts as contract (contract.profile)}
        <option value={contract.profile}>{contract.profile}</option>
      {/each}
    </select>
  </label>
  <label>
    First node kind
    <select bind:value={firstNodeKind} onchange={() => (firstNodeValues = {})}>
      {#each kinds as kind (kind.id)}<option value={kind.id}>{kind.label}</option>{/each}
    </select>
  </label>
  <label>First node ID <input bind:value={firstNodeId} /></label>
  {#each fields as field (field.id)}
    <label>
      {field.label}{requiredIds.has(field.id) ? '' : ' (optional)'}
      <input
        value={firstNodeValues[field.id] ?? ''}
        oninput={(event) => (firstNodeValues = { ...firstNodeValues, [field.id]: event.currentTarget.value })}
      />
    </label>
  {/each}
  <footer>
    <button type="button" class="secondary" onclick={onCancel}>Cancel</button>
    <button type="button" disabled={!complete} onclick={submit}>Create Workflow</button>
  </footer>
</div>

<style>
  .dialog {
    display: grid;
    gap: 0.75rem;
    width: min(32rem, calc(100% - 2rem));
    padding: 1rem;
    border: 1px solid var(--color-edge);
    border-radius: 0.625rem;
    color: var(--color-text);
    background: var(--color-surface);
  }

  h2 {
    margin: 0;
  }

  label {
    display: grid;
    gap: 0.25rem;
    font-weight: 650;
  }

  input,
  textarea,
  select {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.25rem;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    background: var(--color-background);
  }

  footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .secondary {
    color: var(--color-text);
    background: var(--color-node);
  }
</style>
