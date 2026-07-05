# Browser Preview

The browser preview provides an integrated environment for interacting with running sprint containers directly from the dashboard.

## Defaults

- Fresh system and project settings enable the preview runtime and show the in-app browser workspace by default.
- Existing persisted system, project, or sprint overrides remain authoritative. Sanitization only fills missing preview fields from the current defaults, so an explicit disabled preview stays disabled.
- `autoStartOnRunningSprint` remains false by default. Operators still choose whether sprint runs should launch preview containers automatically; the default only makes preview controls and the embedded browser available.

## Interaction Contracts

- Preview refresh, launch, rebuild, stop, remove, navigation, and startup-script save operations use visible async feedback plus local status text. Page-level operation results use `ActionFeedbackRegion` where available; control-specific progress stays beside the control that is pending.
- Use `controlFeedback` for preview chrome buttons, session rail controls, launch controls, rebuild/stop/open actions, script save, and address navigation controls.
- Use `enterExit` for preview window empty/starting/error states, menus, and browser chrome state surfaces.
- Use `selectionMovement` for active session cards and rail selection changes.
- Use `listReveal` for session menu contents and empty/loading menu states as they appear.
- Use `listReorder` when session cards shift after removal or filtering.
- Use `asyncFeedback` for launch/rebuild/stop/script-save/log-refresh feedback and `ActionFeedbackRegion` progress/result surfaces.
- Under reduced motion, spinners and rail movement must snap or stop while status badges, button labels, `aria-busy`, visible disabled reasons, and log status copy remain visible.

## Accessibility Expectations
- Interactive elements (session menus, sliders, actions) must be fully keyboard accessible.
- Iframes and embedded views must have descriptive titles indicating their purpose and target.
- Window controls, navigation controls, session removal, external open, rebuild, stop, and script save actions must use explicit accessible names instead of relying on `title` text or icon shape.
- Live regions should transparently report loading, starting, running, stopped, reconnecting/unavailable, stale-log, saving, launching, empty-session, and error states without overwhelming screen readers.
- The address form must keep a programmatic label, describe why it is disabled when the preview container is unavailable, and announce submitted navigation attempts while keeping focus in the address field.
- Session rails must keep horizontal overflow inside the rail, expose the active session state, and remain keyboard reachable at narrow widths.
- Hidden slider controls must become visible when they or their container receive keyboard focus.
- Unavailable preview links remain visible and keyboard reachable as disabled link controls. They must not navigate, must keep the safe URL path absent, and must expose a persistent reason through visible copy plus `aria-describedby`.
- Session removal actions keep the card mounted while removal is pending, set `aria-busy` on the card and remove button, suppress duplicate removal, and describe the pending reason from the disabled control.
- The active sessions menu opens predictably from hover, click, focus, `Enter`, `Space`, `ArrowDown`, and `ArrowUp`; supports `ArrowUp`/`ArrowDown`/`Home`/`End` within enabled menu items; and restores focus to the trigger after `Escape` or outside-click close.
- File-browser trees and change lists should expose tree/listbox semantics, selected file state, loading/error/empty regions, and wrapping long paths so keyboard users do not need pointer hover to inspect files or diffs.
- Rebuild and stop track distinct pending actions. The active operation owns the button label, `aria-busy`, and status text; sibling controls are disabled with visible recovery text instead of relying on click-time announcements.
- Launch controls set `aria-busy` on both the launch region and launch button while a container is starting. The selected session iframe remains mounted during refresh/starting states when a previous frame exists; do not replace stale preview content with a blank loading placeholder unless no frame exists.
- Launch pending state keeps the selected sprint value visible, explains the disabled select and launch controls through status text and control titles, and prevents duplicate launch submission until the start request settles.
- Startup-script saving sets `aria-busy` on the save button and textarea and pauses editing until the save completes. Script save status is a polite live region connected through `aria-describedby`.
- Container logs keep stale log text mounted during refresh, set `aria-busy` on the log region, and show a visible Ready/Refreshing/Error badge plus polite live-region copy.
- File-browser launch, rebuild, and stop follow the same async contract as browser preview: the affected region or button sets `aria-busy`, the visible label names the pending operation, duplicate activation is suppressed, and disabled sibling controls describe whether launch, rebuild, or stop is blocking recovery.
- File tree rows and changed-file rows keep keyboard tree/listbox semantics while selection loads. The selected row sets `aria-busy`, shows a non-animation-only Loading badge, and keeps focusable row activation available for normal selection behavior.
- File and diff viewers keep cached editor content mounted during background refresh. The viewer region sets `aria-busy`, the retained content is visually marked with a stale/refresh ring and visible status copy, and empty states are reserved for committed empty selections where no cached file or diff exists.
- Changed-file refreshes keep the cached list mounted when available. Refresh and error banners must say whether the list is current, refreshing, or a cached fallback, and unavailable diffs keep their backend-provided reason visible.
- Navigation pending state is a short client-side command guard. Back, forward, reload, and address submit controls announce that the navigation command is being sent; the iframe bridge does not acknowledge command completion.
- Multi-port preview sessions render as one persisted browser session with an accessible port tablist in the browser chrome. The first container-to-host port mapping is the primary tab, tabs support pointer and arrow-key selection, and secondary tabs route through the existing selected-port proxy query while preserving a separate current path per selected port.
- The Live Preview button uses the same mapping model outside the full browser page. Its primary click opens the primary routed port. When the session exposes additional routed ports, the adjacent arrow menu lists each port mapping so operators can open a secondary port directly; mappings that do not yet have a host port stay visible but disabled with their pending reason.
- Preview links only activate when a session is running and has a routed host port. Starting, stopped, errored, and missing-port sessions remain visible but disabled, omit navigable URLs, suppress activation, and expose a persistent reason through visible copy plus `aria-describedby` or `title`.

## Verification Notes

For documentation-only updates, run `pnpm run lint` and:

```bash
rg "interaction|reduced motion|aria-busy|asyncFeedback" docs/dashboard docs/index.md docs/SUMMARY.md
```

For Browser UI changes, focused coverage includes `tests/dashboard/v2/browser-page-components.test.tsx`; page-level tests often mock browser rail, chrome, and launch-panel components so BrowserPage assertions can focus on page state.
