<script lang="ts">
  import { tick } from 'svelte'
  import type { PackageArtifactAction } from '$src/lib/packages/package-mutations'
  import { classifyPackageArtifact } from '$src/lib/packages/artifact-kind'
  import type { ResourceResolutionContract } from '$src/lib/package-contract/resource-contract-loader'
  import type { WorkflowPackageProjection } from '$src/lib/packages/types'
  import type { PackageCatalog } from '$src/lib/packages/types'
  import type { PackageSelection } from '$src/stores/packages'
  import { MARKETPLACE_INDEX_PATH } from '$src/lib/packages/marketplace-path'
  import { packageGitSummaryLabel, type PackageGitSummary } from './package-git-summary'
  let {
    catalog,
    active = null,
    resourceContract,
    readiness,
    gitSummaries,
    hasMarketplaceIndex = false,
    onOpen,
    onAction,
  }: {
    catalog: PackageCatalog
    active?: PackageSelection | null
    resourceContract?: ResourceResolutionContract | undefined
    readiness?: { readonly root: string; readonly ready: boolean } | undefined
    gitSummaries?: ReadonlyMap<string, PackageGitSummary> | undefined
    hasMarketplaceIndex?: boolean
    onAction?: (
      pkg: WorkflowPackageProjection,
      action: PackageArtifactAction,
      path: string,
      opener: HTMLElement,
    ) => void
    onOpen: (selection: PackageSelection) => void
  } = $props()
  interface Row {
    path: string
    label: string
    kind: 'workflow' | 'artifact'
  }
  const categories = ['Workflows', 'Commands', 'Scripts', 'MCP', 'Supporting resources', 'Package metadata'] as const
  function groups(pkg: WorkflowPackageProjection) {
    const grouped = new Map<string, Row[]>(categories.map((label) => [label, []]))
    const full = (path: string) => (pkg.root ? `${pkg.root}/${path}` : path)
    const members = new Set(
      pkg.workflows.flatMap((member) => [member.definition, ...(member.companion ? [member.companion] : [])]),
    )
    for (const member of pkg.workflows) {
      grouped.get('Workflows')!.push({ path: full(member.definition), label: member.definition, kind: 'workflow' })
      if (member.companion)
        grouped.get('Workflows')!.push({ path: full(member.companion), label: member.companion, kind: 'artifact' })
    }
    for (const artifact of pkg.artifacts) {
      if (artifact.kind !== 'file' || members.has(artifact.path)) continue
      const kind = resourceContract
        ? classifyPackageArtifact({
            path: artifact.path,
            members: pkg.workflows,
            contract: resourceContract,
            textAvailable: true,
          }).kind
        : 'text'
      const mcp = resourceContract?.candidate_rules['compiler-source'].mcp.some(
        (rule) => rule.directory && artifact.path.startsWith(`${rule.directory}/`),
      )
      const category =
        kind === 'manifest' || kind === 'generated'
          ? 'Package metadata'
          : kind === 'command'
            ? 'Commands'
            : kind === 'script'
              ? 'Scripts'
              : mcp
                ? 'MCP'
                : 'Supporting resources'
      grouped.get(category)!.push({ path: artifact.workspacePath, label: artifact.path, kind: 'artifact' })
    }
    return [...grouped].filter(([, rows]) => rows.length).map(([label, rows]) => ({ label, rows }))
  }
  const packages = $derived(catalog.packages.map((pkg) => ({ pkg, groups: groups(pkg) })))
  let context = $state.raw<{ pkg: WorkflowPackageProjection; row: Row; opener: HTMLButtonElement } | null>(null)
  let menu = $state<HTMLDivElement>()
  const actions: readonly { action: PackageArtifactAction; label: string }[] = [
    { action: 'rename', label: 'Rename' },
    { action: 'replace', label: 'Replace' },
    { action: 'reveal', label: 'Reveal' },
    { action: 'open-externally', label: 'Open externally' },
    { action: 'trash', label: 'Trash' },
  ]
  async function showActions(event: MouseEvent | KeyboardEvent, pkg: WorkflowPackageProjection, row: Row) {
    if (!onAction) return
    event.preventDefault()
    context = { pkg, row, opener: event.currentTarget as HTMLButtonElement }
    await tick()
    menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }
  function closeActions() {
    const opener = context?.opener
    context = null
    opener?.focus()
  }
  function disabled(action: PackageArtifactAction): boolean {
    if (!context || action === 'reveal' || action === 'open-externally') return false
    const { pkg, row } = context
    const artifact = pkg.artifacts.find((item) => item.workspacePath === row.path)
    const member = pkg.workflows.some((item) => item.definition === row.label || item.companion === row.label)
    return (
      artifact?.readOnly !== false ||
      ['workflow-package.json', 'digests.json'].includes(row.label) ||
      (member && (action === 'replace' || action === 'trash'))
    )
  }
  function menuKeys(event: KeyboardEvent) {
    event.stopPropagation()
    if (event.key === 'Escape' || event.key === 'Tab') {
      closeActions()
      if (event.key === 'Escape') event.preventDefault()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...menu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    items[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    ]?.focus()
  }
  function invoke(action: PackageArtifactAction) {
    const selected = context
    if (!selected || disabled(action)) return
    closeActions()
    onAction?.(selected.pkg, action, selected.row.path, selected.opener)
  }
  function navigate(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=treeitem]')
        : [],
    )
    const index = items.indexOf(event.target as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    event.preventDefault()
    items[next]?.focus()
  }
