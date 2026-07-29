<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
  import { requiredFirstNodeFields, type NewWorkflowInput } from './workspace-actions'

  interface Props {
    contracts: readonly AuthoringContract[]
    activeContract?: (profile: WorkflowProfile) => AuthoringContract | undefined
    onCreate?: (input: NewWorkflowInput) => void | Promise<void>
    onCancel?: () => void
    opener?: HTMLElement | undefined
  }

  let { contracts, activeContract: resolveActiveContract, onCreate, onCancel, opener }: Props = $props()
  let retainedOpener: HTMLElement | undefined
  let dialog = $state<HTMLDivElement>()
  let nameInput = $state<HTMLInputElement>()
  function contractFor(profile: WorkflowProfile): AuthoringContract | undefined {
    const resolved = resolveActiveContract?.(profile)
    if (resolved && resolved.profile === profile && contracts.some(({ contract_digest }) => contract_digest === resolved.contract_digest)) return resolved
    const candidates = contracts.filter((contract) => contract.profile === profile)
    return candidates.length === 1 ? candidates[0] : undefined
  }
  function initialContract(): AuthoringContract | undefined {
    return contractFor('archon-2026-07') ?? contractFor('hermes-legacy')
  }
  let profile = $state<WorkflowProfile>(initialContract()?.profile ?? 'hermes-legacy')
  let name = $state('')
  let description = $state('')
  let firstNodeId = $state('')
  let firstNodeKind = $state(initialContract()?.node_kinds.find(({ status }) => status === 'supported')?.id ?? '')
  let firstNodeValues = $state<Record<string, string>>({})
  const selectedContract = $derived(contractFor(profile))
  const availableContracts = $derived(['archon-2026-07', 'hermes-legacy'].flatMap((candidate) => {
    const contract = contractFor(candidate as WorkflowProfile)
    return contract ? [contract] : []
  }))
  const kinds = $derived(selectedContract?.node_kinds.filter(({ status }) => status === 'supported') ?? [])
  const descriptor = $derived(kinds.find(({ id }) => id === firstNodeKind) ?? kinds[0])
  const fields = $derived(descriptor?.fields.filter(({ status }) => status === 'supported') ?? [])
  const requiredFields = $derived(
    selectedContract && descriptor ? requiredFirstNodeFields(selectedContract, descriptor) : [],
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
      contractFor(value)?.node_kinds.find(({ status }) => status === 'supported')
        ?.id ?? ''
    firstNodeValues = {}
  }

  async function submit(): Promise<void> {
    if (!complete || !descriptor) return
    await onCreate?.({ name, description, profile, firstNodeId, firstNodeKind: descriptor.id, firstNodeValues })
    retainedOpener?.focus()
  }

  function cancel(): void {
    onCancel?.()
    retainedOpener?.focus()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [
      ...(dialog?.querySelectorAll<HTMLElement>('input, textarea, select, button:not(:disabled)') ?? []),
    ]
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMount(() => {
    retainedOpener = opener
    nameInput?.focus()
  })
  onDestroy(() => retainedOpener?.focus())
</script>

<div
  role="presentation"
  class="backdrop"
  data-dialog-backdrop
  onclick={(event) => event.target === event.currentTarget && cancel()}
>
  <div
    bind:this={dialog}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="new-workflow-title"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <h2 id="new-workflow-title">New Workflow</h2>
    <label>Name <input bind:this={nameInput} bind:value={name} /></label>
    <label>Description <textarea bind:value={description}></textarea></label>
    <label>
      Profile
      <select value={profile} onchange={(event) => chooseProfile(event.currentTarget.value as WorkflowProfile)}>
        {#each availableContracts as contract (contract.profile)}
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
      <button type="button" class="secondary" onclick={cancel}>Cancel</button>
      <button type="button" disabled={!complete} onclick={() => void submit()}>Create Workflow</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    z-index: 50;
    inset: 0;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-shadow) 65%, transparent);
  }

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
