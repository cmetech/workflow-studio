# UI brand copy audit

The application uses **loop24** in workflow guidance and neutral wording where a brand is unnecessary. Technical values remain accurate, as confirmed by the user.

## Updated surfaces

- Documentation landing page, navigation descriptions, and bundled guides: loop24 replaces Hermes in explanatory prose.
- Settings: “Workflow CLI” replaces “Hermes CLI”; “Legacy” replaces “Hermes legacy”. Executable paths remain exact.
- New workflow dialog, examples, About, documentation metadata, profile selection, and node availability messages: the Legacy display label retains the `hermes-legacy` underlying value.
- Contract-generated node descriptions, inspector help, compatibility findings, and documentation: presentation formatting replaces the upstream brand without modifying bundled or imported contracts, their digests, schemas, or examples.
- Browser and native CLI errors, contract-loading errors, and profile-specific action errors: neutral workflow terminology.

Documentation formatting operates on prose text nodes after sanitization. Code blocks, inline code, link destinations, and source data remain intact. Upstream prose suggesting `hermes workflow doctor` is described as a workflow compatibility check rather than inventing a replacement executable command.

## Intentionally retained

- Actual `.hermes.yaml` filenames, filesystem paths, source provenance, and file-operation confirmations.
- Raw YAML, example source, Git diffs and history, including `hermes-legacy`, user-authored text, and comments.
- Exact technical identifiers in documentation code, schema constraints, diagnostic details, contract metadata, and internal API names.
- Historical engineering documents and upstream contract resources.

These are technical data rather than application branding. No workflow files, native command identifiers, runtime arguments, or upstream repository files were renamed.

## Verification

The initial full-run failures below were investigated afterward. See [the test-run investigation](../verification/2026-09-21-ui-copy-test-investigation.md) for the mismatched local setup, the confirmed line-ending/hashbang causes, and the real bundle-size regression that was subsequently corrected. The initial run is retained as historical evidence, not the final disposition of these failures.

- Svelte/TypeScript: no errors or warnings. Changed-file ESLint and formatting checks pass.
- Bundled contracts, examples, and all 42 packaged resources validate.
- Native contract tests: 7 pass on Windows.
- Affected-area run: 217 tests outside the documentation-index file pass. All 19 documentation-index tests pass after updating the profile-label expectation and allowing CRLF in guide-fence test extraction. The separate initial UI/Markdown run also passes all 7 tests.
- Full repository run (4 workers): 173 files pass, 13 fail; 2,313 tests pass and 25 fail, plus two installer suites fail during import. This is **not** a clean full-suite result. It was started before the follow-up test-selector corrections.

Full-run failures, retained here rather than treated as verified unrelated baseline failures:

- `src/app/App.test.ts`: old `hermes-legacy` option-label expectation; updated to `Legacy`.
- `src/app/App.profile-migration.test.ts`: profile-flow timeouts; its option selector also needed the Legacy label while retaining the actual YAML value.
- `src/app/App.canvas-authoring.test.ts`: two loop-group timeouts and subsequent missing Nodes/read-only UI assertions.
- `src/lib/docs/build-index.test.ts`: old profile-label expectation and two CRLF fence-extraction failures; corrected and rerun successfully.
- `tests/installers/install-script.test.ts`, `tests/installers/release-package.test.ts`: Rolldown import parse failure, invalid `!` character.
- `tests/project/bundle-budget.test.ts`: production bundle/provenance assertions against the local build output.
- `tests/security/security-boundaries.test.ts`: production-build timeout.
- `src/features/canvas/layout-graph.test.ts`: frozen fixture SHA mismatch.
- `src/features/canvas/routed-layout.test.ts`: aggregate-boundary timeout.
- `src/lib/git/version-actions.integration.test.ts`: restore timeout and temporary-directory cleanup failure.
- `src/lib/recovery/recovery-store.test.ts`: serialized-data-limit timeout.
- `src/lib/yaml/patch-document.test.ts`: nine fixture/string/property assertions involving CRLF source versus LF expectations.

Follow-up App verification used one worker and a 15-second test timeout. `App.test.ts` and `App.canvas-authoring.test.ts` passed all 110 tests. The profile-migration run caught a missed inspector display condition: its contract field path is `sidecar.language_compatibility`. After correcting that condition, all 3 profile-migration tests pass, including both migration directions and preservation of the required YAML values. The final follow-up total is 113 passing App tests. This does not establish a clean result for the remaining full-suite failures above.
