---
name: fix-missing-variable-in-hook
description: Diagnose and fix missing variable declarations in React/Preact hooks where a variable is referenced but never defined
source: auto-skill
extracted_at: '2026-05-31T22:12:58.686Z'
---

# Fix: Missing variable declaration in a hook (used in useEffect dependency + returned)

## Diagnostic pattern
When CI fails with `ReferenceError: <name> is not defined` and the stack trace points to a React/Preact hook file:
1. The variable is likely referenced in a `useEffect` callback, the effect's dependency array **and** the hook's return value — but was never declared with `const`/`let`.
2. Grep for all occurrences of the variable name in the file.
3. If you find only **reads** and no **declaration** (`const ... =`, `let ... =`), you've found the bug.

## Fix procedure

### 1. Find the precedent (analogous variable)
Look for a sibling variable that follows the same semantic pattern. For example, if `activeX` is missing and `activeY` is defined as:
```ts
const activeY = activeScope === "a" ? yA : yB;
```
Then `activeX` should follow:
```ts
const activeX = activeScope === "a" ? xA : xB;
```

### 2. Place the declaration BEFORE any useEffect that uses it
**Critical:** If the variable is referenced in a `useEffect` dependency array (`}, [activeDirty]);`), the declaration MUST appear before the `useEffect()` call in source order. JavaScript `const` declarations are subject to the **temporal dead zone (TDZ)** — referencing them before the declaration line (even in a dependency array evaluated at render time) throws `ReferenceError`.

**Incorrect** ❌ (definition after the effect):
```ts
useEffect(() => {
  if (!activeX) return;
}, [activeX]);     // TDZ error: activeX not yet declared

const activeX = ...;  // too late
```

**Correct** ✅ (definition before the effect):
```ts
const activeX = ...;  // declared first

useEffect(() => {
  if (!activeX) return;
}, [activeX]);     // fine: activeX is hoisted/declared by this point
```

### 3. Verify
- Run `npm run typecheck` (or `pnpm typecheck`) — must pass with zero errors.
- Run the specific test file that triggered the failure — it should now pass.
- Run the full test suite to confirm no regressions.