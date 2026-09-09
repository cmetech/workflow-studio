# Windows layout storage hotfix plan

## Problem

Workflow Studio v3.0.0 can arrange a graph on Windows but fail while persisting the resulting private layout with `The parameter is incorrect. (os error 87)`. The Windows-only handle-relative replacement code passes `size_of` for a padded Rust representation of the variable-length `FILE_RENAME_INFO` buffer. Windows requires the exact bytes through the final UTF-16 filename. The same construction is duplicated for layout, setup readiness, active branding, and updater preferences.

## Requirements

1. Repeated Windows layout saves must atomically replace `layouts-v1.json` without residue or loss of the bound-directory protections.
2. Every handle-relative Windows state-file replacement must pass the exact `FILE_RENAME_INFO` byte count.
3. Existing error codes, storage locations, size limits, and public commands remain unchanged.
4. Windows CI must execute the native Rust behavior tests, including real repeated layout replacement, before building the bundle.
5. macOS and Linux behavior remain unchanged.

## Test-first sequence

1. Enable focused native Rust tests on the Windows CI runner and prove the existing repeated-layout test fails on the released implementation.
2. Add one reviewed Windows helper for handle-relative replacement. Test its exact buffer-length calculation independently of Windows and retain the real Windows filesystem tests.
3. Replace the four duplicated unsafe implementations with the helper.
4. Run formatting, linting, TypeScript/Svelte checks, focused Rust tests, the complete Rust suite, unit tests, resource checks, and production build locally.
5. Push the hotfix branch and require the full CI matrix, including the new Windows native-test gate, to pass.
6. Request code review, consolidate findings, and stop for approval before merging to `base` or publishing a corrective release.

## Release boundary

This is a native persistence correction. It does not change workflow syntax, YAML, graph layout output, Hermes compatibility, or editor-facing features. A corrective release should be versioned separately from v3.0.0 after approval.
