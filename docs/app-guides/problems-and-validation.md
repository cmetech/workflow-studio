# Problems and validation

Use this guide when a workflow cannot be saved or exported. Workflow Studio validates authoring structure locally, while Hermes remains responsible for runtime behavior.

## Four validation layers

1. **YAML syntax** checks parsing, scalar values, duplicate keys, and document shape. Invalid YAML is a save/export blocker.
2. **Contract and schema** checks required fields, field types, supported node kinds, and profile rules from the active Hermes authoring contract. Missing required values and profile-disallowed fields block save/export.
3. **Semantic DAG** checks node identity, dependency existence, acyclicity, conditions, and statically resolvable references. Duplicate IDs, missing dependencies, cycles, and invalid graph references block save/export.
4. **Compatibility and operational context** reports deferred or profile compatibility findings and possible runtime concerns. Compatibility findings may be warnings or blockers according to the active contract; operational advisories never make an authoring claim about whether execution will succeed.

## What blocks save and export

Resolve blocking syntax, contract/schema, and semantic DAG Problems before saving or exporting. A profile mismatch or another contract finding marked blocking must also be resolved. The editor keeps the YAML text you typed, so you can correct it without losing work.

Missing commands, scripts, providers, models, tools, MCP services, skills, credentials, or secrets are not local execution checks. They remain non-blocking runtime advisories. Network and service availability, runtime resources, actual model output, trust/admission, and operational success are also advisories; Workflow Studio does not run the workflow to test them.

## When YAML is invalid

If a YAML edit cannot be parsed or projected safely, the editor preserves the text and retains the last valid visual projection. Visual graph and form mutations become read-only until the text is valid again. Fix the highlighted syntax first, then re-check the contract and DAG Problems.

## Follow a Problem to the right place

Select a Problem to navigate to its most specific available surface: a YAML location for syntax, the exact field or node in the Inspector for contract findings, or the relevant graph/field topic in Documentation. A Problem link never silently opens a less-specific duplicate field topic.

For graph ordering, read [DAG dependencies](#guide:dag-dependencies). For definition and companion placement, read [Workflow pairs](#guide:workflow-pairs). For practical recovery, see [Troubleshooting](#guide:troubleshooting).
