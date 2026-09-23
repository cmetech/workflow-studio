# Script resources

Open a script such as `scripts/analyze.py` from the package tree or the node's resource action. The text editor provides line numbers, folding, search, undo/redo, and syntax diagnostics. Save records the exact draft; invalid scripts remain editable but block package preparation.

## Runtime resolution

Resource lookup uses the bundled, versioned authoring and resource-resolution contracts. The current exported script runtimes are `uv` for Python `.py` and `bun` for `.ts` or `.js`. These are technical values and must remain accurate. Bash is not a script-node runtime in this contract. Other supporting text can still be stored as package content.

Use Edit Script for an existing packaged reference, or create/select a resource through the node action. Extracting supported inline code writes a companion script artifact and updates the YAML reference as one checked operation. Save or resolve an existing workflow draft before actions that require a clean saved pair.

Static checks do not establish installed dependencies or execution success. Extensionless resources require an unambiguous supported runtime context. Missing or ambiguous resources block preparation; external tools and credentials remain advisories.

See [External requirements](#guide:packaged-and-external-requirements), [Readiness](#guide:package-readiness), and [Troubleshooting](#guide:package-troubleshooting).
