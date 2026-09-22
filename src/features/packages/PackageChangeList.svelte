<script lang="ts">
  import type { PackageChange } from './prepare-package-view'
  interface Props {
    changes: readonly PackageChange[]
    includedPaths: readonly string[]
    trustChanges: readonly string[]
  }
  let { changes, includedPaths, trustChanges }: Props = $props()
</script>

<section aria-label="Package changes">
  <h3>Package changes</h3>
  <ul>
    {#each changes as change, index (`${change.path}:${index}`)}
      <li>
        <span>{change.kind}</span>
        {#if change.previousPath}<code>{change.previousPath}</code> to
        {/if}<code>{change.path}</code>{#if change.trustImpact}
          <strong>Trust review required</strong>{/if}
      </li>
    {/each}
  </ul>
</section>
<section aria-label="Trust changes">
  <h3>Trust changes</h3>
  {#if trustChanges.length}<ul>
      {#each trustChanges as change, index (index)}<li>{change}</li>{/each}
    </ul>{:else}<p>No trust changes reported.</p>{/if}
</section>
<section aria-label="Files included in the local version">
  <h3>Files included in the local version</h3>
  <ul>
    {#each includedPaths as path, index (`${path}:${index}`)}<li><code>{path}</code></li>{/each}
  </ul>
</section>

<style>
  code {
    overflow-wrap: anywhere;
  }
  li {
    margin-block: 0.35rem;
  }
</style>
