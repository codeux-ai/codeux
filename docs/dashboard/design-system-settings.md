# Dashboard Design System: Settings Workspace

## Objective

This document defines the visual patterns and rules for the Settings workspace. The goal is to ensure the Settings page feels cohesive, grounded, and easy to scan, specifically focusing on system/project scope, search, category navigation, dense forms, and provider instances.

## Core Rules

1.  **Surfaces and Elevations**:
    *   Structural panels (`SettingsCategoryRail`, `SectionCard`, `Card`, `ProviderInstanceCard`) use `--surface-glass`, `--border-hairline`, and `--elevation-base`. They do not use arbitrary heavy shadows or un-themed borders.
    *   Form fields (`TextInput`, `TextAreaInput`, `NumberInput`) use `--fill-muted` and `--border-hairline`. Focus rings rely strictly on `--accent-focus-ring`.
    *   Rows (`Row` component) use `--surface-glass` and hover states use `--surface-glass-hover` alongside `--border-hairline`.

2.  **Buttons and Controls**:
    *   Primary actions (e.g., `Save Changes`) and explicit tonal buttons (e.g., `success`, `danger`) use `--elevation-raised` rather than arbitrary soft shadows.
    *   Segment controls (`System` / `Project`) utilize consistent heights (e.g., `h-8`) and precise `disabled` states (`opacity-50 pointer-events-none`). Active segments mimic the primary or signal accents.
    *   Mutually exclusive Settings choices use `radiogroup` / `radio` semantics (or explicit pressed-state semantics for non-radio tool controls) so assistive technology reports the current selection. Provider-instance controls should include the provider instance name or config id in accessible names when the same action appears more than once.
    *   Provider-instance cards announce local action results in-card through `ActionFeedbackRegion`. Enable/disable, auth-mode changes, dashboard login, and remove affordances distinguish local unsaved changes from persisted state; destructive remove actions require a target-named confirmation click before invoking the change and suppress duplicate activation while pending.
    *   Pill choices and toggles use `controlFeedback` for focus, hover, active, and selected cues. Arrow keys move between pill radio choices and update the selected value. Reduced motion snaps the selected rail and color changes while preserving the checked state and visible label.
    *   Quality Assurance trigger agent assignment uses checkbox-based multi-select groups with trigger-specific accessible names. Empty selection is a visible built-in QA fallback state and must not write placeholder preset ids.
    *   MCP custom server transport selection keeps radiogroup semantics. HTTP / SSE setup must expose the URL field and auth headers JSON editor with durable accessible names, keep the generated config preview in a labelled region, and state that saved changes apply on the next CLI run.

3.  **High-Risk Actions**:
    *   Destructive actions in the Danger Zone (`Wipe Project`, `Wipe Database`) use the `danger` tone, yielding clear semantic `bg-status-red text-white` presentation. Panels themselves hint at danger via red-tinted borders and backgrounds.

4.  **Metadata and Hierarchy**:
    *   Metadata chips (`visible categories`, `unsaved edits`) and badges leverage standard tokens to maintain visual rhythm.
    *   Headers and contextual information (e.g., `SettingsHeader`) separate sections with thin borders (`--border-hairline`).
    *   The Quality Assurance section belongs in `Settings > Sprint & Git`, directly below `Merge Gates & Autofix`, even though its persisted settings path remains `agents.qualityAssurance`. QA-labeled project agents remain prominent in the selector ordering, and disabled project selectors still communicate that built-in QA routing remains available.

5.  **Modals**:
    *   Modals launched from settings (e.g., `TerminalLoginModal`, `TokenPricingModal`) adhere strictly to `design-system-feedback-overlays.md`: `bg-white dark:bg-void-800`, `rounded-2xl`, `shadow-[var(--elevation-floating)]`, and `border-[var(--border-hairline)]`.

6.  **Smart Find**:
    *   Smart Find filters the Settings category rail rather than returning standalone result rows. Matching categories remain navigable with the same button-based category switching and `aria-current` semantics as manual category selection.
    *   The search index must cover category labels, descriptions, and operational terms for General, Appearance, AI Models, Sprint & Git, Browser Preview, Agents, Memory, Integrations, MCP, and Danger Zone.
    *   AI Models matches provider names from shared provider metadata, invocation routes, model routing terms, pricing/token terms, and thinking-mode labels. Provider names also match Integrations because provider credentials are configured there as named instances.
    *   Integrations matches provider credential terms, API keys, authentication, local auth-copy mounts, dashboard login, GitHub/GitLab/Jira style git-host connections, repository, pull request, issue, token language, and Jules-specific clarification/CI autofix controls.
    *   Sprint & Git matches routing terms for branch naming, default/feature branches, merge gates, CI/autofix, execution runtime, Docker cleanup, QA, and quality assurance.
    *   Browser Preview, Memory, Agents, and MCP must remain searchable through their user-facing terms: preview/container/port/proxy, memory/embedding/claims/remediation, prompt/template/instruction/markdown authoring, and MCP server/tool/stdio/http/SSE/built-in tool access.
    *   The Smart Find status text uses `role="status"` with `aria-live="polite"` and includes match previews so assistive technology users receive the same filtered-category context as sighted users.

