# Code UX Projects Design System

This document records the implemented low-noise gallery, responsive layout, and accessible state model for the Projects page and its project-creation and setup surfaces.

## Gallery hierarchy

- The page header establishes repository-management context, shows total and optional running counts, and keeps **New Project** visible as the initialization entry point.
- Status filters sit below the header as a wrapping tablist with live `All`, `Running`, `Idle`, and `Failed` counts. Projects that need intervention contribute to `All` but not to the other three filters.
- The project card grid uses `repeat(auto-fill,minmax(min(100%,320px),1fr))`. Every grid boundary is `min-w-0`, and the page clips residual x-axis decoration so narrow screens and long metadata cannot create horizontal overflow.
- Each card reads from top to bottom as name and source type; semantic status and source badge; one repository-or-path row, branch, and last-run detail; optional setup invocation state; sprint/open/done statistics and completion; then the action footer.
- The dashed **Add Project** card uses the same minimum height and spacing as project cards. It remains in populated, collection-empty, and no-match grids; the blocking load-error surface exposes its own **Add Project** action.

## Restrained surfaces and color

- Project and empty-state surfaces use quiet translucent fills, hairline borders, a small shadow, and one restrained page-level radial wash. The gallery does not use card watermarks, organic shapes, persistent waves, or per-card ambient glows.
- Signal color is reserved for selection, primary creation, progress, focus, and enabled setup choices. Selection is communicated by a signal border/ring, a visible `Selected` badge, and `aria-pressed`, not by color alone.
- Running uses semantic green text, dot, and border; failed and destructive actions use semantic red; intervention uses ember with the text `Needs review`; idle remains neutral slate. Source badges are neutral metadata rather than competing accents.
- Card actions are always visible. The wide text control selects the project, followed by explicit icon buttons with accessible names and titles for setup, project settings, and deletion. Running setup disables the setup action and replaces its icon with a busy indicator.

## Long content and stable density

- Project names, source descriptions, repository URLs or local paths, branch names, last-run status, and source badges are single-line truncated inside `min-w-0` containers. Full project names and non-empty detail values remain available through `title` text.
- A card shows one normalized location row: repository URL when available, otherwise the local path. It does not render repository, path, provider, and host rows simultaneously.
- Missing values use explicit copy such as `Not set` or `No runs yet`; completion uses `--` when there are no tasks. Statistics and the action footer stay at the bottom so cards align without allowing long content to change the gallery rhythm.
- Load errors use wrapping text instead of truncation so the failure remains readable.

## Accessible state model

- The filter container is a named tablist. Each filter is a native button with `role="tab"`, `aria-selected`, and `aria-controls="project-card-region"`; standard Tab navigation plus Enter or Space activation works without pointer input.
- The gallery is a named `Project cards` region containing a semantic project list. Filter changes announce the localized result count without replacing the list, and active-project changes are announced independently from the visible selected badge. Initial loading sets `aria-busy`, renders skeleton cards, and announces `Loading projects` through a polite status region.
- A load failure uses an assertive alert with the returned error and an **Add Project** action. A collection with no projects and a filter with no matches use polite status surfaces; the no-match state also provides **Show all projects**.
- Each project is a named article. Its primary selection surface and footer selection button are native buttons with stable `aria-pressed` state. The selected badge is a named status, task completion is a labelled progress bar, and status dots expose readable status text.
- Every interactive control has a visible focus ring. Setup, settings, and delete buttons stop event propagation so keyboard or pointer activation cannot also select the card.
- Setup uses the shared `Modal` focus lifecycle: its first scope choice receives initial focus, Tab stays inside, Escape/cancel/backdrop close it, and focus returns to the setup trigger. Closing it stops only client polling; it does not cancel accepted background work, and the card retains the invocation link.
- Delete uses `useConfirmDialog` and the shared `ConfirmDialog`. The dialog traps focus, supports Escape/cancel/backdrop dismissal, restores the originating delete trigger on cancel or failure, exposes pending state while the request settles, and suppresses duplicate confirmation. After success, focus moves to the next visible project, the previous project, or **Add Project** when no project remains.
- Setup and deletion failures remain on their project cards with **Retry**. Setup completion and deletion success remain visible and announced without replacing the gallery; setup feedback retains **Open invocation** whenever an invocation ID is known.
- The shared Add Project modal traps focus, initially focuses the project name, restores focus when closed, labels required fields, and exposes source/setup choices as keyboard-focusable controls. Invalid submit announces one summary, marks affected fields, moves focus to the first invalid field, and scrolls the modal body to it.
- Directory browsing politely announces loading, the current path, empty folders, and selection; failures use an alert. Pending submission marks the submit action busy, disables close/cancel/submit with a reason, and leaves retryable errors in the modal.

## Responsive and reduced motion behavior

- The page header stacks its heading and action cluster below the `lg` breakpoint. Count pills, filters, card actions, source/init selectors, and setup choices wrap rather than widening the viewport.
- Filter buttons share the available mobile width and return to content width at `sm`. Form rows and dialog footers stack on narrow screens; the setup dialog is capped to the viewport with an internally scrolling body.
- Project names and all metadata columns retain `min-w-0`; the grid formula allows a card to shrink to the viewport before the nominal 320px minimum. These boundaries are required to prevent horizontal overflow.
- Optional hover colors, progress-width animation, card movement, and busy rotation are guarded by motion-safe utilities. The Add Project and setup modals resolve entry and exit transitions to zero duration under reduced motion, and directory loading suppresses rotation while retaining live status copy. Static selected borders, pending labels, success/error panels, removal announcements, and focus cues remain available without animation.

## Preserved workflows

- English and German use the same stable source types, initialization modes, setup option keys, settings overrides, and API payloads. Only dashboard-authored labels and announcements change; names, paths, repository identifiers, branches, providers, application-kind contract values, and runtime diagnostics remain verbatim.
- Project timestamps, counts, and percentages use the active locale. The feature-owned project catalog is also consumed by the shared Add Project and New Project modals, so callers on other routes inherit the active language without caller changes.

- **Add Project** opens the shared modal in local-import mode, from which users can choose Local Project, Git URL, or New Project. **New Project** opens the same modal with New Project selected; it sends the existing `new-local` or `new-remote` initialization contract and does not scaffold application source in the dashboard.
- Selecting either card selection control persists the active project. **Project settings** first selects that project and then routes to `/config`.
- **Delete project** first opens the localized confirmation dialog, then invokes the existing dashboard deletion request and refreshes the collection; it does not introduce a new deletion API or initialization contract. MCP deletion remains approval-gated.
- **Setup project** opens the existing setup-scope dialog for agents, quicksprints, preview script, CI, techstack detection, and opt-in docs embedding. Setup launch and polling are keyed per project, so duplicate launches are suppressed and late responses cannot update another project. Timers are cleared on close, project removal, and unmount. The existing background endpoint and payload remain unchanged, and **Open invocation** remains available as soon as the accepted invocation ID is known.
