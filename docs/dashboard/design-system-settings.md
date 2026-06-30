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

3.  **High-Risk Actions**:
    *   Destructive actions in the Danger Zone (`Wipe Project`, `Wipe Database`) use the `danger` tone, yielding clear semantic `bg-status-red text-white` presentation. Panels themselves hint at danger via red-tinted borders and backgrounds.

4.  **Metadata and Hierarchy**:
    *   Metadata chips (`visible categories`, `unsaved edits`) and badges leverage standard tokens to maintain visual rhythm.
    *   Headers and contextual information (e.g., `SettingsHeader`) separate sections with thin borders (`--border-hairline`).

5.  **Modals**:
    *   Modals launched from settings (e.g., `TerminalLoginModal`, `TokenPricingModal`) adhere strictly to `design-system-feedback-overlays.md`: `bg-white dark:bg-void-800`, `rounded-2xl`, `shadow-[var(--elevation-floating)]`, and `border-[var(--border-hairline)]`.

## Implementation details

*   Always rely on semantic CSS variables from `globals.css` and `tokens.css` via `[var(--variable-name)]` for colors, backgrounds, borders, and shadows instead of hardcoding Tailwind utility colors and shadow values.
*   Preserve the responsive behaviors (`md:flex-row`, `xl:grid-cols-2`) already established in the dense form panels.
*   When deep cloning dashboard settings, never use `JSON.parse(JSON.stringify(...))`. Instead, use the typed clone helpers such as `cloneSystemSettings` and `cloneProjectSettings` provided in `settings-view-models.ts` to ensure type safety and mutation isolation.

6.  **Responsive Behavior**:
    *   Form fields, inputs, and components should expand to `w-full` on narrow mobile screens (e.g., removing static `min-w-[320px]` in favor of `min-w-0 w-full`).
    *   Dense layout grids (e.g., multi-column setting grids) must collapse to a single column stack on mobile (`grid-cols-1 sm:grid-cols-2` or similar) to prevent horizontal scrolling or squashed content. When defining responsive auto-fill grids in Tailwind, use `minmax(min(100%, <size>), 1fr)` (e.g., `minmax(min(100%, 320px), 1fr)`) instead of `minmax(<size>, 1fr)` to prevent layout overflow on screens narrower than the minimum size.
    *   Action areas within Modals should adjust their layout to safely stack buttons (`flex-col-reverse` with `w-full`) on viewports where horizontal space is constrained. The modal body content should have internal scrolling (`overflow-y-auto`) to keep the primary action buttons visible.
