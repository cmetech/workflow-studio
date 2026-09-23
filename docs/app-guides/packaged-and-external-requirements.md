# Packaged and external requirements

Packaged requirements are the files beneath the selected package root: workflow YAML, companions, scripts, commands, and other supporting artifacts. A reference to `scripts/analyze.py` must resolve to included bytes before preparation succeeds.

External requirements describe what the destination needs: runtimes, tools, providers, services, and secret names. Edit those lists in `workflow-package.json`. Record requirement identifiers, never private credential values. Keep secrets and local-only configuration outside the package root because unreferenced files are still included in its digest and distribution.

A missing packaged script is a blocker. An unavailable destination provider is an advisory: Studio cannot establish that the future installation has credentials, dependencies, permission, or trust. Saving a structurally valid workflow remains possible despite these advisories.

Review both classes of findings in the package overview. If a file was intended to be packaged, select its explicit source and repair the reference. If it is a destination dependency, describe it accurately and review it during installation.

See [Readiness](#guide:package-readiness), [MCP resources](#guide:mcp-and-supporting-resources), and [Co-worker installation](#guide:coworker-package-installation).
