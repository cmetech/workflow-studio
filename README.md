# Workflow Studio

Workflow Studio is a lightweight desktop editor under active development for graphically authoring Hermes/co-worker DAG workflows. YAML is the only workflow format and remains the source of truth. The application is designed to run independently of Hermes, work offline, and produce workflow definition and optional companion-policy YAML files that users can place wherever their Hermes installation discovers workflows.

This repository contains the application foundation and approved product and implementation documentation.

## Development

Workflow Studio supports Node `>=22.13.0`, npm `>=10`, and Rust `>=1.77.2`.

```bash
npm ci
npm run verify
npm run build
```

Use `npm run dev` for renderer development and `npm run tauri -- dev` to launch the native application.

## Installation and releases

Native macOS, Windows, and Linux packages are distributed through public GitHub Releases. The operating-system packages are intentionally unsigned by Apple or Microsoft; updater artifacts carry the separate first-party integrity signature required for automatic installation.

See [Installing Workflow Studio](docs/installing.md) for direct downloads, checksum verification, safe one-line installer commands, and platform warning guidance. Maintainers should follow the [release runbook](docs/releasing.md); automation creates a verified draft and never publishes it automatically.

## Start here

1. Read the [Hermes workflow-language analysis](docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md).
2. Read the [approved design specification](docs/superpowers/specs/2026-07-25-workflow-studio-design.md).
3. Open the [approved Explorer workbench mockup](docs/mockups/workspace-explorer-layout.html).
4. Read the [implementation roadmap](docs/superpowers/plans/2026-07-25-workflow-studio-roadmap.md).
5. Execute the linked phase plans in order:

   - [Native foundation](docs/superpowers/plans/2026-07-25-workflow-studio-foundation-plan.md)
   - [YAML document and workspace](docs/superpowers/plans/2026-07-25-workflow-studio-document-workspace-plan.md)
   - [Visual authoring](docs/superpowers/plans/2026-07-25-workflow-studio-visual-authoring-plan.md)
   - [Integration and release](docs/superpowers/plans/2026-07-25-workflow-studio-integration-release-plan.md)

6. Use the [clean-session implementation prompt](docs/handoffs/2026-07-25-workflow-studio-clean-session-prompt.md) when starting implementation in a new LLM context.

## Status

- Product design: approved
- Technology selection: approved
- Phase 1 native foundation: complete
- Phase 2 YAML document and workspace: complete
- Phase 3 visual authoring: complete
- Phase 4 integration and release: in progress
- Version 1 implementation: in progress

## Foundational decisions

- Tauri 2, Svelte 5, TypeScript, and a thin Rust native host
- Svelte Flow for the DAG canvas and CodeMirror 6 for YAML editing
- YAML/CST document editing with YAML as the sole workflow authority
- `.yaml`/`.yml` definitions and canonical `.hermes.yaml` companions edited as one logical workflow pair
- Local-only Git integration in version 1
- LOOP24 default branding with data-driven runtime brand and theme packs
- macOS, Windows, and Linux native release artifacts
- Unsigned operating-system binaries with cryptographically signed updater artifacts
