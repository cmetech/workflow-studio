<script lang="ts">
  import type { WorkflowPackageProjection } from '$src/lib/packages/types'
  import type { PackageAnalysis } from '$src/lib/packages/readiness'
  import { packagePathError } from '$src/lib/packages/paths'
  import { MARKETPLACE_INDEX_PATH } from '$src/lib/packages/marketplace-path'
  let {
    package: pkg,
    analysis,
    hasMarketplaceIndex = false,
    onOpenArtifact,
    onOpenWorkflow,
    onValidate,
    onAddWorkflow,
    onAddArtifact,
    onPrepare,
  }: {
    package: WorkflowPackageProjection
    analysis?: PackageAnalysis
    hasMarketplaceIndex?: boolean
    onOpenArtifact?: (path: string, line?: number, column?: number) => void
    onOpenWorkflow?: (path: string) => void
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
    <dd>Not compared with a local Git version</dd>
  </dl>
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
    >{/each}
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
