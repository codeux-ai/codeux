# Techstacks

Manages the system techstack catalog and per-project techstack/application-kind assignment.

## What It Controls

System scope owns the catalog: stack ids, stack names, technology items, and the catalog default. Project scope stores only the selected stack id and application kind, with explicit `Unassigned` support.

## Recommended Defaults

Keep imported projects unassigned until setup detection or an operator chooses a stack. Use the built-in Code UX internal stack only for Code UX-style Preact dashboards; create custom stacks for other project families.

## Risks And Gotchas

The built-in `code-ux-internal` stack cannot be removed. Removing a custom stack also clears system-default references to it; project assignments should be reviewed before deleting stacks that are in active use.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#techstacks`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Configuration and Storage](../configuration-and-storage.md)
- [Settings Reference](../../developer/settings-reference.md)
