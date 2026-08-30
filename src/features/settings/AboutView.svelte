<script lang="ts">
  import type { HostInfo } from '$src/lib/native/types'

  interface ContractIdentity {
    readonly profile: string
    readonly schemaVersion: number
    readonly digest: string
  }

  interface Props {
    host: HostInfo
    contracts: readonly ContractIdentity[]
  }

  let { host, contracts }: Props = $props()
</script>

<section class="about" aria-label="About Workflow Studio">
  <header>
    <h2>About</h2>
    <p>Application, platform, and bundled authoring-contract identity.</p>
  </header>

  <dl class="identity">
    <div>
      <dt>Version</dt>
      <dd><code class="technical-value">{host.appVersion}</code></dd>
    </div>
    <div>
      <dt>Platform</dt>
      <dd><code class="technical-value">{host.os} / {host.arch}</code></dd>
    </div>
  </dl>

  <ul aria-label="Authoring contracts">
    {#each contracts as contract (contract.profile + contract.digest)}
      <li>
        <strong><code class="technical-value">{contract.profile}</code></strong>
        <span>Schema <code class="technical-value">{contract.schemaVersion}</code></span>
        <code class="digest technical-value">{contract.digest}</code>
      </li>
    {/each}
  </ul>
</section>

<style>
  .about,
  header,
  .identity,
  .identity div,
  li {
    display: grid;
    min-width: 0;
    max-width: 100%;
  }

  .about {
    gap: 1rem;
    width: 100%;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
  }

  header {
    gap: 0.5rem;
  }

  header h2,
  header p {
    margin: 0;
  }

  .identity {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin: 0;
  }

  .identity div,
  li {
    gap: 0.25rem;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  ul {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
    max-width: 100%;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .digest,
  .technical-value,
  li strong,
  li span {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  @media (max-width: 36rem) {
    .identity {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
