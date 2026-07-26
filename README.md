# Workflow Studio

Workflow Studio is a planned lightweight desktop editor for graphically authoring Hermes/co-worker DAG workflows. YAML is the only workflow format and remains the source of truth. The application will run independently of Hermes, work offline, and produce workflow definition and optional companion-policy YAML files that users can place wherever their Hermes installation discovers workflows.

This repository currently contains the approved product and implementation documentation. Application scaffolding will be created from the implementation plan.

## Start here

1. Read the [Hermes workflow-language analysis](docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md).
2. Read the [approved design specification](docs/superpowers/specs/2026-07-25-workflow-studio-design.md).
3. Follow the implementation plan after it is added under `docs/superpowers/plans/`.
4. Use the clean-session prompt under `docs/handoffs/` when starting implementation in a new LLM context.

## Status

- Product design: approved
- Technology selection: approved
- Repository scaffold: documentation-only
- Implementation: not started

## Foundational decisions

- Tauri 2, Svelte 5, TypeScript, and a thin Rust native host
- Svelte Flow for the DAG canvas and CodeMirror 6 for YAML editing
- YAML/CST document editing with YAML as the sole workflow authority
- `.yaml`/`.yml` definitions and canonical `.hermes.yaml` companions edited as one logical workflow pair
- Local-only Git integration in version 1
- LOOP24 default branding with data-driven runtime brand and theme packs
- macOS, Windows, and Linux native release artifacts
- Unsigned operating-system binaries with cryptographically signed updater artifacts
