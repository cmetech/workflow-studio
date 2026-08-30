<script lang="ts">
  interface Props {
    kind: 'error' | 'warning' | 'info'
    message: string
    dismissible?: boolean
    onDismiss?: () => void
  }

  let { kind, message, dismissible = false, onDismiss }: Props = $props()
</script>

<section class="application-notice" data-kind={kind} data-dismissible={dismissible || undefined}>
  <div
    class="message"
    role={kind === 'error' ? 'alert' : 'status'}
    data-application-notice
    data-kind={kind}
    data-notice-scroll
  >
    {message}
  </div>
  {#if dismissible}
    <button type="button" aria-label="Dismiss" onclick={() => onDismiss?.()}>Dismiss</button>
  {/if}
</section>

<style>
  .application-notice {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: start;
    width: min(32rem, calc(100vw - 2rem));
    max-width: 100%;
    max-block-size: min(40dvh, 18rem);
    padding: 0.75rem;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-left-width: 3px;
    border-radius: 0.5rem;
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 0.5rem 1.5rem var(--color-shadow);
  }

  .application-notice[data-kind='error'] {
    border-left-color: var(--color-error);
  }

  .application-notice[data-kind='warning'] {
    border-left-color: var(--color-warning);
  }

  .application-notice[data-kind='info'] {
    border-left-color: var(--color-accent);
  }

  .message {
    min-width: 0;
    min-height: 0;
    max-height: 100%;
    overflow: auto;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  button {
    min-width: 0;
  }

  @media (max-width: 30rem) {
    .application-notice {
      grid-template-columns: minmax(0, 1fr);
    }

    .application-notice[data-dismissible='true'] {
      grid-template-rows: minmax(0, 1fr) auto;
      block-size: min(40dvh, 18rem);
    }

    button {
      justify-self: end;
    }
  }

  @media (forced-colors: active) {
    .application-notice {
      border: 2px solid CanvasText;
    }
  }
</style>
