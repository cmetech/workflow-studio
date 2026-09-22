<script lang="ts">
  import { classifyPackageArtifact } from '$src/lib/packages/artifact-kind'
  import type { ResourceResolutionContract } from '$src/lib/package-contract/resource-contract-loader'
  import type { WorkflowPackageProjection } from '$src/lib/packages/types'
  import type { PackageCatalog } from '$src/lib/packages/types'
  import type { PackageSelection } from '$src/stores/packages'
  let {
    catalog,
    active = null,
    resourceContract,
    onOpen,
  }: {
    catalog: PackageCatalog
    active?: PackageSelection | null
    resourceContract?: ResourceResolutionContract | undefined
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
      >{pkg.id} package <small>{pkg.manifest.version} | Validation incomplete</small></button
    >
    {#each categoryGroups as group (group.label)}
      <div role="group" aria-label={group.label}>
        <div class="category-label" aria-hidden="true">{group.label}</div>
        {#each group.rows as row (row.path)}
          <button
            role="treeitem"
            aria-level="2"
            aria-selected={active?.path === row.path}
            onclick={() => onOpen({ packageId: pkg.id, kind: row.kind, path: row.path })}>{row.label}</button
          >
        {/each}
      </div>
    {/each}
  {/each}
</div>
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
