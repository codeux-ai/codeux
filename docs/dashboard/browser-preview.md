# Browser Preview

The browser preview provides an integrated environment for interacting with running sprint containers directly from the dashboard.

## Accessibility Expectations
- Interactive elements (session menus, sliders, actions) must be fully keyboard accessible.
- Iframes and embedded views must have descriptive titles indicating their purpose and target.
- Window controls, navigation controls, session removal, external open, rebuild, stop, and script save actions must use explicit accessible names instead of relying on `title` text or icon shape.
- Live regions should transparently report loading, starting, running, stopped, reconnecting/unavailable, stale-log, saving, launching, empty-session, and error states without overwhelming screen readers.
- The address form must keep a programmatic label, describe why it is disabled when the preview container is unavailable, and announce submitted navigation attempts while keeping focus in the address field.
- Session rails must keep horizontal overflow inside the rail, expose the active session state, and remain keyboard reachable at narrow widths.
- Hidden slider controls must become visible when they or their container receive keyboard focus.
- File-browser trees and change lists should expose tree/listbox semantics, selected file state, loading/error/empty regions, and wrapping long paths so keyboard users do not need pointer hover to inspect files or diffs.
