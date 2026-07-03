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

3.  **High-Risk Actions**:
    *   Destructive actions in the Danger Zone (`Wipe Project`, `Wipe Database`) use the `danger` tone, yielding clear semantic `bg-status-red text-white` presentation. Panels themselves hint at danger via red-tinted borders and backgrounds.

4.  **Metadata and Hierarchy**:
    *   Metadata chips (`visible categories`, `unsaved edits`) and badges leverage standard tokens to maintain visual rhythm.
    *   Headers and contextual information (e.g., `SettingsHeader`) separate sections with thin borders (`--border-hairline`).
    *   The Quality Assurance section belongs in `Settings > Sprint & Git`, directly below `Merge Gates & Autofix`, even though its persisted settings path remains `agents.qualityAssurance`.

5.  **Modals**:
    *   Modals launched from settings (e.g., `TerminalLoginModal`, `TokenPricingModal`) adhere strictly to `design-system-feedback-overlays.md`: `bg-white dark:bg-void-800`, `rounded-2xl`, `shadow-[var(--elevation-floating)]`, and `border-[var(--border-hairline)]`.

6.  **Smart Find**:
    *   Smart Find filters the Settings category rail rather than returning standalone result rows. Matching categories remain navigable with the same button-based category switching and `aria-current` semantics as manual category selection.
    *   The search index must cover category labels, descriptions, and operational terms for General, Appearance, AI Models, Sprint & Git, Browser Preview, Agents, Memory, Integrations, MCP, and Danger Zone.
    *   AI Models matches provider names from shared provider metadata, invocation routes, model routing terms, pricing/token terms, and thinking-mode labels. Provider names also match Integrations because provider credentials are configured there as named instances.
    *   Integrations matches provider credential terms, API keys, authentication, local auth-copy mounts, dashboard login, GitHub/GitLab/Jira style git-host connections, repository, pull request, issue, and token language.
    *   Sprint & Git matches routing terms for branch naming, default/feature branches, merge gates, CI/autofix, execution runtime, Docker cleanup, QA, and quality assurance.
    *   Browser Preview, Memory, Agents, and MCP must remain searchable through their user-facing terms: preview/container/port/proxy, memory/embedding/claims/remediation, prompt/template/instruction/markdown authoring, and MCP server/tool/stdio/http/SSE/built-in tool access.
    *   The Smart Find status text uses `role="status"` with `aria-live="polite"` and includes match previews so assistive technology users receive the same filtered-category context as sighted users.

## Implementation details

*   Always rely on semantic CSS variables from `globals.css` and `tokens.css` via `[var(--variable-name)]` for colors, backgrounds, borders, and shadows instead of hardcoding Tailwind utility colors and shadow values.
*   Preserve the responsive behaviors (`md:flex-row`, `xl:grid-cols-2`) already established in the dense form panels.
*   When deep cloning dashboard settings, never use `JSON.parse(JSON.stringify(...))`. Instead, use the typed clone helpers such as `cloneSystemSettings` and `cloneProjectSettings` provided in `settings-view-models.ts` to ensure type safety and mutation isolation.

7.  **Responsive Behavior**:
    *   Form fields, inputs, and components should expand to `w-full` on narrow mobile screens (e.g., removing static `min-w-[320px]` in favor of `min-w-0 w-full`).
    *   Dense layout grids (e.g., multi-column setting grids) must collapse to a single column stack on mobile (`grid-cols-1 sm:grid-cols-2` or similar) to prevent horizontal scrolling or squashed content. When defining responsive auto-fill grids in Tailwind, use `minmax(min(100%, <size>), 1fr)` (e.g., `minmax(min(100%, 320px), 1fr)`) instead of `minmax(<size>, 1fr)` to prevent layout overflow on screens narrower than the minimum size.
    *   Generated JSON/config previews and long provider/model/auth values must wrap or scroll inside their own component boundary with `max-w-full` and internal overflow handling rather than forcing page-level horizontal overflow.
    *   Action areas within Modals should adjust their layout to safely stack buttons (`flex-col-reverse` with `w-full`) on viewports where horizontal space is constrained. The modal body content should have internal scrolling (`overflow-y-auto`) to keep the primary action buttons visible.

8. **Cloning Settings**: Never use `JSON.parse(JSON.stringify(...))` to deep clone settings. Instead, rely on the typed clone helpers (like `cloneSystemSettings` and `cloneProjectSettings`) provided in `settings-view-models.ts` to ensure type safety and mutation isolation.
