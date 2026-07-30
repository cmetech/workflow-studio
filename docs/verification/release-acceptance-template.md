# Workflow Studio release acceptance template

Copy this file for a release candidate. Use real artifacts from one immutable draft release. Never substitute browser fixtures or compilation for clean-machine evidence.

## Candidate identity

- Version/tag:
- Exact commit SHA:
- Draft release URL:
- Updater endpoint and signed `latest.json` SHA-256:
- Tester/date:

## Automated gates

| Gate | Command/run URL | Result and evidence |
| --- | --- | --- |
| Contracts | `npm run contracts:check` | |
| Examples | `npm run examples:check` | |
| TypeScript/Rust verification | `npm run verify` | |
| Browser E2E | `npm run test:e2e` | |
| Security boundaries | `npm run test:unit -- tests/security` | |
| Production renderer | `npm run build` | |
| Native debug bundles | three-platform CI run | |
| Release assets/signatures/checksums | draft verification job | |

## Clean-machine platform record

Complete one section per supported artifact. Attach artifact/checksum, machine identity, screenshots/logs, and exact observed outcome.

### macOS Apple Silicon

- Artifact and SHA-256:
- Fresh OS/machine architecture:
- Gatekeeper warning and documented right-click **Open** path:
- First-launch stages and saved-log result:
- Folder/open/import/create/save/reopen-layout result:
- YAML/visual/form round trip:
- All examples and contextual offline docs:
- Pair-only Git version with unrelated change preserved:
- Malicious/valid brand results:
- 250-node/500-edge interaction evidence:
- Staged signed updater check/download/verify/install/relaunch:
- Verdict/blockers:

### macOS Intel

Repeat every macOS Apple Silicon field.

### Windows x64

- Artifact and SHA-256:
- Fresh OS/machine architecture:
- SmartScreen **More info / Run anyway** path:
- Repeat all functional, brand, Git, performance, and staged-updater fields above:
- Verdict/blockers:

## Unsupported architecture checks

- Windows ARM64 installer selection fails clearly (unsupported in version 1):
- Linux bootstrap rejects the platform before any release-asset network request:
- No fallback artifact was launched:

## Final decision

- [ ] All supported clean-machine rows contain real evidence.
- [ ] The staged updater installed and relaunched on every supported platform.
- [ ] Checksums and updater signatures were verified from downloaded draft bytes.
- [ ] No unresolved Critical/Important review finding remains.
- [ ] Release approved for manual publication.

Decision owner/date:
