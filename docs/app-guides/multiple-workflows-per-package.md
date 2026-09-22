# Multiple workflows per package

Use one package for workflows that are versioned and distributed together. In `packages/laptop-support/workflow-package.json`, list each workflow definition and its optional companion. Membership is explicit; a nearby YAML file is not automatically a workflow member.

Use Add Workflow to copy a selected workflow into the package. Choose unique destination paths, for example `workflows/diagnose.yaml` and `workflows/report.yaml`. Preserve companion pairing when present. Shared scripts can live once at `scripts/analyze.py`, with multiple workflow nodes resolving to the same artifact.

Validate every member after adding or moving resources. The package digest covers the whole root, so changing one shared script changes the package even when the other definitions are untouched. Check the reference list before replacing or removing shared artifacts.

An invalid member blocks package preparation. Save an unfinished script as a draft, repair the listed problem, and validate again. Missing destination services are advisories. Source-origin expansion for included workflows is not assumed; unsupported include contexts block preparation until authoritative origins are available.

See [Script resources](#guide:script-resources), [External requirements](#guide:packaged-and-external-requirements), and [Updating packages](#guide:updating-packages).
