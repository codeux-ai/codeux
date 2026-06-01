---
name: monorepo-cross-layer-constant-definition
description: Fix TS errors when a constant is referenced across backend/frontend layers in a monorepo with separate tsc compilation contexts
source: auto-skill
extracted_at: '2026-05-31T22:10:15.828Z'
---

# Fixing cross-layer constant definition in monorepos

When a shared constant (e.g., `DEFAULT_PROVIDER_WEIGHT`) is needed in both the backend and frontend layers of a monorepo where each layer has its own `tsconfig.json` and compilation scope, you must define the constant in the **lowest common dependency layer** — typically the backend module — and import it from there into the frontend.

## Diagnosis

1. **Check the error carefully.** A `TS2552: Cannot find name 'X'. Did you mean 'Y'?` error during `tsc` for the backend module means the constant is referenced but not defined or imported in that compilation context.

2. **Grep for the constant name** across the entire repo to find where it's defined vs. referenced:
   ```
   grep -rn "DEFAULT_PROVIDER_WEIGHT" --include='*.ts' --include='*.tsx'
   ```

3. **Identify the boundary:** The backend's `tsconfig.json` typically only covers `src/`, while the frontend covers `dashboard/src/`. The frontend can import from the backend if the backend is a valid source (type declarations exist, or `moduleResolution` allows it), but the backend cannot import from the frontend (since frontend sources aren't in its compilation scope).

## Fix procedure

1. **Define the constant in the backend** module (e.g., `src/repositories/settings-defaults.ts`) where it logically belongs alongside other defaults.

2. **Remove any duplicate definition** from the frontend module.

3. **Import from the backend** in the frontend:
   ```typescript
   import { DEFAULT_PROVIDER_WEIGHT } from "../../../../src/repositories/settings-defaults.js";
   ```
   **Critical:** Verify the correct relative path depth. A file at `dashboard/src/v2/lib/` is 4 levels deep from the repo root, needing `../../../../`, while a file at `dashboard/src/lib/` is 3 levels deep needing `../../../`. An incorrect depth causes `TS2307: Cannot find module`.

4. **Update any test assertions** that hardcoded the old default value (e.g., `expect(weight).toBe(20)` → `expect(weight).toBe(50)`).

## Validation

After the fix, run the full CI suite on the project:

```
# For this specific project:
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

Verify that the specific `TS2552` errors are gone and no new module resolution errors (`TS2307`) were introduced by incorrect import paths.