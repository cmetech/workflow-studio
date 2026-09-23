<script lang="ts">
  import type { WorkflowPackageProjection } from '$src/lib/packages/types'
  import type { PackageAnalysis } from '$src/lib/packages/readiness'
  import { packagePathError } from '$src/lib/packages/paths'
  import { MARKETPLACE_INDEX_PATH } from '$src/lib/packages/marketplace-path'
  import { packageGitSummaryLabel, type PackageGitSummary } from './package-git-summary'
  let {
    package: pkg,
    analysis,
    gitSummary,
    hasMarketplaceIndex = false,
    onOpenArtifact,
    onOpenWorkflow,
    onRemoveWorkflow,
    onValidate,
    onAddWorkflow,
    onAddArtifact,
    onPrepare,
  }: {
    package: WorkflowPackageProjection
    analysis?: PackageAnalysis
    gitSummary?: PackageGitSummary | undefined
    hasMarketplaceIndex?: boolean
    onOpenArtifact?: (path: string, line?: number, column?: number) => void
    onOpenWorkflow?: (path: string) => void
    onRemoveWorkflow?: (path: string) => void
    onValidate?: () => void
    onAddWorkflow?: () => void
    onAddArtifact?: () => void
    onPrepare?: () => void
  } = $props()
  const artifactPaths = $derived(
    new Set(pkg.artifacts.filter((artifact) => artifact.kind === 'file').map((artifact) => artifact.workspacePath)),
  )
  function canOpenFinding(path: string): boolean {
    if (packagePathError(path)) return false
    if (path === MARKETPLACE_INDEX_PATH) return hasMarketplaceIndex
    const workspacePath = pkg.root ? `${pkg.root}/${path}` : path
    return !packagePathError(workspacePath) && artifactPaths.has(workspacePath)
  }
</script>

<section aria-label="Package overview">
  <h1>{pkg.manifest.displayName}</h1>
  <p>{pkg.manifest.description}</p>
  <dl>
    <dt>Package ID</dt>
    <dd>{pkg.id}</dd>
    <dt>Current version</dt>
    <dd>{pkg.manifest.version}</dd>
    <dt>Publisher</dt>
    <dd>{pkg.manifest.publisher}</dd>
    <dt>License</dt>
    <dd>{pkg.manifest.license}</dd>
    <dt>Local changes</dt>
    <dd>{packageGitSummaryLabel(gitSummary)}</dd>
    {#if gitSummary?.phase === 'ready'}
      <dt>Last local version</dt>
      <dd>{gitSummary.baselineVersion ?? 'No committed package version'}</dd>
      <dt>Proposed version</dt>
      <dd>
        {gitSummary.proposedVersion ??
          (gitSummary.changes.length ? 'Validate package for a version suggestion' : 'No version change proposed')}
      </dd>
    {/if}
  </dl>
  {#if gitSummary?.phase === 'ready'}
    <section aria-label="Saved package changes">
      <p>Saved files compared with local Git. Unsaved edits are not included.</p>
      {#if gitSummary.changes.length === 0}<p>No saved package changes</p>{:else}
        <ul>
          {#each gitSummary.changes as change (change.path)}<li>
              {change.kind === 'added' ? 'Added' : change.kind === 'removed' ? 'Deleted' : 'Modified'}: {change.path}
            </li>{/each}
        </ul>
        <p>Review the proposed version during package preparation.</p>
      {/if}
    </section>
  {/if}
  <p role="status">{analysis?.ready ? 'Static checks complete' : 'Validation incomplete'}</p>
  {#if !analysis}<p>
      Complete package scan, workflow and artifact analysis, digest verification, and marketplace checks are required
      before preparation.
    </p>{/if}
  <div>
    <button disabled={!onAddWorkflow} onclick={onAddWorkflow}>Add Workflow</button><button
      disabled={!onAddArtifact}
      onclick={onAddArtifact}>Add Artifact</button
    ><button disabled={!onValidate} onclick={onValidate}>Validate Package</button><button
      disabled={!onPrepare || !analysis?.ready}
      onclick={onPrepare}>Prepare Package</button
    >
  </div>
  <h2>Workflows</h2>
  {#each pkg.workflows as member (member.definition)}<button
      disabled={!onOpenWorkflow}
      onclick={() => onOpenWorkflow?.(member.definition)}>Open Workflow: {member.definition}</button
    >{#if onRemoveWorkflow}<button onclick={() => onRemoveWorkflow?.(member.definition)}
        >Remove Workflow: {member.definition}</button
      >{/if}{/each}
  <h2>Resources</h2>
  <ul>
    {#each pkg.artifacts.filter((a) => a.kind === 'file') as artifact (artifact.path)}<li>
        {artifact.path} ({artifact.size} bytes)
      </li>{/each}
  </ul>
  <h2>Readiness findings</h2>
  {#each analysis?.blockers ?? [] as finding, index (index)}
    <p>{finding.path}: {finding.message}</p>
    {#if onOpenArtifact && canOpenFinding(finding.path)}
      <button type="button" onclick={() => onOpenArtifact?.(finding.path, finding.line, finding.column)}
        >Open {finding.path}{finding.line ? `:${finding.line}` : ''}{finding.column ? `:${finding.column}` : ''}</button
      >
    {/if}
  {/each}
  <h2>Destination-dependent advisories</h2>
  <p>Dependencies, credentials, services, trust, and execution success are not verified by LOOP24 Studio.</p>
  {#each analysis?.advisories ?? [] as finding, index (index)}<p>{finding.message}</p>{/each}
  <h2>Execution and trust surface</h2>
  <p>Changing packaged bytes requires destination trust review. Package content is never executed in Studio.</p>
  {#if analysis}<ul>
      {#each analysis.executionSurface.artifactPaths as path (path)}<li>{path}</li>{/each}
    </ul>
    <h2>References</h2>
    <ul>
      {#each analysis.references.references as reference, index (index)}<li>
          {reference.workflowPath}: {reference.artifactPath ?? 'External resource'}
        </li>{/each}
    </ul>{/if}
</section>

<style>
  section {
    padding: var(--space-4);
    overflow: auto;
    min-height: 0;
  }
  dd {
    margin-bottom: var(--space-2);
  }
  button {
    margin: var(--space-1);
  }
</style>
