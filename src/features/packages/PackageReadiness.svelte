<script lang="ts">
  import type { PackageAnalysis } from '$src/lib/packages/readiness'
  interface Props {
    analysis: PackageAnalysis | null
    onOpenArtifact?: (path: string, line?: number, column?: number) => void
    onHelp?: (topic: string) => void
  }
  let { analysis, onOpenArtifact, onHelp }: Props = $props()
</script>

<p role="status">
  {!analysis
    ? 'Validation required'
    : analysis.ready && !analysis.blockers.length
      ? 'Ready for local preparation'
      : 'Preparation blocked'}
</p>
{#if analysis}
  <section aria-label="Blocking findings">
    <h3>Blocking findings</h3>
    {#if !analysis.blockers.length}<p>No blocking findings.</p>{/if}
    <ul>
      {#each analysis.blockers as finding, index (`${finding.code}:${index}`)}
        <li>
          <p>{finding.message}</p>
          {#if finding.path && onOpenArtifact}
            <button type="button" onclick={() => onOpenArtifact?.(finding.path, finding.line, finding.column)}
              >Open {finding.path}{finding.line ? `:${finding.line}` : ''}{finding.column
                ? `:${finding.column}`
                : ''}</button
            >
          {:else if finding.path}<code>{finding.path}</code>{/if}
        </li>
      {/each}
    </ul>
  </section>
  <section aria-label="Destination-dependent advisories">
    <h3>Destination-dependent advisories</h3>
    <p>Runtime availability, credentials and trust must be checked at the destination.</p>
    <ul>
      {#each analysis.advisories as finding, index (`${finding.code}:${index}`)}<li>{finding.message}</li>{/each}
    </ul>
  </section>
{/if}
{#if onHelp}<button type="button" onclick={() => onHelp?.('guide:package-readiness#blocking-findings')}
    >Read readiness guidance</button
  >{/if}

<style>
  code,
  button {
    overflow-wrap: anywhere;
  }
  li p {
    margin-bottom: 0.25rem;
  }
</style>
