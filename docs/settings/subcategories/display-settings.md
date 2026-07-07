# Display Settings

Controls the dashboard shell layout, experience mode, theme, motion preference, and desktop zoom when available.

## What It Controls

Experience mode stores one persisted Easy, Standard, or Expert dashboard preference and filters primary dock/sidebar navigation. Easy shows Chat, Browser, Stats, Settings/Config, and external Docs; Standard hides the specialized Schedule, Memory, Knowledge, Files, and Live pages; Expert shows the full primary navigation. Navigation mode switches dock/sidebar, theme sets color mode, reduced motion limits animation, and zoom scales Electron windows.

## Recommended Defaults

New installs default to Expert experience mode. Use System theme and Auto reduced motion unless you need a fixed accessibility preference.

## Risks And Gotchas

Experience mode only hides primary navigation links; the underlying dashboard routes remain available. Browser navigation still depends on sprint preview and in-app browser visibility settings. High zoom or dense sidebars can reduce visible workspace on small screens.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#display-settings`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Dashboard Accessibility Patterns](../../dashboard/dashboard-guide.md#accessibility-patterns)
- [Mobile Responsiveness](../../dashboard/mobile-responsiveness.md)
