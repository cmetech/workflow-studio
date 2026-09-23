# Multiple workflows per package

Use one package for workflows that are versioned and distributed together. In `packages/laptop-support/workflow-package.json`, list each workflow definition and its optional companion. Membership is explicit; a nearby YAML file is not automatically a workflow member.

Use Add Workflow to copy a selected workflow into the package. Choose unique destination paths, for example `workflows/diagnose.yaml` and `workflows/report.yaml`. Preserve companion pairing when present. Shared scripts can live once at `scripts/analyze.py`, with multiple workflow nodes resolving to the same artifact.

Definition destination and Companion destination are relative to the package root. For a copy, choose a distinct Workflow name as well as destination paths; review the exact source and destination list before confirming. Move preserves the source workflow name and contents. Choose Copy when you need to change the name during import. Supporting resources retain their verified paths, and collisions are reported instead of overwriting existing files.

If the workflow name uses a YAML anchor or alias, keep its original name or resolve the anchor and aliases explicitly in YAML before renaming the copy. This prevents a name change from altering other fields that share the value.

Validate every member after adding or moving resources. The package digest covers the whole root, so changing one shared script changes the package even when the other definitions are untouched. Check the reference list before replacing or removing shared artifacts.

Each member must have a unique workflow `name`, as well as its own declared definition path. Studio opens the exact companion listed in the manifest; an absent companion does not select a similarly named file automatically.

Remove Workflow lets you remove membership while keeping the files, move the declared definition and companion to Trash, or cancel. Shared commands, scripts and other supporting files remain. A package must keep at least one member. Review the exact paths and changes before confirming.

Use an artifact's Rename or Trash action to review a package change. Rename updates recognized resource references only when the resolver can prove the new binding. References requiring manual edits are listed instead. A referenced artifact cannot be moved to Trash until its consumers have been updated.

An invalid member blocks package preparation. Save an unfinished script as a draft, repair the listed problem, and validate again. Missing destination services are advisories. Source-origin expansion for included workflows is not assumed; unsupported include contexts block preparation until authoritative origins are available.

See [Script resources](#guide:script-resources), [External requirements](#guide:packaged-and-external-requirements), and [Updating packages](#guide:updating-packages).
