# Dashboard Design System: Shared Primitives

## Objective

This document defines the semantic CSS variables and design rules for shared primitive components (Buttons, Cards, Inputs, Selects, Tables, EmptyStates, etc.) in the Code UX dashboard.

The goal is to ensure all primitives align with the signal-and-ember operational design language by sharing a consistent vocabulary for surfaces, borders, focus rings, metadata typography, and elevation levels.

## Semantic Tokens

### Surfaces & Fills

*   **`--surface-glass`**: The base background for structural primitives (e.g., Cards, Sections). Should support light and dark modes with subtle transparency.
*   **`--surface-glass-hover`**: The hover state for glass surfaces.
*   **`--fill-muted`**: A subtle fill for secondary elements (e.g., Table rows on hover, Input backgrounds).
*   **`--fill-muted-hover`**: The hover state for muted fills.

### Borders & Rings

*   **`--border-hairline`**: A very subtle border used for structure (Cards, Table cells, Inputs).
*   **`--accent-focus-ring`**: The primary focus ring color for interactive elements, typically tied to the brand's primary accent.

### Typography

*   **`--text-metadata`**: A compact, low-contrast text style (e.g., `text-xs font-medium text-slate-500`) used for secondary information like Table headers and EmptyState descriptions.

### Elevation

*   **`--elevation-base`**: Standard subtle shadow for flat cards or structural elements.
*   **`--elevation-raised`**: Slightly raised shadow for interactive elements like primary buttons.
*   **`--elevation-floating`**: Higher shadow for overlays, dropdowns, and dialogs.

## Component Guidelines

1.  **Buttons**: Should utilize `--elevation-raised` (for primary), `--accent-focus-ring`, and consistent proportional padding across all variants. For responsive buttons containing dynamic text (e.g., pending states), avoid `whitespace-nowrap` as it causes horizontal overflow on mobile screens. Instead, apply `min-w-0` to the button, wrap the text in a `span` with `truncate min-w-0`, and add `shrink-0` to any adjacent icons. When implementing custom single-choice button groups, use standard ARIA radiogroup semantics by applying `role="radiogroup"` to the wrapper and `role="radio"` with `aria-checked` to the individual choice options.
    Button pending, success, and error overlays use `controlFeedback` and fixed feedback slots so the accessible name and hit target do not change while icons or spinners appear. Pending buttons keep their original label in the DOM, expose `aria-busy="true"`, suppress activation for native `disabled`, `aria-disabled`, and pending states, and only pin inline width after a real measurement is available. Icon-only buttons keep fixed square dimensions. Controls that launch async work set native `disabled` or `aria-disabled`, expose `aria-busy` where the control itself is pending, and provide a nearby status message for disabled recovery. Native-disabled controls must stay inert; `aria-disabled` on shared controls is normalized to suppress activation and should be paired with `title`, `aria-describedby`, or visible helper text when the operator needs a recovery reason.
2.  **Cards**: Built on `--surface-glass`, bordered by `--border-hairline`, and grounded by `--elevation-base`. They should not be nested unless the inner element is explicitly a card.
3.  **Inputs & Selects**: Inputs use `--fill-muted` and `--border-hairline`. Focus states should strictly use `--accent-focus-ring`. Error and valid states override the border but maintain the structural radius and use tokenized `controlFeedback` timing. Shared inputs reveal `errorText` after blur/focusout, explicit `forceValidation`, or a caller-provided invalid ARIA state, and route visible error copy through `inlineValidation`; helper text remains available until the error is active, then the active error owns both `aria-describedby` and `aria-errormessage`. Selects follow the same helper/error ownership and suppress changes while native-disabled or `aria-disabled`. Shared select triggers expose stable `aria-expanded`, `aria-controls`, selected state, and disabled state while their overlays animate independently with `enterExit`.
4.  **Tables**: Headers should use `--text-metadata`. Hover states for rows apply `--fill-muted-hover`. Borders between cells use `--border-hairline`. When using the custom `Table` primitive, provide the `mobileLabel` prop on `TableCell` elements to ensure visible column labels are communicated to assistive technology on mobile layouts. In sortable data tables, the parent `<th>` element must declare the `aria-sort` attribute ('ascending', 'descending', or 'none'). The internal sort `<button>` should include an explicit `aria-label` or visually hidden `.sr-only` text.
5.  **EmptyStates & SectionHeaders**: Leverage `--text-metadata` to ensure textual consistency. Icons use `--surface-glass` for subtle emphasis without drawing primary attention away from calls to action. When displaying dynamic filter or table result counts (e.g., 'Showing 10 of 50'), apply `aria-live="polite"` directly to the text container so screen readers natively announce updates.

