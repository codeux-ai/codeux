# Dashboard Feature Flags

Dashboard feature flags hide unfinished dashboard surfaces without deleting their implementation or tests.

Flags live in `dashboard/src/v2/lib/dashboard-feature-flags.ts`. They are resolved at dashboard bundle time through Vite `import.meta.env` values:

- Development builds always enable all flagged unfinished features so every in-progress surface remains available for local testing.
- Production builds disable flagged unfinished features by default.
- Explicit env values enable or disable features in production builds. Development mode intentionally overrides disabled values.

Supported values are `true`, `1`, `yes`, `on`, `enabled`, `false`, `0`, `no`, `off`, and `disabled`. In production, empty or unrecognized values fall back to disabled. Development mode enables every registered feature regardless of these values.

## Current Flags

| Feature | Env variable | Development default | Production default | Scope |
| --- | --- | --- | --- | --- |
| `nodes` | `VITE_CODEUX_FEATURE_NODES` | enabled | disabled | Requires `VITE_CODEUX_NODE_FLOW_BACKEND` and `VITE_CODEUX_AUTOMATION_SECURITY` to also be enabled in production. |
| `custom-dashboards` | `VITE_CODEUX_FEATURE_CUSTOM_DASHBOARDS` | enabled | disabled | Hides the unfinished `/custom-dashboards` surface from route registration, shared navigation, route prefetch, and the guided dashboard tour. |

When Nodes or either production prerequisite is disabled, its route is omitted from the route tree, navigation, and route prefetch. Development keeps the surface reachable for local integration testing.

## Adding a Flag

1. Add the feature id and Vite env key in `dashboard-feature-flags.ts`.
2. Attach the `feature` id to any affected navigation item in `dashboard/src/v2/lib/navigation-items.ts`.
3. Gate route registration in `dashboard/src/main.tsx`.
4. Gate route prefetch entries in `dashboard/src/v2/router/route-prefetch.ts`.
5. Gate guided tour steps or other entry points that reference the hidden surface.
6. Add focused tests for the development visibility override, production defaults and explicit overrides, and every hidden entry point.
7. Update this page and the matching `docs-web/` page.
