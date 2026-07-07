# Display Settings

Controls the dashboard shell layout, experience mode, theme, motion preference, and desktop zoom when available.

## What It Controls

Experience mode stores one persisted Easy, Standard, or Expert dashboard preference. Easy shows only user-essential Settings categories such as General, Appearance, Integrations, and Danger Zone, and it keeps primary dock/sidebar navigation small by showing Chat, Browser, Stats, Settings/Config, and Docs. Standard keeps common project and productivity settings but hides specialist controls such as MCP, model pricing, guardrails, Docker/runtime internals, database maintenance, worker concurrency limits, and specialized navigation like Memory, Knowledge, Files, Schedule, and Live. Expert shows the full settings surface and primary navigation. Hidden controls are not deleted or reset; their saved values remain in the settings payload and return when Expert mode is selected.

Navigation mode switches dock/sidebar, theme sets color mode, reduced motion limits animation, and zoom scales Electron windows.

## Recommended Defaults

New installs default to Expert experience mode. Use Easy for day-to-day operation, Standard for routine project administration, and Expert when editing low-level runtime, MCP, pricing, guardrail, or worker controls. Use System theme and Auto reduced motion unless you need a fixed accessibility preference.

## Risks And Gotchas

Switching out of Expert mode only hides advanced controls and primary navigation links from the current UI; it does not change provider routing, backend settings resolution, or saved hidden values. Browser navigation still depends on sprint preview and in-app browser visibility settings. High zoom or dense sidebars can reduce visible workspace on small screens.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/settings-subcategories-display-settings`. The Settings card header links directly to this published subpage.

## Related Docs

- [Dashboard Accessibility Patterns](../../dashboard/dashboard-guide.md#accessibility-patterns)
- [Mobile Responsiveness](../../dashboard/mobile-responsiveness.md)
