# Dashboard Feature Flags

Dashboard feature flags hide unfinished dashboard surfaces without deleting their implementation or tests.

Flags live in `dashboard/src/v2/lib/dashboard-feature-flags.ts`. They are resolved at dashboard bundle time through Vite `import.meta.env` values:

- Development builds always enable the `nodes` and `custom-dashboards` discovery surfaces so those in-progress pages remain available for local testing.
- Production builds disable unfinished surfaces by default; explicit env values enable or disable them.
- Cinematic quick-action flags default to disabled in every mode and require an explicit env opt-in. Their underlying surface flag must also be enabled.

Supported values are `true`, `1`, `yes`, `on`, `enabled`, `false`, `0`, `no`, `off`, and `disabled`. Empty or unrecognized values fall back to the flag's documented default. Development mode intentionally overrides disabled values only for the two discovery surfaces.

## Current Flags

| Feature | Env variable | Development default | Production default | Scope |
| --- | --- | --- | --- | --- |
| `nodes` | `VITE_CODEUX_FEATURE_NODES` | enabled | disabled | Requires `VITE_CODEUX_NODE_FLOW_BACKEND` and `VITE_CODEUX_AUTOMATION_SECURITY` to also be enabled in production. |
| `custom-dashboards` | `VITE_CODEUX_FEATURE_CUSTOM_DASHBOARDS` | enabled | disabled | Hides the unfinished `/custom-dashboards` surface from route registration, shared navigation, route prefetch, and the guided dashboard tour. |
| `chat-nodes-workflow-quick-action` | `VITE_CODEUX_FEATURE_CHAT_NODES_WORKFLOW_QUICK_ACTION` | disabled | disabled | Shows **Add Nodes Workflow** only when this flag and `nodes` are both enabled. |
| `chat-custom-dashboard-quick-action` | `VITE_CODEUX_FEATURE_CHAT_CUSTOM_DASHBOARD_QUICK_ACTION` | disabled | disabled | Shows **Add Dashboard** only when this flag and `custom-dashboards` are both enabled. |

When Nodes or either production prerequisite is disabled, its route is omitted from the route tree, navigation, and route prefetch. Development keeps the surface reachable for local integration testing. This discovery override does not expose either cinematic workflow quick action; each action remains hidden until its dedicated opt-in flag is enabled.

## Adding a Flag

1. Add the feature id and Vite env key in `dashboard-feature-flags.ts`.
2. Attach the `feature` id to any affected navigation item in `dashboard/src/v2/lib/navigation-items.ts`.
3. Gate route registration in `dashboard/src/main.tsx`.
4. Gate route prefetch entries in `dashboard/src/v2/router/route-prefetch.ts`.
5. Gate guided tour steps or other entry points that reference the hidden surface.
6. Choose whether the flag is a development discovery surface or a default-off capability, then add focused tests for mode defaults, explicit overrides, prerequisites, and every hidden entry point.
7. Update this page and the matching canonical `docs/` page.
