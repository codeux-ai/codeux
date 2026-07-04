# Browser Preview

The browser preview provides an integrated environment for interacting with running sprint containers directly from the dashboard.

## Runtime Surface
- The Browser route is organized as a runtime workbench: a horizontal session rail, a framed in-app browser surface, and a right-side control stack for launching, session actions, startup script editing, runtime notes, and logs.
- The launch panel starts an isolated container for the selected sprint. The session rail selects among active sprint preview sessions and exposes remove and external-open actions without changing preview session APIs.
- The chrome owns browser-like window state only: normal, minimized, closed, and fullscreen. Closing or minimizing the window does not stop the underlying preview container.
- The address bar remains path-based and continues to use the existing preview origin, safe URL handling, iframe navigation bridge, and live navigation announcements.

## Runtime States
- **No preview:** the iframe area shows an inactive browser shell and a no-preview empty state while the launch controls remain available.
- **Starting:** the selected session stays visible, navigation controls are disabled with descriptions that explain a running container is required, and the preview area shows a starting overlay.
- **Running:** navigation, reload, address entry, and external open controls are enabled when a routed host port is available.
- **Stopped:** the selected session remains visible with disabled navigation and a waiting-for-connection overlay so logs, startup script details, and session actions stay discoverable.
- **Error:** the failed state is shown in the preview frame and any available error text remains visible in a bounded, scrollable area.

## Content Overflow
- Sprint names, script paths, port mappings, log lines, and error messages can be long. Browser Preview components should wrap or scroll these values inside their panel boundaries rather than truncating critical runtime data behind controls.
- Container logs remain visible as a dedicated scrollable monospace well. Manual refresh uses the same logs endpoint as the existing automatic refresh flow and does not replace polling.

## Accessibility Expectations
- Interactive elements (session menus, sliders, actions) must be fully keyboard accessible.
- Iframes and embedded views must have descriptive titles indicating their purpose and target.
- Live regions should transparently report state changes (starting, stopping, rebuilding, error) without overwhelming screen readers.
- Disruptive actions (rebuild, stop) should have clear labels.
- Hidden slider controls must become visible when they or their container receive keyboard focus.
- Disabled address navigation and address entry must retain descriptive titles, `aria-disabled`, and busy state while a selected container is starting.
