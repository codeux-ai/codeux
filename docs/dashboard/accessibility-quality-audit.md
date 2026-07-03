# Dashboard Accessibility Quality Audit

Use this checklist when changing dashboard shell navigation, shared primitives, forms, live runtime surfaces, tables, browser controls, task boards, settings, telemetry, stats, or responsive layouts. It is a repeatable contract for the current v2 dashboard, not a generic accessibility checklist.

## Source Areas

The contracts below are implemented across `dashboard/src/v2/components/ui/*`, `dashboard/src/v2/components/TopNav.tsx`, `dashboard/src/v2/SettingsPage.tsx`, `dashboard/src/v2/TasksPage.tsx`, `dashboard/src/v2/BrowserPage.tsx`, live runtime components such as `LiveSessionPage.tsx`, `OverviewTelemetry.tsx`, `components/live-session/*`, and Stats components under `dashboard/src/v2/pages/stats/`.

## Semantic Structure

- Every route-level page must render inside the shell's single `main` landmark and expose a named workbench/page region through `PageContainer` or equivalent labeling. Page sections must use stable headings or `aria-label`/`aria-labelledby` names.
- Page headings must remain unique and ordered: one route-level title, then named regions for controls, rails, lists, tables, charts, feeds, and forms.
- Top navigation must keep `nav` landmarks for primary navigation and stable accessible names for project, sprint, worker, Docker, notification, and theme controls.
- Dropdown-like selectors use the role that matches their behavior: `listbox`/`option` for project, sprint, task-sprint, and file/change selection; `menu`/`menuitem` for command menus; `tablist`/`tab`/`tabpanel` for ledgers and mode panels; `radiogroup`/`radio` for mutually exclusive Settings choices.
- Data tables and ledger-like displays must use native table semantics or the shared `Table` primitive. Tables need a descriptive caption or accessible label, sortable headers need `aria-sort`, and stacked mobile rows need mobile labels for each meaningful cell.
- Feed-like runtime timelines should use named `region` or `log` containers. `role="log"` is appropriate for append-only timeline entries; use `role="status"` for discrete state changes.

## Keyboard And Focus

- Menus, listboxes, tabs, and browser/task/sprint selectors must support `Enter`, `Space`, arrow keys, `Home`, `End`, and `Escape` according to their role. `Escape` closes the surface and restores focus to the trigger.
- Dialogs, alert dialogs, popovers that act as dialogs, Add Project/Add Task modals, destructive confirmations, and unsaved-change prompts must trap focus while open and restore focus after close. If the trigger disappears, focus falls back to a sensible page landmark.
- Route changes that originate from dashboard controls should not strand focus in removed DOM. When a control navigates to another route or switches a major workbench surface, the destination page must expose a named landmark that can receive programmatic or natural focus.
- Destructive actions must require an explicit confirmation pattern. Hold-to-confirm and danger dialogs must expose the destructive target in the accessible name or description and keep progress descriptions stable rather than repeatedly announcing every animation frame.
- Browser Preview controls must be keyboard reachable for session rail selection, launch/rebuild/stop/open actions, address entry, script save, log viewing, and chrome controls. The embedded preview iframe must have a descriptive title, but dashboard keyboard contracts stop at the dashboard chrome boundary.
- Pointer-only affordances, such as task-card drag effects, must not trap `Enter` or `Space` unless there is a supported keyboard action with the same result.

## Accessible Names

- Icon-only buttons must have explicit names. Do not rely on `title`, icon shape, placeholder text, color, or hover-only labels.
- Provider tiles, provider-instance actions, preview controls, settings toggles, task actions, command actions, telemetry items, compact mobile controls, and Stats mode buttons must include the object being acted on when the same action repeats in a list.
- Visible labels and accessible names should start with the same wording where practical so speech users can activate controls by visible text. Add counts, state, provider/model names, or selected values after the visible phrase.
- Decorative icons and ambient visuals must be `aria-hidden="true"`. Meaningful charts, sparklines, status dots, token bars, and progress visuals need text equivalents through `aria-label`, `role="img"`, adjacent copy, or a screen-reader data table.

## Async States

- First-load and blocking loading states use `role="status"`, `aria-live="polite"`, and `aria-busy` on the affected region or initiating control.
- Empty, low-data, stale-data, success, pending, and background-refresh states stay polite. They should preserve existing content where possible instead of replacing the whole workbench during refresh.
- Errors that block the current task, failed saves, disconnected/reconnecting runtime transport, and unavailable browser containers use `role="alert"` or assertive live behavior. Avoid assertive announcements for routine polling, count changes, or non-blocking success messages.
- Live runtime feeds, overview telemetry, Git/CI panels, invocation feeds, attention queues, and Stats refresh states should announce status changes without replaying the entire page. Use `aria-atomic="true"` only when the whole message is needed for context.
- Controls that start async work must expose pending state through `aria-busy` or disabled/`aria-disabled` semantics while keeping the button's accessible name understandable.

## Responsive And Motion

- Narrow viewports must not gain page-level horizontal scroll. Rails, tables, logs, JSON previews, file paths, branch names, provider/model names, and preview controls must wrap or scroll inside their own bounded component.
- Long labels must use `min-w-0` with `break-words`, `break-all`, or bounded internal overflow. Avoid truncating operational values when operators need the exact provider, model, branch, path, workflow, or connection id.
- Warm Void surfaces should stay visually restrained: use neutral glass surfaces for structure, Signal Jade for primary focus/selection/accent, and Ember/status tones only for warnings, errors, danger, and destructive actions.
- Motion must use the shared motion tokens and reduced-motion hooks/classes. Reduced motion removes or snaps movement while preserving static state cues such as rings, halos, badges, progress values, highlighted active tabs, and visible chart summaries.
- Mobile and text-zoom checks must include shell selectors, Settings forms, Browser rails, Tasks cards, Stats tables, and live telemetry panels at narrow widths with long provider/model names.

## Verification

- Run `pnpm run test:dashboard` for repository-level dashboard regression coverage.
- Run source-adjacent component tests directly when changing files under `dashboard/src/v2/**/__tests__` that are not covered by `pnpm run test:dashboard`.
- Run `pnpm run build` after documentation or dashboard changes so server build, dashboard typecheck, and Vite packaging agree.
- When runnable, start `pnpm run dev` and verify the dashboard route still responds with `GET http://localhost:4444` or the logged fallback port.
- For accessibility regressions, prefer deterministic tests that assert roles, accessible names, labels, live-region urgency, `aria-busy`, `aria-sort`, mobile labels, focus restoration, and overflow-safe classes over broad snapshots.