</script>

<div tabindex="-1" role="tree" aria-label="Packages" onkeydown={navigate}>
  {#each packages as { pkg, groups: categoryGroups } (pkg.root)}
    <button
      role="treeitem"
      aria-level="1"
      aria-expanded="true"
      aria-selected={active?.packageId === pkg.id && active.kind === 'overview'}
      onclick={() => onOpen({ packageId: pkg.id, kind: 'overview' })}
      >{pkg.id} package
      <small
        >{pkg.manifest.version} | {readiness?.root === pkg.root
          ? readiness.ready
            ? 'Static checks complete'
            : 'Preparation blocked'
          : 'Validation incomplete'} | {packageGitSummaryLabel(gitSummaries?.get(pkg.root))}</small
      ></button
    >
    {#each categoryGroups as group (group.label)}
      <div role="group" aria-label={group.label}>
        <div class="category-label" aria-hidden="true">{group.label}</div>
        {#each group.rows as row (row.path)}
          <button
            role="treeitem"
            aria-level="2"
            aria-haspopup={onAction ? 'menu' : undefined}
            oncontextmenu={(event) => showActions(event, pkg, row)}
            onkeydown={(event) => {
              if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
                void showActions(event, pkg, row)
            }}
            aria-selected={active?.path === row.path}
            onclick={() => onOpen({ packageId: pkg.id, kind: row.kind, path: row.path })}>{row.label}</button
          >
        {/each}
      </div>
    {/each}
  {/each}
  {#if hasMarketplaceIndex && catalog.packages[0]}
    <button
      role="treeitem"
      aria-level="1"
      aria-selected={active?.path === MARKETPLACE_INDEX_PATH}
      onclick={() => onOpen({ packageId: catalog.packages[0]!.id, kind: 'artifact', path: MARKETPLACE_INDEX_PATH })}
      >Marketplace index</button
    >
  {/if}
</div>
{#if context}
  <div bind:this={menu} role="menu" aria-label="Artifact actions" tabindex="-1" onkeydown={menuKeys}>
    {#each actions as item (item.action)}<button
        role="menuitem"
        disabled={disabled(item.action)}
        onclick={() => invoke(item.action)}>{item.label}</button
      >{/each}
    {#if context.row.kind === 'workflow'}<button role="menuitem" onclick={() => invoke('remove-workflow')}
        >Remove Workflow</button
      >{/if}
  </div>
{/if}
{#if catalog.packages.length === 0}<p>No packages discovered in this workspace.</p>{/if}
{#each catalog.findings as finding, index (index)}<p role="alert">{finding.path}: {finding.message}</p>
  {#if finding.path.split('/').at(-1) === 'workflow-package.json'}<button
      onclick={() => onOpen({ packageId: `manifest:${finding.path}`, kind: 'artifact', path: finding.path })}
      >Repair manifest: {finding.path}</button
    >{/if}
{/each}

<style>
  .category-label {
    padding: var(--space-2) var(--space-3);
    font-weight: 600;
    color: var(--color-text-muted);
  }
  button {
    display: block;
    width: 100%;
    text-align: left;
  }
  button[aria-level='2'] {
    padding-left: 1.5rem;
  }
  small {
    display: block;
    color: var(--color-text-muted);
  }
  [aria-selected='true'] {
    background: var(--color-selection-editor);
  }
  button:focus-visible {
    box-shadow: var(--focus-ring);
  }
</style>
