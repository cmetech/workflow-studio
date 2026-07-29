# Troubleshooting

Start with the Problems panel: fix YAML syntax, required values, invalid profile fields, and graph topology before saving or exporting.

```yaml
name: troubleshooting-start
description: Start with a structurally valid bash node.
nodes:
  - id: start
    bash: "printf 'ok\\n'"
```

Structural problems block save/export. Missing tools, services, credentials, providers, and runtime results are operational advisories; Workflow Studio does not run workflows. See [DAG and conditions](#contract:dag-and-conditions) and [Bash](#node:bash).
