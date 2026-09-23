<script lang="ts">
  import type { ArtifactDocument } from '$src/lib/artifacts/types'
  import type { WorkspaceArtifactMetadata } from '$src/lib/native/types'
  import TextArtifactEditor, { type ArtifactFocusRequest } from './TextArtifactEditor.svelte'
  import BinaryArtifactView from './BinaryArtifactView.svelte'
  import CommandEditor from './CommandEditor.svelte'
  import type { PackageReference } from '$src/lib/packages/package-references'
  interface Props {
    document?: ArtifactDocument | null
    metadata?: WorkspaceArtifactMetadata | null
    generated?: boolean
    command?: boolean
    focusRequest?: ArtifactFocusRequest | null
    references?: readonly PackageReference[]
    referencesStatus?: 'loading' | 'ready' | 'unavailable'
    unsavedWorkflowEdits?: boolean
    onTextChange: (text: string) => void
    onSave: () => void | Promise<void>
    onReplace?: () => void | Promise<void>
    onReveal?: () => void | Promise<void>
    onOpen?: () => void | Promise<void>
  }
  let {
    document = null,
    metadata = null,
    generated = false,
    command = false,
    focusRequest = null,
    references = [],
    referencesStatus = 'ready',
    unsavedWorkflowEdits = false,
    onTextChange,
    onSave,
    onReplace,
    onReveal,
    onOpen,
  }: Props = $props()
</script>

{#if document}
  {#if generated}<p role="note">Generated package metadata. Regenerate this file through Prepare Package.</p>{/if}
  {#key document.artifactId}
    {#if command}
      <CommandEditor
        path={document.path}
        text={document.text}
        dirty={document.dirty}
        readOnly={generated || document.readOnly}
        {references}
        {referencesStatus}
        {unsavedWorkflowEdits}
        {focusRequest}
        {onTextChange}
        {onSave}
      />
    {:else}
      <TextArtifactEditor
        path={document.path}
        language={document.language}
        text={document.text}
        dirty={document.dirty}
        readOnly={generated || document.readOnly}
        {focusRequest}
        {onTextChange}
        {onSave}
      />
    {/if}
  {/key}
{:else if metadata && onReplace && onReveal && onOpen}
  <BinaryArtifactView {metadata} {onReplace} {onReveal} {onOpen} />
{:else}
  <p>Select a package artifact to edit or inspect.</p>
{/if}
