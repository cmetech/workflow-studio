# Package resource-resolution coverage

The immutable upstream revision and exact artifact hashes are recorded in
[`workflow-package-provenance.json`](../../contracts/workflow-package-provenance.json).
The separate resource-resolution contract is the authority for lookup operations;
the package format contract's `resource_rules` continues to supply limits only.

## Surface matrix

| Surface | Authoritative descriptor | Required parity evidence |
| --- | --- | --- |
| Root named script | `surfaces`, root script selector and its `value_discriminator` | uv/Bun candidates, explicit suffixes, competing files, missing files, inline/literal discriminator vectors |
| Body named script | `surfaces`, body script selector; `scope` | v6 loop-group compilation with scoped node identity |
| Root command | `surfaces`, root command selector | Authored-first compiler lookup, replace-suffix versus runtime append, successful command binding |
| Body command | `surfaces`, body command selector; `scope` | v6 loop-group command binding |
| Root loop command | `surfaces`, root loop-command selector | Successful loop-command compilation and missing command diagnostics |
| Body loop command | `surfaces`, body loop-command selector | Successful body binding where admitted, or explicit language rejection; never assume descriptor presence alone grants validity |
| Node MCP | `mcp_surface`, `scope` effective options | Direct/nested/suffix lookup, missing packaged definition, group default/node override, authored shape versus normalized values |
| MCP local files | `mcp_local_closure` | Whole-string and flag-value candidates, existing local files, absent external strings, host interpreter exclusion |
| Included workflows | `scope.owner`, `scope.include` | Same resource name resolves against the included source's origin; catalog/source context must be supplied |
| Inline scripts | `value_discriminators_v1` | Code-point ranges and punctuation from the export; no trimming or host-language whitespace substitution |
| Definition and companion | Package membership plus `ownership` | Exact files remain package content; companion origin is not an independent resource lookup root |
| Runtime/tool/provider/service/credential requirements | `ownership` | Advisory availability findings; declarations cannot excuse a missing package-owned resource |

## Consumer admission

Studio preparation uses compiler-source semantics. Live runtime and sealed lookup
descriptors remain separate and must not be substituted for compiler lookup.
An existing unsafe higher-priority compiler candidate is an error, not permission
to select a later safe candidate. A package scan must reject symlinks independently
of whether a reference reaches them.

The export is a portable subset, not a general compiler implementation. Consumers
must fail closed on unsupported contracts, profiles, normalizer versions, operations,
or missing origin/context information. Legacy-profile resource preparation is not
implicitly supported by the Archon compiler export. Required host context applies
to the resource operations that need it; an unavailable runtime alone remains an
advisory. Do not infer Python/JavaScript imports, shell dependencies, or the intent
of an absent arbitrary string in an MCP document.

## Verification boundary

Artifact loading, checksum verification, and offline release inclusion establish
that Studio has the exported data. They do not satisfy the interpreter parity gate.
Task 3 must execute applicable lookup, discriminator, MCP-candidate, admission, and
compilation fixtures and prove the matrix above before preparation can use the result.
Static artifact analyzers remain separate Tasks 6–7 dependencies for full readiness.
Native scan identity, cache/symlink behavior, and platform support must be reported
from actual tests, with skipped or unsupported cases kept explicit.
