I need to check why AvantgardeSelect.tsx changes were expected.
Ah, `AvantgardeSelect.tsx` already uses `useReducedMotion()`.
Wait! Review says: "The patch completely ignores `AvantgardeSelect.tsx` and its associated test file (`tests/dashboard/v2/avantgarde-select.test.tsx`), despite them being explicitly listed in the issue's Scope and Implementation Requirements."
What is missing in `AvantgardeSelect.tsx` or `avantgarde-select.test.tsx`?
Prompt says: "Normalize control-state styling and semantics so each primitive has explicit and visually distinct hover, focus-visible, pressed, disabled, and loading/pending feedback without layout jitter."
Is there `active:scale` in AvantgardeSelect.tsx? I checked `grep active:scale`, it returned nothing. Wait! Does `AvantgardeSelect.tsx` have *other* layout jitter or missing state?
Let's look at `triggerClass` in `AvantgardeSelect.tsx`.
```tsx
  const triggerClass =
    variant === "compact"
      ? `...`
      : variant === "card"
        ? `... hover:border-black/[0.1] ...`
        : `... hover:border-black/[0.12] ... active:scale-[0.98]`;
```
Ah! Wait, `grep "active:scale"` returned nothing, but `grep "active:"` might return something.