### Data Interaction Primitives

Shared data controls are responsible for keeping table, list, card, rail, and graph interactions understandable without page-specific reinvention:

1. **Sort, Filter, Search, And Selection**: Sortable headers declare `aria-sort`; committed filters and searches announce result counts politely; selection controls announce the selected count and scope. Bulk select must operate on the currently visible or filtered set, not hidden records, unless the UI explicitly offers a broader scope.
2. **Stale Data Preservation**: Tables, ledgers, live feeds, memory lists, preview logs, and search result lists should keep the last useful content mounted during background refresh, reconnect, stale, or retryable load-error states when cached content exists. Add `aria-busy` to the affected region, provide visible stale/refreshing/error copy, and keep valid controls usable.
3. **Empty States**: Empty results from a committed query or filter are real empty states. Show the current filter/search context, keep recovery controls reachable, and do not display unrelated stale rows as if they matched.
4. **Disabled Reasons**: Disabled row, card, link, and menu actions need persistent reason text through visible copy, `aria-describedby`, `title`, or a nearby status badge. This is required for native disabled controls and for focusable `aria-disabled` controls.
5. **Announcements**: Data views should announce meaningful operator-level outcomes: sort direction, result counts, selected counts, bulk operation status, active option movement, refresh/stale state, and blocking errors. Avoid announcing every animation frame, hover change, or routine polling tick.

### Shared Accessibility Contracts

1.  **Landmarks & Regions**: Shared layout primitives must allow callers to provide accessible names through visible headings, `aria-label`, or `aria-labelledby`. Route pages should render inside the shell's single `main` landmark and use `PageContainer` or an equivalent named workbench region; repeated cards, rails, charts, and feeds should be named only when the name helps navigation.
2.  **Icon Buttons**: Any button whose visible content is only an icon, counter, avatar, status dot, or compact mobile glyph must receive an explicit accessible name. This applies to `Button`, `DropdownMenu` triggers, `ConfirmDialog` actions, Browser chrome controls, task actions, command actions, preview controls, and settings/catalog controls.
3.  **Repeated Actions**: When the same action appears in a list, include the target in the accessible name or description. Provider tiles and `ProviderInstanceCard` actions should name the provider instance or config id; task actions should name the task; preview actions should name the selected session/sprint when available; telemetry rows should expose the item label and state.
4.  **Async Feedback**: `ActionFeedbackRegion` is the reference primitive for action outcomes. Pending, warning, empty, and background-refresh states are polite; errors that block the workflow are assertive; success states remain visible but use `aria-live="off"` after the pending transition. Initiating controls should set `aria-busy` or disabled/`aria-disabled` while the operation is pending. Use `asyncFeedback` for the visible result reveal/progress and `controlFeedback` for in-place message or icon swaps.
5.  **Status & Progress**: Status dots, token bars, sparklines, progress bars, and animated state visuals need a text equivalent through `aria-label`, `role="img"`, adjacent visible copy, or screen-reader-only text. Decorative icons must be `aria-hidden="true"`.
6.  **Tables & Mobile Data**: The `Table` primitive must retain rowgroup, row, columnheader, and cell semantics even when mobile styles render rows as cards. Captions describe the dataset, not the visual layout. `mobileLabel` text should match the column meaning and remain available in stacked mobile rows.
7.  **Focus Restoration**: Shared overlays, menus, popovers, dialogs, confirmation flows, and feedback controls that can remove themselves must restore focus to the trigger when it remains usable. If the trigger is gone, hidden, disabled, or inert, move focus to a caller-provided fallback, a named route region, `[data-focus-fallback]`, `[role="main"]`, or `body`.

### Field Accessibility & Error Contracts

