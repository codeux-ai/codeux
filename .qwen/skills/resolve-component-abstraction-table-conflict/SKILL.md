---
name: resolve-component-abstraction-table-conflict
description: Resolve Git merge conflicts where one branch migrated table cells/pages to a component abstraction while the other branch added responsive CSS width/layout classes to raw HTML elements in the same file
source: auto-skill
extracted_at: '2026-06-01T01:30:49.300Z'
---

# Resolving Component-Abstraction vs Raw-HTML Merge Conflicts in Table Components

When a feature branch introduces a shared `Table`/`TableRow`/`TableCell` component abstraction (e.g., to standardize border radii, strokes, and responsive behavior per task T04) while the target branch simultaneously adds explicit responsive width classes (`lg:w-[Npx] lg:min-w-[Npx]`) and layout styles (`block lg:table-cell`) directly on raw `<td>`/`<th>` elements in the same files, both branches' contributions must be preserved without reverting the abstraction.

## When to use

This pattern applies when ALL three conditions are true:

1. **Abstraction branch (HEAD)**: Replaced raw `<table>`/`<tr>`/`<td>`/`<th>` with components like `<Table>`, `<TableRow>`, `<TableCell>` that have props like `isFirst`, `isLast`, `align`, `isHeader`.
2. **Styling branch (other)**: Added responsive column width classes and explicit `block lg:table-cell` patterns directly on raw HTML table elements in the same files.
3. **The conflict markers** appear at every cell boundary — not because the logic diverged, but because one side wraps in a component and the other uses a raw element with more CSS classes.

## Diagnosis

Run `git status` to identify conflicted files, then read each conflict block. The pattern looks like:

```
<<<<<<< HEAD
      <TableCell isFirst className="w-12">
        <button ...>...</button>
      </TableCell>
=======
      <td className="block px-4 pb-0 pt-4 align-middle lg:table-cell lg:w-[80px] lg:min-w-[80px] ...">
        <button ...>...</button>
      </td>
>>>>>>> origin/dev
```

Key observation: the **children** (the `<button>` and its contents) are **identical** on both sides — only the wrapper element changes, and the styling branch adds width/layout classes.

## Resolution procedure

### 1. Read the component abstraction's API

Before resolving, read the `Table`, `TableRow`, and `TableCell` component source to understand:

- What base classes does `TableCell` already apply? (e.g., `block px-4 py-3 align-middle lg:table-cell lg:border-y lg:px-4 lg:py-3`)
- What do `isFirst` / `isLast` resolve to? (typically `lg:rounded-l-[1.5rem] lg:border-l lg:pl-6` / `lg:rounded-r-[1.5rem] lg:border-r lg:pr-6`)
- What does `align` control? (text alignment class)
- Does `isHeader` render a `<th>` or `<td>`?

This tells you which classes are **already handled** by the component (so you should NOT duplicate them) and which are **additional** (width constraints, custom mobile padding, per-cell overrides).

### 2. Map styling-branch classes to component props

For each cell, categorize the styling-branch classes:

| Category | Examples | Action |
|----------|----------|--------|
| Already handled by component | `block lg:table-cell lg:border-y lg:px-4 lg:py-3 lg:rounded-l-[1.5rem] lg:border-l lg:pl-6 lg:rounded-r-[1.5rem] lg:border-r lg:pr-6 lg:border-y` | **Drop** — component already renders these via base classes or `isFirst`/`isLast`/`align` props |
| Width constraints | `lg:w-[80px] lg:min-w-[80px]`, `lg:w-[220px] lg:min-w-[220px]` | **Pass as `className`** — these are column-specific and not part of the component abstraction |
| Cell-level overrides | `pb-0 pt-4` (different mobile padding than the default `py-3`) | **Pass as `className`** — decide whether the abstraction's default is acceptable or override per-cell |

### 3. Compose the resolved cell

Keep the abstraction component, add only the *non-duplicated* classes as className:

```tsx
{/* BEFORE - raw HTML from styling branch */}
<td className="block px-4 pb-0 pt-4 align-middle lg:table-cell lg:w-[80px] lg:min-w-[80px] lg:rounded-l-[1.5rem] lg:border-y lg:border-l lg:px-4 lg:py-4 lg:pl-6">
  {children}
</td>

{/* AFTER - component with width classes only */}
<TableCell isFirst className="lg:w-[80px] lg:min-w-[80px]">
  {children}
</TableCell>
```

For header cells (component renders `<th>` via `isHeader`):

```tsx
{/* BEFORE - raw th from styling branch */}
<th className="w-[80px] min-w-[80px] rounded-l-2xl border-y border-l border-black/[0.06] bg-white/55 px-4 py-3 pl-6 dark:...">
  {contents}
</th>

{/* AFTER - component with width classes */}
<TableCell isHeader isFirst className="w-[80px] min-w-[80px]">
  {contents}
</TableCell>
```

### 4. Preserve all imports from both branches

Both branches may add imports. Keep all of them — then run `grep` for each imported symbol to verify it's actually referenced. Remove any import that has become unused after resolution (e.g., a component symbol from the raw-HTML branch that is no longer needed because the abstraction covers it).

### 5. Handle duplicate styling blocks

If both branches add a JSX block at the same location (e.g., a human intervention badge), and one branch adds it as an inline element while the other refactors it into a reusable sub-component with richer features (pulse animation, positioning), **choose the refactored version**. The abstraction supersedes the inline version. Remove the inline version entirely.

### 6. Verify

```bash
# No conflict markers remain
grep -rn '<<<<<<<\|=======\|>>>>>>>' <directory>

# All quality gates pass
npm run typecheck && npm run lint && npm run test && npm run build
```

## Example: Full resolution in SprintLedgerRow.tsx

The file had 10 conflict blocks (one per cell + TableRow). Each followed the same pattern:

1. Read `TableRow` → already handles `block lg:table-row`, hover, rounded, shadow
2. Read `TableCell` → base: `block px-4 py-3 align-middle lg:table-cell lg:border-y lg:px-4 lg:py-3`; `isFirst` → adds `lg:rounded-l-[1.5rem] lg:border-l lg:pl-6`; `isLast` → adds `lg:rounded-r-[1.5rem] lg:border-r lg:pr-6`
3. For each cell: kept `<TableCell>` component, added `lg:w-[Npx] lg:min-w-[Npx]` as className, dropped all other classes that the component already provides
4. Added `getSprintStatusPresentation` import from styling branch (needed for badge logic)
5. Merged `TableRow` className with both branches' hover/greyscale/opacity classes