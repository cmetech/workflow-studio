# Package path Unicode compatibility

The adjacent implementation and generated Unicode 14.0.0 tables come from the agent desktop at the immutable commit in `provenance.json`. That file records SHA-256 values of the original committed source files.

Studio exports the existing NFC helper, formats the implementation, and adds checked-index TypeScript assertions where loop/length guards establish bounds. The normalization and folding algorithms and generated tables are otherwise unchanged. Do not replace them with JavaScript lowercasing or a host-dependent Unicode table: package collision decisions must match the pinned agent.

This is a shared Unicode algorithm, not a workflow resource-field inventory. Package contract and vector pins remain separate. Any upstream Unicode upgrade requires explicit compatibility review and tests.
