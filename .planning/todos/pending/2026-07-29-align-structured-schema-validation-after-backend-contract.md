---
created: 2026-07-29T10:23:18.956Z
title: Align structured schema validation after backend contract
area: general
files:
  - src/lib/forms/structured-draft.ts:132
  - src/lib/forms/structured-draft.ts:185
  - src/lib/forms/widget-registry.ts:452
  - src/features/inspector/widgets/StructuredValueEditor.svelte:1
  - contracts/hermes-legacy-v1.json:1
  - contracts/archon-2026-07-v1.json:1
---

## Problem

Defer the remaining Phase 3 Task 4 structured-schema validation defect until the Hermes backend workflow phases and their production authoring-contract fields are complete. The current inspector capability predicate can report a structured schema as editable even when local validation does not fully enforce that accepted schema:

- `propertyNames` validation applies `pattern` but not the complete child schema, such as `enum`;
- object and array schemas do not reject values of the wrong base type;
- `if` and `not` can consequently evaluate the wrong result because they depend on those incomplete checks.

A focused probe at Workflow Studio commit `2130bf1` demonstrated that all four schemas were reported supported with no validation errors:

```text
propertyNames enum {"supported":true,"errors":[]}
object type {"supported":true,"errors":[]}
array type {"supported":true,"errors":[]}
not object {"supported":true,"errors":[]}
```

Authoritative pair analysis remains a safety net, so no YAML loss or known data corruption is established. However, the form may enable an edit it cannot validate consistently, violating the Task 4 requirement that supported contract shapes be correctly editable and unsupported shapes fail closed.

This was the sole load-bearing residual from the final scoped review after commits `4140c78`, `be91fc5`, `5a75af9`, `cbeafbc`, and `2130bf1`. At that point `npm run verify` passed 511 TypeScript tests and 60 Rust tests, contract validation and the production build passed, and the tracked worktree was clean.

## Solution

Revisit this together with the additional workflow fields after the Hermes backend contract is complete:

1. Regenerate both pinned production contracts from the authoritative Hermes CLI; do not hand-maintain a field or keyword inventory.
2. Inventory every schema shape and validation keyword actually published by both completed profiles.
3. Add failing tests using the production schemas and examples, including full `propertyNames` evaluation, object/array base-type rejection, and correct `if`/`then`/`not` behavior.
4. Make `canEditStructuredSchema()` and `validateSchemaValue()` share one supported-keyword contract. Implement each published keyword correctly or reject the affected shape with `contract_reader_unsupported_widget` while preserving YAML.
5. Prove every supported production example round-trips through a typed widget and every unsupported shape fails closed.
6. Rerun the Task 4 contract, forms/inspector, App integration, accessibility, full verification, build, and independent review gates.

Trigger: begin this todo only after the Hermes backend workflow phases and new authoring-contract fields have stabilized.
