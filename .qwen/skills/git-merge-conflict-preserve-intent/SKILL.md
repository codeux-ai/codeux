---
name: git-merge-conflict-preserve-intent
description: Procedure for resolving Git merge conflicts by preserving the intent of both branches rather than choosing one side's version wholesale
source: auto-skill
extracted_at: '2026-05-31T22:16:01.370Z'
---

# Resolving Merge Conflicts by Preserving Both Branches' Intent

When a merge conflict has both sides making valid, non-contradictory changes at the same location, the correct resolution is often to **preserve the intent of both branches** rather than picking one side wholesale.

## Procedure

### 1. Diagnose both sides
Read the conflicted block and identify *what each branch is trying to do*:

- **`<<<<<<< HEAD`** — changes from your current branch (the feature/topic branch)
- **`=======`** — separator
- **`>>>>>>> <other-branch>`** — changes from the branch being merged in

For each side, answer: *"What problem is this change solving?"*

### 2. Categorize each side's contribution
Common categories of non-conflicting intent in the same block:

| Category | Example | Should preserve? |
|----------|---------|-----------------|
| New variable/state | Feature branch adds `useState` for a UI component | ✅ Keep |
| Defensive coding | Dev branch adds optional chaining/null checks | ✅ Keep |
| Interface expansion | Feature branch adds new props | ✅ Keep |
| Bug fix | Either branch replaces a broken pattern | ✅ Keep |
| Genuine logical conflict | Both change the same conditional branch | Needs manual judgment |
| Formatting-only | Whitespace, import reorder | Usually safe to keep both |

### 3. Resolve by composing, not choosing
Replace the entire conflicted block (from `<<<<<<< HEAD` through `>>>>>>> <branch>`) with code that includes **both** changes:

```diff
- <<<<<<< HEAD
- const stateVar = featureBranchAddition();
- const accessor = settings.path;  // direct access from feature branch
- =======
- const accessor = settings?.path?.nested;  // safe access from dev
- >>>>>>> origin/dev
+ const stateVar = featureBranchAddition();   // ← kept from HEAD
+ const accessor = settings?.path?.nested;    // ← kept from other branch
```

### 4. Verify indentation consistency
After composing, ensure the resulting block has consistent indentation — the edit may have introduced mismatched spacing on one line.

### 5. Run full verification gates
Before committing, verify the resolution with the project's full CI gates:

```
npm run lint
npm run typecheck
npm run test
npm run build
```

### 6. Write a descriptive merge commit
Document *why* both changes were kept in the commit body:

```
Merge branch 'dev' into feature/my-branch

Resolve conflict in path/to/file.ts:
- Keep <feature> from feature branch (reason: needed by <consumer>)
- Adopt <defensive pattern> from dev branch (reason: safer null handling)
```

## When NOT to use this approach

- When the two changes are **logically contradictory** (e.g., one sets a value to `true` and the other to `false`)
- When one side is a **revert** of the other's work
- When both sides touch the same architecture decision (e.g., different library choices) — require human judgment