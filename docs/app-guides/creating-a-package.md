# Creating a package

Use New Package from the Packages area to collect a workflow and its resources in a new folder such as `packages/laptop-support`. Supply a unique package ID, semantic version, display name, description, license, publisher, and tags. These values are checked against the bundled package contract.

Choose a supported blank workflow, an example, or an identified workspace workflow. Review its definition and optional companion destination paths. For existing workflows, identify the exact script and command files to include; ambiguous source origins must be resolved before creation. Copy preserves the original workflow. Move is limited to supported sources and must not leave another package with stale membership.

Creation uses one revision-checked filesystem transaction. Existing destinations are not overwritten implicitly. If a source or destination changes, refresh and retry. A partial native failure reports recovery information; inspect it before another operation.

After creation, open the overview and validate. Runtime tools, services, and credentials remain destination requirements. Creating files does not execute or publish them.

See [Package folder structure](#guide:package-folder-structure), [Script resources](#guide:script-resources), and [Readiness](#guide:package-readiness).