## Implementation details

*   Always rely on semantic CSS variables from `globals.css` and `tokens.css` via `[var(--variable-name)]` for colors, backgrounds, borders, and shadows instead of hardcoding Tailwind utility colors and shadow values.
*   Inline validation and character-counter feedback must use the shared `inlineValidation` and `controlFeedback` interaction tokens. Error text should be announced only after blur or an explicit submit/force-validation path, and helper text should not remain in `aria-describedby` while an error is active.
*   Settings page save state lives at the active panel boundary. `SettingsContentPanels` sets `aria-busy` while loading, saving, or resetting; uses `ActionFeedbackRegion` for saved/dirty/saving/loading states; and keeps a durable visible active-panel/save-state line so reduced-motion users see the current category and outcome without relying on panel motion. Blocking errors switch the status stream to assertive alert copy. Do not replace field contents with loading placeholders during saves or background refreshes.
*   The Settings scope strip is sticky below the app shell and includes the System/Project radiogroup, selected-scope context, project-scope availability or inheritance summary, visible-category count, unsaved edits indicator, and saved badge. It must wrap naturally on narrow screens, preserve focus rings while pinned, and keep `settings-scope-context`, `settings-project-scope-disabled`, and the polite scope status region wired to the radiogroup.
*   The `SettingsContentPanels` active-panel/save-state strip is sticky beneath the scope strip. `SettingsPage` measures the wrapped scope strip height and passes the resulting offset into the panel strip so the two pinned surfaces do not overlap the app shell, each other, or the desktop `SettingsCategoryRail` at `lg:top-16`.
*   Save and background reload paths must preserve dirty drafts until the affected scope has actually saved or reset. If system settings save while project settings are dirty, project draft values remain mounted and are not replaced by an effective-settings refresh; failed project saves leave the draft visible for correction.
*   Category rail buttons expose selected and pending state through active styling plus ARIA (`aria-current`, `aria-selected`, `aria-busy`) without extra visible status badges. Disabled state keeps visible disabled copy plus `aria-disabled`. Category movement uses explicit `selectionMovement` markers; panel entry uses `enterExit`; reduced-motion users receive the same static active styling, validation copy, busy state, and save outcome text without relying on animated movement.
*   Scope switches announce the selected system/project context through a polite status region. Project scope must also expose visible inherited/overridden summary text while preserving the existing per-field badge semantics: inherited stays neutral, project overrides stay amber and resettable only when the active scope can clear them.
*   The Settings category rail uses a 280px desktop column, starts directly with category rows rather than a visible title/instruction block, caps its height to the remaining viewport below its measured top edge, and scrolls internally with the shared hidden-scrollbar utility. When more categories remain below, a subtle bottom chevron affordance appears over a soft fade and disappears at the scroll end, so long category lists remain discoverable without visible scrollbars or page-bottom overflow.
*   Smart Find keeps focus in the search field while typing and when the clear control is used. Result status remains polite and includes count/category context plus match previews; empty states include recovery terms instead of leaving the rail blank without explanation.
*   Disabled save controls must preserve their stable button label while exposing the unavailable reason through `title`, visible adjacent copy, and `aria-describedby`. Do not append hidden disabled-reason text to the button name. Save, reset, and modal actions suppress duplicate activation while pending and keep current drafts mounted.
*   Invalid save attempts must not discard or replace drafts. The first invalid enabled control is scrolled into view inside the active panel, receives focus with scroll position preserved, keeps its helper/error ownership (`aria-describedby` / `aria-errormessage`), and surfaces actionable page-level feedback until the user fixes or dismisses it.
*   Provider instance feedback is local to the card and uses `ActionFeedbackRegion` with polite status for unsaved local changes/pending work and alert semantics for errors. The dashboard-login action exposes `aria-haspopup="dialog"`, `aria-expanded`, and `aria-busy` while the modal is open. Remove remains a two-step local confirmation before mutating the instance list, names the provider instance in the confirmation control, disables duplicate confirm/cancel activation while pending, and restores focus to the initiating remove control or the active settings panel fallback.
*   Preserve the responsive behaviors (`md:flex-row`, `xl:grid-cols-2`) already established in the dense form panels.
*   When deep cloning dashboard settings, never use `JSON.parse(JSON.stringify(...))`. Instead, use the typed clone helpers such as `cloneSystemSettings` and `cloneProjectSettings` provided in `settings-view-models.ts` to ensure type safety and mutation isolation.

