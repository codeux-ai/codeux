# Dashboard Feature Flags

Dashboard feature flags hide unfinished dashboard surfaces without deleting their implementation or tests.

Flags live in `dashboard/src/v2/lib/dashboard-feature-flags.ts`. They are resolved at dashboard bundle time through Vite `import.meta.env` values:

- Development and test builds enable all flagged unfinished features by default.
- Production builds disable flagged unfinished features by default.
- Explicit env values override the mode default.

Supported values are `true`, `1`, `yes`, `on`, `enabled`, `false`, `0`, `no`, `off`, and `disabled`. Empty or unrecognized values fall back to the mode default.

## Current Flags

| Feature | Env variable | Development default | Production default | Scope |
| --- | --- | --- | --- | --- |
| `nodes` | `VITE_CODEUX_FEATURE_NODES` | enabled | disabled | Hides the unfinished `/nodes` surface from route registration, shared navigation, route prefetch, and the guided dashboard tour. |
| `custom-dashboards` | `VITE_CODEUX_FEATURE_CUSTOM_DASHBOARDS` | enabled | disabled | Hides the unfinished `/custom-dashboards` surface from route registration, shared navigation, route prefetch, and the guided dashboard tour. |

When a feature is disabled, its page module remains in source for local development and tests, but the route is not added to the TanStack route tree. Direct navigation falls through to the dashboard not-found route.

## Adding a Flag

1. Add the feature id and Vite env key in `dashboard-feature-flags.ts`.
2. Attach the `feature` id to any affected navigation item in `dashboard/src/v2/lib/navigation-items.ts`.
3. Gate route registration in `dashboard/src/main.tsx`.
4. Gate route prefetch entries in `dashboard/src/v2/router/route-prefetch.ts`.
5. Gate guided tour steps or other entry points that reference the hidden surface.
6. Add focused tests for default behavior, explicit overrides, and every hidden entry point.
7. Update this page and the matching canonical `docs/` page.
