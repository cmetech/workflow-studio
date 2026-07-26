# Workflow Studio clean-session implementation prompt

Use this prompt after starting a fresh LLM coding session with the working directory set to the root of this `workflow-studio` repository.

```text
We are implementing Workflow Studio, a standalone Tauri/Svelte desktop application for visually authoring Hermes/co-worker DAG workflows.

You are starting in the workflow-studio repository. The repository currently contains approved documentation and no application implementation. Do not re-brainstorm or replace the approved architecture.

Read these files completely, in this order, before changing anything:

1. AGENTS.md
2. README.md
3. docs/analysis/2026-07-25-hermes-workflow-language-foundation-review.md
4. docs/superpowers/specs/2026-07-25-workflow-studio-design.md
5. docs/superpowers/plans/2026-07-25-workflow-studio-roadmap.md
6. docs/superpowers/plans/2026-07-25-workflow-studio-foundation-plan.md

Also open docs/mockups/workspace-explorer-layout.html when implementing the shell. It is the approved workbench reference.

Then implement the Native Foundation Plan task-by-task. Use superpowers:subagent-driven-development if available and appropriate; otherwise use superpowers:executing-plans. You are explicitly authorized to delegate independent plan tasks to subagents, provided file ownership is clear and each result is reviewed before integration.

Execution rules:

- Verify the current branch/ref and status before mutation. Development starts from base. Create an isolated feature worktree/branch from base if the applicable workflow skill requires it.
- Use strict test-driven development for every task: failing narrow test, observed failure, minimal implementation, passing narrow test, regression gate, review, atomic commit.
- Use the exact interfaces, paths, versions, verification commands, and commit boundaries in the plan unless current authoritative tool output proves a compatibility correction is necessary. Record any such correction with evidence.
- Preserve all existing documentation and user changes.
- Keep YAML as the only workflow source of truth. Do not create a separately persisted graph authority.
- Keep Rust thin and native-only. Workflow schema, parsing, projections, forms, and DAG semantics remain pure TypeScript.
- Do not add Electron, SvelteKit, a local server, Python, a Hermes runtime dependency, telemetry, or Git remote functionality.
- Do not hand-author the production Hermes field inventory. Phase 1 uses deliberately minimal contract fixtures; Phase 3 stops at its explicit upstream contract gate if the Hermes CLI contract is unavailable.
- Do not modify the sibling hermes-agent repository unless that later gate is reached and the user explicitly authorizes the separate upstream change.
- Do not create a GitHub repository, remote, release, tag, published artifact, updater secret, or external side effect without explicit user authority.
- Do not weaken a preservation, security, Git-isolation, accessibility, or performance test to make it pass.
- Keep the user informed during long-running work and never claim completion without running the plan's verification gate.

Begin now with Native Foundation Task 1. Continue through the plan while safe, local, in-scope work remains. At the Phase 1 completion gate, report the commits, exact commands and results, any deviations, and the next plan to execute.
```

After Phase 1 is approved, the next fresh session should read the same foundation documents plus `docs/superpowers/plans/2026-07-25-workflow-studio-document-workspace-plan.md`, then execute that plan. Repeat for the Visual Authoring and Integration/Release plans in roadmap order.