7.  **Responsive Behavior**:
    *   Form fields, inputs, and components should expand to `w-full` on narrow mobile screens (e.g., removing static `min-w-[320px]` in favor of `min-w-0 w-full`).
    *   Dense layout grids (e.g., multi-column setting grids) must collapse to a single column stack on mobile (`grid-cols-1 sm:grid-cols-2` or similar) to prevent horizontal scrolling or squashed content. When defining responsive auto-fill grids in Tailwind, use `minmax(min(100%, <size>), 1fr)` (e.g., `minmax(min(100%, 320px), 1fr)`) instead of `minmax(<size>, 1fr)` to prevent layout overflow on screens narrower than the minimum size.
    *   Generated JSON/config previews and long provider/model/auth values must wrap or scroll inside their own component boundary with `max-w-full` and internal overflow handling rather than forcing page-level horizontal overflow.
    *   Action areas within Modals should adjust their layout to safely stack buttons (`flex-col-reverse` with `w-full`) on viewports where horizontal space is constrained. The modal body content should have internal scrolling (`overflow-y-auto`) to keep the primary action buttons visible.

8. **Cloning Settings**: Never use `JSON.parse(JSON.stringify(...))` to deep clone settings. Instead, rely on the typed clone helpers (like `cloneSystemSettings` and `cloneProjectSettings`) provided in `settings-view-models.ts` to ensure type safety and mutation isolation.

## Interaction And Accessibility Contracts

*   Use `inlineValidation` for field-level validation, API-key/model/auth field errors, character-counter warnings, and explicit submit/force-validation paths.
*   Use `controlFeedback` for text inputs, number inputs, text areas, toggles, pill radio choices, reset buttons, provider-card controls, and save buttons.
*   Use `enterExit` for settings modals such as terminal login and pricing dialogs. These dialogs must trap focus, restore focus to the originating control with `preventScroll`, and keep dark-mode contrast strong enough for title, body, status, and action text.
*   Use `asyncFeedback` for save results, login status, terminal output status, and card-level async results. Loading and successful local progress are polite; failed saves, terminal errors, and blocking provider errors are assertive and persist until recovery or dismissal.
*   Avoid animation-only state communication. Required, invalid, dirty, saving, saved, inherited, overridden, disabled, and destructive-confirmation states need visible labels/helper copy plus ARIA state. Inherited badges must stay visually neutral and must not reuse override styling; overridden badges may use amber treatment and include reset affordances only when the current scope can actually clear an override.
*   Active panel saving/loading/resetting sets `aria-busy` at the panel boundary and keeps field values mounted. Background work uses `ActionFeedbackRegion` plus a screen-reader status/alert; do not replace populated panels with placeholder-only loading states.
*   Category rail selection uses `selectionMovement`, `aria-current`, `aria-selected`, `aria-busy`, active rail styling, and a polite search/result status. Do not add visible Selected or Pending badges to category rows. Disabled category switches must retain a stable label and expose the disabled reason through `title`, `aria-describedby`, and visible disabled copy.
*   Disabled form controls must not disappear. Place durable helper text next to the affected control, wire it through `aria-describedby`, and keep the label/value visible so users know what will become editable after recovery.
*   Settings path fields that support local browsing use the shared file-picker field: keep the manual text input editable for empty, relative, and absolute paths; expose Browse/Close as buttons with `aria-expanded` and `aria-controls`; provide parent, home, and typed/current-path refresh controls; render loading and empty states as visible text; and keep API failures in a persistent `role="alert"` without clearing the typed value.
*   Save controls and provider-card actions suppress duplicate activation while pending. Destructive provider or danger-zone actions require explicit confirmation and must restore focus to the initiating control or a stable panel fallback.

## Verification Notes

For documentation-only updates, run `pnpm run lint` and the dashboard docs discoverability search:

```bash
rg "interaction|reduced motion|aria-busy|asyncFeedback" docs/dashboard docs/index.md docs/SUMMARY.md
```

For Settings UI changes, focused coverage includes `dashboard/src/v2/components/settings/__tests__/SettingsControls.test.tsx`; run it directly with `pnpm exec vitest run <file>` when touching shared settings controls, then broaden to `pnpm run test:dashboard` for page-level behavior.
