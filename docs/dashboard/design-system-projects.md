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
- The gallery is a named `Project cards` region. Initial loading sets `aria-busy`, renders skeleton cards, and announces `Loading projects` through a polite status region.
- A load failure uses an assertive alert with the returned error and an **Add Project** action. A collection with no projects and a filter with no matches use polite status surfaces; the no-match state also provides **Show all projects**.
- Each project is a named article. Its primary selection surface and footer selection button are native buttons with stable `aria-pressed` state. The selected badge is a named status, task completion is a labelled progress bar, and status dots expose readable status text.
- Every interactive control has a visible focus ring. Setup, settings, and delete buttons stop event propagation so keyboard or pointer activation cannot also select the card.
- The shared Add Project modal traps focus, initially focuses the project name, restores focus when closed, labels required fields, and exposes source/setup choices as keyboard-focusable controls. Invalid submit announces one summary, marks affected fields, moves focus to the first invalid field, and scrolls the modal body to it.
- Directory browsing politely announces loading, the current path, empty folders, and selection; failures use an alert. Pending submission marks the submit action busy, disables close/cancel/submit with a reason, and leaves retryable errors in the modal.

## Responsive and reduced motion behavior

- The page header stacks its heading and action cluster below the `lg` breakpoint. Count pills, filters, card actions, source/init selectors, and setup choices wrap rather than widening the viewport.
- Filter buttons share the available mobile width and return to content width at `sm`. Form rows and dialog footers stack on narrow screens; the setup dialog is capped to the viewport with an internally scrolling body.
- Project names and all metadata columns retain `min-w-0`; the grid formula allows a card to shrink to the viewport before the nominal 320px minimum. These boundaries are required to prevent horizontal overflow.
- Optional hover colors, progress-width animation, and busy rotation are guarded by motion-safe utilities. The Add Project modal resolves its entry, exit, and conditional-field transitions to zero duration under reduced motion, and directory loading suppresses rotation while retaining live status copy. Static borders, labels, busy state, and focus cues remain available without animation.

## Preserved workflows

- **Add Project** opens the shared modal in local-import mode, from which users can choose Local Project, Git URL, or New Project. **New Project** opens the same modal with New Project selected; it sends the existing `new-local` or `new-remote` initialization contract and does not scaffold application source in the dashboard.
- Selecting either card selection control persists the active project. **Project settings** first selects that project and then routes to `/config`.
- **Delete project** invokes the existing dashboard deletion request and refreshes the collection; it does not introduce a new deletion API or initialization contract. MCP deletion remains approval-gated.
- **Setup project** opens the existing setup-scope dialog for agents, quicksprints, preview script, CI, techstack detection, and opt-in docs embedding. Starting setup uses the existing background setup endpoint, reports progress through toasts and the card, polls the matching invocation, and exposes **Open invocation** as soon as its ID is available and again in completion feedback.
