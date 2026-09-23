# Package readiness

Validate Package captures a complete native file inventory, checks workflow members and artifacts, and verifies metadata against the marketplace contract. For example, a malformed `scripts/analyze.py` under `packages/laptop-support` is reported with a file and source location where available.

## Blocking findings

Resolve invalid manifests, missing members or packaged resources, YAML/DAG errors, script syntax errors, ambiguous paths, symlinks, unsupported resource contexts, and contract limits. Repository index integrity must also be available before preparation is ready. A filtered Explorer scan or an earlier successful validation is insufficient when package bytes have changed.

Workflow names must be unique within a package. Output references inside packaged command and script bodies are checked for every consuming workflow and node. A shared resource can be valid for one consumer and invalid for another if their declared dependencies or loop scopes differ. The finding identifies the resource location and its consumer.

Save intentional edits, open the listed artifact, repair it, and validate again. A file changed during capture invalidates the result. Shared-index conflicts require reconciling the affected local changes before retrying; preparing one package must not include another package's uncommitted metadata.

Runtime tools, credentials, services, destination trust, and execution success remain advisories. Static checks do not execute package content. Preparation may regenerate stale generated metadata after ordinary source edits, but cannot ignore conflicting shared index entries.

See [Preparing packages](#guide:preparing-packages), [External requirements](#guide:packaged-and-external-requirements), and [Troubleshooting](#guide:package-troubleshooting).
