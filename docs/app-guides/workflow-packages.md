# Workflow packages

Use a package when a workflow needs scripts, commands, fixtures, or shared resources. The package root contains `workflow-package.json`; its `workflows` list identifies each definition YAML and optional companion YAML. YAML remains the sole workflow graph authority. Editor layout is stored separately.

## Saved, prepared, and available

**Saved** means your current file bytes are on local disk. Invalid script drafts may be saved, but cannot pass package preparation.

**Prepared locally** means the selected package and repository index were recorded in a local Git commit after static checks. This does not grant destination trust or verify successful execution.

**Available from repository** means the package can be discovered from a repository/ref supported by the destination marketplace. That requires an external Git push and destination configuration; a local commit alone does not establish availability.

Start in Packages, open a package overview, and inspect its members and findings. For a standalone workflow, create a package or import the workflow into an existing package. Preserve required technical names such as `.hermes.yaml` and `.well-known/hermes-workflows/index.json`.

See [Folder structure](#guide:package-folder-structure), [Creating a package](#guide:creating-a-package), and [Preparing packages](#guide:preparing-packages).
