# Dashboard architecture

The dashboard is a Preact + Vite + Tailwind v4 single-page application served by the Express dashboard server. It is the primary interface for humans operating Code UX.

This page describes its structure, build pipeline, real-time client, and state model.

## Stack

| Layer | Technology |
| --- | --- |
| UI framework | Preact 10 with `@preact/signals` |
| Routing | TanStack React Router 1.166 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`) |
| Iconography | `lucide-preact` + `lucide-react` |
| Animation | GSAP 3.14 |
| 3D background | Three.js 0.183 |
| Markdown | `marked` 17 |
| Build | Vite 8 with `@preact/preset-vite` |

The bundle is split for caching: a vendor chunk, a per-page chunk (lazy-loaded), and a small entry chunk.

## Source layout

```
dashboard/src/
├── main.tsx              # Preact entry, router setup
├── styles.css            # Tailwind + design tokens
├── types.ts              # shared types
├── lib/                  # API client, realtime client, utilities
│   ├── api/              # REST client wrapper
│   └── realtime/         # WebSocket client + reconnection logic
├── hooks/                # generic hooks
└── v2/                   # current dashboard implementation
    ├── DashboardV2.tsx
    ├── ChatPage.tsx
    ├── AgentsPage.tsx
    ├── MemoryPage.tsx
    ├── BrowserPage.tsx
    ├── SettingsPage.tsx
    ├── ProjectsPage.tsx
    ├── TasksPage.tsx
    ├── StatsPage.tsx
    ├── LiveSessionPage.tsx
    ├── pages/sprints/SprintsPage.tsx
    ├── components/       # 50+ reusable components
    ├── hooks/            # data hooks (useProjectData, useDashboardRuntimeData, …)
    ├── context/          # ProjectDataProvider
    └── types.ts
```

The `v2/` directory is the current dashboard implementation. Older legacy code in `dashboard/src/components/` and `hooks/` exists for transitional pieces.

## Build

`vite.config.ts` configures:

- `@preact/preset-vite` (no React aliases — uses Preact's compat layer).
- `@tailwindcss/vite` for Tailwind v4 JIT.
- Manual chunk splitting (vendor isolation).
- Output to `dashboard/dist/`.

Build commands:

```bash
pnpm run build:dashboard   # production
pnpm run dev:dashboard     # HMR dev server
```

## Routing

```ts
const routes = [
  { path: "/",         component: DashboardV2 },
  { path: "/projects", component: ProjectsPage },
  { path: "/sprints",  component: SprintsPage },
  { path: "/tasks",    component: TasksPage },
  { path: "/live",     component: LiveSessionPage },
  { path: "/chat",     component: ChatPage },
  { path: "/agents",   component: AgentsPage },
  { path: "/memory",   component: MemoryPage },
  { path: "/browser",  component: BrowserPage },
  { path: "/stats",    component: StatsPage },
  { path: "/config",   component: SettingsPage },
];
```

The root layout renders an `AppLayout` wrapper around every page. Layout features:

- **Dock or Sidebar** navigation (chosen per `appearance.navigationMode`).
- **Top bar** with project selector and theme toggle.
- **`ProjectDataProvider`** in context — supplies the active project + selected sprint to descendants.
- Lazy-loaded **`DeepOceanBackground`** (Three.js scene) after first paint.

## State model

State is managed with a mix of:

- **`@preact/signals`** for global and page-level reactive state.
- **Custom data hooks** wrapping REST + WebSocket subscriptions:
  - `useDashboardRuntimeData()` — live execution data.
  - `useRealTimeResource()` — generic WebSocket subscription wrapper.
  - `useProjectData()` — active project / sprint.
  - `useSprints()`, `usePreviewSessions()`, `useChatPageData()`, `useSettingsPageState()`, `useMemoryPageData()`, `useOverviewPageData()`, `useExecutionTimeline()`, `useProgressiveList()`.

Hooks own their own subscription lifecycle — they subscribe on mount, unsubscribe on unmount.

## API client

`dashboard/src/lib/api/dashboard-api.ts` is a thin fetch wrapper that:

- Prefixes all paths with the dashboard origin.
- Handles JSON encoding / decoding.
- Surfaces structured errors (`{ error: { code, message } }`).
- Cancels in-flight requests via `AbortSignal` when the caller passes one.

Every REST endpoint listed in the [HTTP API reference](../developer/http-api.md) has a matching wrapper function.

## Realtime client

`dashboard/src/lib/realtime/dashboard-realtime-client.ts`:

- Connects to `wss://<origin>/api/realtime` on first subscribe.
- Maintains per-scope `lastSequence` for resumable reconnection.
- Auto-reconnects with exponential backoff (max 30 s).
- Emits typed events to subscribed hooks.
- Falls back to polling the corresponding REST endpoint if the WebSocket can't connect.

Per-scope cooldown (3 s) prevents subscribe-storms after rapid mount/unmount cycles.

## Design system

The visual identity is **Warm Void** — a warm-leaning palette with deep blacks, off-whites, and accent oranges. It supports both Light and Dark themes via Tailwind's `dark:` variant; the `theme` setting determines which is active.

Key tokens (defined in `styles.css`):

- Surface elevation (4 levels).
- Border radii (sm / md / lg / pill).
- Typography scale (display / heading / body / caption).
- Animation durations (fast / base / slow).

Components prefer **design tokens over hardcoded values**. New components should reuse existing tokens rather than introducing one-offs.

## Accessibility

- Every interactive element is keyboard-reachable.
- Focus rings are visible (Tailwind's `focus-visible:` variants).
- `aria-*` labels on iconography.
- Live-region announcements for status changes (`role="status"` on the live session header).
- Contrast meets WCAG 2.1 AA in both themes.

Tests in `tests/dashboard/` exercise keyboard nav for headline components.

## Lazy loading

Page modules are lazy-loaded by the router. Heavyweight subviews (DAG visualisation, Boat Race, embedding map graph, Three.js background) are also lazy-loaded via dynamic `import()`, so the initial bundle stays small.

## Component conventions

- Files use PascalCase for components, kebab-case for utility modules.
- One component per file when the component is non-trivial; group small helpers in `components/<feature>/index.ts` re-exports.
- Component props end with `Props`; events use `onSomething` callback props.
- Tailwind classes inline; no CSS-in-JS layer.

## Reusable patterns

- `SkeletonPanel` / `ListSkeletons` for loading states.
- `ConfirmDialog` for destructive confirmations.
- `Tooltip`, `Modal`, `Menu` — accessibility-compliant primitives built in-house.
- `BorderTrace`, `WaveFluid` — decorative animated borders/effects (used sparingly).
- `IntelPanel` — styled info-panel surface.

## Performance budgets

- First-contentful paint target: < 1.5 s on warm cache, < 3 s on cold.
- Initial JS payload: < 250 KB gzipped (route chunks load on demand).
- Live update latency: < 500 ms median on a local server.

Bundle size is monitored manually in CI via `vite build` output. Adding new dependencies requires explicit justification.
