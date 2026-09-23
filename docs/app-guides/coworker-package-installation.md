# Co-worker package installation

Use the marketplace interface provided by the destination co-worker installation to discover packages from a supported repository/ref. Exact setup, install, update, and review controls depend on that installed version; Studio does not promise a universal command or service endpoint.

The destination must recognize `.well-known/hermes-workflows/index.json`, the selected package's `workflow-package.json`, and its digest claims. A package such as `packages/laptop-support` contains the full script/command/supporting payload, not just a workflow YAML file. Confirm version and digest before approving installation.

Review the execution surface and external requirements at the destination. Local static readiness does not verify provider credentials, runtimes, services, or trust. Changing packaged bytes may require fresh review and invalidate an earlier trust decision. Platform support for safe package installation must be established on the destination; Windows authoring support alone does not prove backend installation support.

If discovery or installation fails, compare the committed repository metadata with the installed marketplace contract and diagnostics. Keep the original package available while investigating.

See [Publishing with Git](#guide:publishing-packages-with-git), [External requirements](#guide:packaged-and-external-requirements), and [Digests and trust](#guide:package-versions-digests-trust).
