# Publishing packages with Git

Studio prepares package content and creates local Git commits. To make a package available to another installation, use your normal Git client outside Studio to push the intended commit to an appropriate repository and ref.

Before pushing, review the committed package root, its generated `digests.json`, and `.well-known/hermes-workflows/index.json`. For example, `packages/laptop-support` should contain every script and fixture required by its manifest members. Keep private credentials outside the package root and review unreferenced payload files.

Use the repository access and authentication process already established by your team. Studio's package flow does not add remotes, authenticate, push, pull, merge, or grant destination trust. A successful local commit is **Prepared locally**; **Available from repository** also requires the destination to access and recognize that repository/ref.

If the destination cannot discover the package, check the committed index, package path, supported contract version, and repository/ref configuration. Correct local metadata through validation and preparation rather than editing digest claims manually.

See [Preparing packages](#guide:preparing-packages), [Co-worker installation](#guide:coworker-package-installation), and [Troubleshooting](#guide:package-troubleshooting).
