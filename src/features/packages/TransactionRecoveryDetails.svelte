<script lang="ts">
  import type { TransactionRecoveryReceipt } from '$src/lib/native/transaction-recovery'
  let { receipt, title = 'Transaction recovery locations' }: { receipt: TransactionRecoveryReceipt; title?: string } =
    $props()
</script>

{#if receipt.pathResults.length || receipt.omittedPathResults}
  <section aria-label={title}>
    <h3>{title}</h3>
    <p>Inspect the reported source and recovery files before retrying or removing retained copies.</p>
    <ul aria-label="Affected files and recovery locations">
      {#each receipt.pathResults as result, index (index)}
        <li>
          <dl>
            <dt>Source</dt>
            <dd><code>{result.relativePath}</code></dd>
            {#if result.destinationPath}<dt>Destination or recovery location</dt>
              <dd><code>{result.destinationPath}</code></dd>{/if}
            <dt>Status</dt>
            <dd>
              {result.status === 'recoveryRetained'
                ? 'Retained for recovery'
                : result.status === 'rolledBack'
                  ? 'Rolled back'
                  : result.status}
            </dd>
            {#if result.message}<dt>Reason</dt>
              <dd>{result.message}</dd>{/if}
            {#if result.errorCode}<dt>Error code</dt>
              <dd><code>{result.errorCode}</code></dd>{/if}
          </dl>
        </li>
      {/each}
    </ul>
    {#if receipt.omittedPathResults}<p>
        {receipt.omittedPathResults} additional file results could not be displayed because they exceeded the display limits
        or were malformed.
      </p>{/if}
  </section>
{/if}

<style>
  dd {
    margin-inline-start: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  dt {
    font-weight: 600;
    margin-top: 0.5rem;
  }
  code {
    overflow-wrap: anywhere;
  }
</style>