1.  **FieldWrapper**: Always associates labels with the first control. It dynamically passes down `id`, `aria-describedby`, `aria-errormessage`, `aria-invalid`, and `aria-required` to its children.
2.  **Helper Text & Errors**: Helper text uses `aria-describedby`. When an error becomes visible, the error ID is provided in both `aria-errormessage` and `aria-describedby` (replacing the helper text ID in `aria-describedby` to avoid redundant announcements).
3.  **FormError**: Visible errors render with `role="alert"` for assertive live-region announcements.
4.  **Inputs & Selects**: Component primitives like `Input`, `Select`, and `AvantgardeSelect` gracefully fall back to these external `aria-*` props from `FieldWrapper` to avoid duplicate ID generation or conflicting descriptions.
5.  **Required State**: Conveys required state both visually (with a red asterisk) and programmatically via `aria-required="true"` and an `sr-only` "(Required)" span.
6.  **Settings Toggles & Choices**: Settings scope switches and pill choices use `radiogroup`/`radio` for one-of-many choices, and switches/toggles expose the current checked state plus any inherited/overridden context in nearby text. Invalid submissions focus the first invalid field and scroll it within the modal or panel body rather than shifting the whole page.
7.  **Toggles**: Toggles are fixed-size `role="switch"` buttons using `controlFeedback` for background, border, thumb, and pressed-state response. Native `disabled` and `aria-disabled` toggles remain visually disabled and inert; `aria-disabled` toggles preserve their accessible name, checked state, focusability, and caller-provided descriptions such as `aria-describedby`.
8.  **Destructive Confirmations**: Destructive primitive flows should use `useConfirmDialog` with `ConfirmDialog` when confirmation is required. Confirmations need a stable accessible name, destructive target copy, explicit cancel/confirm controls, focus trapping, Escape support, pending state, and focus restoration. Hold-to-confirm variants must expose progress with visible percent text and progress semantics, not motion alone.

### Motion Contracts For Primitives

- Use `controlFeedback` for buttons, icon buttons, toggles, input focus/valid state, select triggers, local feedback icon swaps, and confirmation action controls.
- Use `enterExit` for dropdowns, popovers, dialogs, confirmation overlays, and feedback containers entering or leaving the page.
- Use `inlineValidation` for field errors, invalid submit recovery, and destructive-hold cancellation nudges.
- Use `asyncFeedback` for `ActionFeedbackRegion`, toast entrance, operation progress bars, and long-running status result surfaces.
- Use `listReveal` when a primitive reveals a batch of menu or list items, and `listReorder` when visible items shift after sorting, filtering, removal, or toast stack compaction.
- Reduced-motion behavior must snap these states to their final positions and preserve static cues such as visible labels, badges, status colors, outlines, `aria-busy`, and live-region text.
- Primitive controls must keep the same semantic and static visual cues in reduced motion: buttons retain labels, busy state, and icon/spinner slots; inputs and selects retain helper/error text and outlines; toggles retain checked icons, focus rings, and `aria-checked`.
- Dropdown and confirm-dialog keyboard paths must skip disabled or `aria-disabled` menu items, preserve focus restoration to the trigger or page fallback, and expose destructive hold progress through visible percent text plus progress semantics instead of relying on motion alone.
- Shared async primitives must reserve stable icon/spinner slots and avoid changing the control's accessible name during pending, success, or error feedback. If a disabled control needs explanation, expose the reason through helper text, `aria-describedby`, `title`, or nearby status copy.
- Source-level guardrails should catch hardcoded timing on refined primitives. New primitive motion should use `useInteractionTokens`, `useGsapInteractionTokens`, `INTERACTION_CSS_VARIABLES`, or `buildInteractionTransition`, not fixed `duration-*` utilities.

## Verification Guidance

For documentation-only primitive changes, run:

```bash
pnpm run typecheck:dashboard
rg "Data Interaction Primitives|Focus Restoration|Destructive Confirmations" docs/dashboard/design-system-shared-primitives.md docs/index.md docs/SUMMARY.md
```

For primitive UI changes, run source-adjacent component tests for the changed primitive plus the dashboard suite:

```bash
pnpm exec vitest run dashboard/src/v2/components/ui/__tests__ dashboard/src/v2/components/forms/__tests__
pnpm run test:dashboard
pnpm run typecheck:dashboard
```

For route-level verification, see the [Dashboard Accessibility Quality Audit](./accessibility-quality-audit.md).
