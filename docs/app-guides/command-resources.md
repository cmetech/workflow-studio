# Command resources

A command resource is a Markdown file, commonly `commands/interpret.md`, resolved through the active workflow contract. Select the artifact to edit it, preview its body, or inspect referencing workflow nodes. Command text remains authored content; technical identifiers are preserved.

## Frontmatter and preview

Optional frontmatter begins at the start of the file with a `---` line and ends at its closing delimiter. Use one YAML mapping. Duplicate keys, malformed syntax, or unsupported structure appear as blocking findings. The currently bundled contract does not export a command-frontmatter schema; unknown metadata is retained rather than silently discarded or validated against an invented key list.

The preview removes scripts, embedded images, navigation attributes, styles, and event handlers. It does not fetch remote content or execute commands. Edit, Preview, and References support keyboard navigation.

Save preserves the exact text, even while it contains errors. Resolve diagnostics before preparing the package. When disk content changes externally, compare both versions before Keep Mine; Reload Disk adopts the current disk version.

See [Readiness](#guide:package-readiness), [Troubleshooting](#guide:package-troubleshooting), and [Folder structure](#guide:package-folder-structure).
