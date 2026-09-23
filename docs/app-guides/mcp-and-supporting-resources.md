# MCP and supporting resources

A package may contain MCP definition YAML, helper scripts, JSON fixtures, Markdown instructions, and passive binary assets. For example, keep `mcp/service.yaml`, `fixtures/sample.json`, and `assets/diagram.png` beneath `packages/laptop-support` when they are intended distribution content.

The reference graph follows the exported compiler resource rules. A packaged MCP definition can refer to other packaged files; those dependencies must resolve in the supported context. A service address or destination-only argument may remain external. Studio does not infer unsupported include origins or substitute its own machine's interpreter path for a destination runtime.

All regular supporting files contribute to the digest even when no workflow references them. Inspect unreferenced files before preparation so scratch data is not distributed accidentally. Binary artifacts show size and SHA-256 and support scoped replacement or reveal. External opening is restricted to native-verified passive content; scripts are not launched.

Resolve missing packaged resources and malformed structured artifacts, then validate again. Destination service availability remains advisory.

See [Folder structure](#guide:package-folder-structure), [External requirements](#guide:packaged-and-external-requirements), and [Digest and trust changes](#guide:package-versions-digests-trust).
