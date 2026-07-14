# Browser Preview

The browser preview provides an integrated environment for interacting with running sprint containers directly from the dashboard.

## Defaults

- Fresh system and project settings enable the preview runtime and show the in-app browser workspace by default.
- Existing persisted system, project, or sprint overrides remain authoritative. Sanitization only fills missing preview fields from the current defaults, so an explicit disabled preview stays disabled.
- `autoStartOnRunningSprint` remains false by default. Operators still choose whether sprint runs should launch preview containers automatically; the default only makes preview controls and the embedded browser available.
- `startupCommand` is blank by default, so command detection remains active. A saved container override takes precedence over the scoped settings default, which takes precedence over the detected command.
- `allowDockerAccess` is false by default because Docker daemon access is equivalent to host-level control.

## Startup Reliability

- Startup container cleanup is a barrier for preview launch and reconciliation. A manual or automatic launch waits for cleanup instead of racing a stale-container removal.
- Reconciliation is single-flight, and preview starts are serialized across the shared host-port allocator so overlapping interval/manual launches cannot reserve the same port.
- Sessions that were running, starting, or backed by an exited container before runtime restart are restored once after cleanup, including manually launched previews whose sprint is no longer actively running.
- A session left in `starting` before Docker created its container is treated as an orphaned start and retried; reconciliation does not interrupt an in-process start.
- A preview that was observed healthy, or belongs to an active auto-start sprint, gets one automatic recovery attempt per unexpectedly exited container. This includes manually launched previews after their sprint finishes; a persistent application or startup failure remains visible instead of entering an infinite rebuild loop.
- Exit code 137 is reported as container termination rather than attaching an unrelated warning from otherwise healthy application logs.

## Interaction Contracts

- Preview refresh, launch, rebuild, stop, remove, navigation, and startup-script save operations use visible async feedback plus local status text. Page-level operation results use `ActionFeedbackRegion` where available; control-specific progress stays beside the control that is pending.
- Dashboard API calls that operate on an existing preview session must carry the owning project and sprint scope. Rebuild, stop, remove, log, and dashboard proxy requests verify the session belongs to the requested project and sprint before returning data or taking action; a foreign or missing session receives the same generic not-found response.
- Preview-host iframe traffic keeps the existing `preview-<sessionId>.<dashboard-host>` URL format. Host-side start, rebuild, and status controls first resolve that host session, then accept only the canonical preview origin or its canonical dashboard origin.
- Use `controlFeedback` for preview chrome buttons, session rail controls, launch controls, rebuild/stop/open actions, script save, and address navigation controls.
- Use `enterExit` for preview window empty/starting/error states, menus, and browser chrome state surfaces.
- Use `selectionMovement` for active session cards and rail selection changes.
- Use `listReveal` for session menu contents and empty/loading menu states as they appear.
- Use `listReorder` when session cards shift after removal or filtering.
- Use `asyncFeedback` for launch/rebuild/stop/script-save/log-refresh feedback and `ActionFeedbackRegion` progress/result surfaces.
- Under reduced motion, spinners and rail movement must snap or stop while status badges, button labels, `aria-busy`, visible disabled reasons, and log status copy remain visible.

## Localization Boundary

- Browser Preview dashboard copy is available in English and German through the feature-owned `browser-preview.ts` catalog. This includes page chrome, session menus and rails, launch/rebuild/stop controls, environment editors, port states, logs status, confirmations, validation context, empty/error states, and live announcements.
- Session and environment counts use the active locale's native number and plural formatting. Pending port summaries accept an explicit locale for non-component consumers while preserving mapping order and the numeric port notation used by routing.
- Preview URLs, normalized paths, startup commands and scripts, environment names and values, container IDs, container logs, project and sprint names, and backend diagnostics remain runtime data. They are rendered verbatim and are never translated or inserted into message-catalog templates as diagnostics.
- API modules continue to return their existing payloads and raw error messages. The Browser surface may place localized dashboard-owned context before a raw diagnostic, but does not alter the diagnostic or the preview/session lifecycle.

## Accessibility Expectations
- Interactive elements (session menus, sliders, actions) must be fully keyboard accessible.
- Iframes and embedded views must have descriptive titles indicating their purpose and target.
- Window controls, navigation controls, session removal, external open, rebuild, stop, and script save actions must use explicit accessible names instead of relying on `title` text or icon shape.
- Preview environment defaults in the right sidebar and container override modals from preview cards must be keyboard reachable, expose labeled key/value fields, announce save progress, and make clear that saved environment changes apply on the next rebuild or start.
- The right sidebar startup-command editor is scoped to the selected container, shows the inherited project command when present, and announces that a rebuild is required.
- Live regions should transparently report loading, starting, running, stopped, reconnecting/unavailable, stale-log, saving, launching, empty-session, and error states without overwhelming screen readers.
- The address form must keep a programmatic label, describe why it is disabled when the preview container is unavailable, and announce submitted navigation attempts while keeping focus in the address field.
- Session rails must keep horizontal overflow inside the rail, expose the active session state, and remain keyboard reachable at narrow widths.
- Hidden slider controls must become visible when they or their container receive keyboard focus.
- Unavailable preview links remain visible and keyboard reachable as disabled link controls. They must not navigate, must keep the safe URL path absent, and must expose a persistent reason through visible copy plus `aria-describedby`.
- Session removal actions keep the card mounted while removal is pending, set `aria-busy` on the card and remove button, suppress duplicate removal, and describe the pending reason from the disabled control.
- The active sessions menu opens predictably from hover, click, focus, `Enter`, `Space`, `ArrowDown`, and `ArrowUp`; supports `ArrowUp`/`ArrowDown`/`Home`/`End` within enabled menu items; and restores focus to the trigger after `Escape` or outside-click close.
- File-browser trees and change lists should expose tree/listbox semantics, selected file state, loading/error/empty regions, and wrapping long paths so keyboard users do not need pointer hover to inspect files or diffs.
- Rebuild, stop, and remove track distinct pending actions. The active operation owns the button label, `aria-busy`, and status text; sibling controls are disabled with visible recovery text instead of relying on click-time announcements. Preview sessions are explicitly scoped per project/sprint pair.
- Launch controls set `aria-busy` on both the launch region and launch button while a container is starting. The selected session iframe remains mounted during refresh/starting states when a previous frame exists; do not replace stale preview content with a blank loading placeholder unless no frame exists.
- Launch pending state keeps the selected sprint value visible, explains the disabled select and launch controls through status text and control titles, and prevents duplicate launch submission until the start request settles.
- Startup-script saving sets `aria-busy` on the save button and textarea and pauses editing until the save completes. Script save status is a polite live region connected through `aria-describedby`.
- Container logs keep stale log text mounted during refresh, set `aria-busy` on the log region, and show a visible Ready/Refreshing/Error badge plus polite live-region copy.
- File-browser launch, rebuild, and stop follow the same async contract as browser preview: the affected region or button sets `aria-busy`, the visible label names the pending operation, duplicate activation is suppressed, and disabled sibling controls describe whether launch, rebuild, or stop is blocking recovery.
- File tree rows and changed-file rows keep keyboard tree/listbox semantics while selection loads. The selected row sets `aria-busy`, shows a non-animation-only Loading badge, and keeps focusable row activation available for normal selection behavior.
- File and diff viewers keep cached editor content mounted during background refresh. The viewer region sets `aria-busy`, the retained content is visually marked with a stale/refresh ring and visible status copy, and empty states are reserved for committed empty selections where no cached file or diff exists.
- Changed-file refreshes keep the cached list mounted when available. Refresh and error banners must say whether the list is current, refreshing, or a cached fallback, and unavailable diffs keep their backend-provided reason visible.
- Navigation pending state is a short client-side command guard. Back, forward, reload, and address submit controls announce that the navigation command is being sent; the iframe bridge does not acknowledge command completion.
- A new navigation command clears any delayed success announcement from a previous back, forward, reload, address, or port-selection action. Delayed success copy must only describe the most recent originating surface and must not fire after the browser page unmounts.
- Disabled navigation controls keep persistent reason text visible in the chrome and attach the same reason through `aria-describedby` and `title`. Pending navigation uses the same surface with `aria-busy` so duplicate activation is suppressed without relying on a transient toast.
- Multi-port preview sessions render as one persisted browser session with an accessible port tablist in the browser chrome. The first container-to-host port mapping is the primary tab, tabs support pointer and arrow-key selection, and secondary tabs route through the existing selected-port proxy query while preserving a separate current path per selected port.
- Port tabs are keyboard-operable with arrow keys plus `Home` and `End`, keep focus on the selected tab after keyboard selection, and describe whether each container port is routed or waiting for a host port.
- Preview session selection cards render below the browser workspace, not above it, so the browser remains the primary surface while running containers stay available in the bottom rail.
- The Browser page right sidebar keeps Launch Container expanded at all times. Secondary panels start collapsed, including Selected Sprint, Environment, Runtime notes, and Container logs; the collapsed Selected Sprint header keeps the current port mapping visible as a badge, or `port pending` when no running preview is selected.
- Minimize and close hide the browser frame visually but keep the embedded preview content mounted. Restore and reopen move focus back to the chrome control that initiated the state change; fullscreen restore returns focus to the fullscreen control.
- Iframe refreshes, selected-port changes, and session refreshes should preserve the previous iframe whenever it remains useful. Starting, stopped, missing-port, and error states use overlays, disabled chrome, and visible reason text instead of blanking already-mounted preview content.
- The Live Preview button uses the same mapping model outside the full browser page. Its primary click opens the primary routed port. When the session exposes additional routed ports, the adjacent arrow menu lists each port mapping so operators can open a secondary port directly; mappings that do not yet have a host port stay visible but disabled with their pending reason.
- Preview links only activate when a session is running and has a routed host port. Starting, stopped, errored, and missing-port sessions remain visible but disabled, omit navigable URLs, suppress activation, and expose a persistent reason through visible copy plus `aria-describedby` or `title`.
- Container log refreshes keep cached log output visible during foreground refresh, silent polling, empty responses, and refresh errors. The logs region exposes `aria-busy`, a visible Ready/Refreshing/Stale/Error badge, and status copy that names whether the user is seeing current logs or a cached fallback.

## Proxy Credential Boundaries

The browser preview has two proxy paths with different credential rules:

- Dashboard API proxy requests under `/api/browser/sessions/:sessionId/proxy*` originate from the dashboard runtime. Before forwarding to the selected preview port, the proxy strips dashboard cookies, bearer authorization, `set-cookie`, hop-by-hop headers, `proxy-*`, `x-code-ux-*`, `host`, `content-length`, and compression negotiation headers. It also normalizes `Origin`, `Referer`, and `Sec-Fetch-Site` so the preview app sees the selected local upstream origin, such as `http://127.0.0.1:<hostPort>`.
- Preview-host iframe and external-tab requests on `preview-<session>.localhost` are the preview app's own origin. Those requests may forward the preview app's own `Authorization` and `Cookie` headers so stateful login/session flows continue to work. Transport, proxy-control, Code UX control, and client-supplied forwarding headers are stripped. The proxy then presents one coherent local upstream boundary (`Host`, `X-Forwarded-Host`, `Origin`, `Referer`, protocol, and port all agree on `localhost:<mapped-port>`) while the network connection remains pinned to the recorded loopback port. This supports applications that reject untrusted or contradictory host headers.

Both paths only route to loopback host ports recorded on the active preview session. The dashboard API proxy also removes `Set-Cookie`, CSP, CSP report-only, and `X-Frame-Options` response headers before writing the response on the dashboard origin. Preview-host HTML keeps iframe compatibility by stripping upstream document CSP and frame-blocking headers while allowing preview-origin app cookies to reach that preview host.

## Optional Docker Access

Settings can explicitly enable Docker access for preview containers. The Browser page right sidebar exposes the same control as a project-wide default plus an `inherit`/`enabled`/`disabled` override for the selected preview container. Changes take effect on the next rebuild.

When enabled, Code UX mounts the local Unix Docker daemon socket, adds the socket group to the preview user, mounts a compatible host Docker CLI and Compose v2 plugin on Linux when available, and runs both `docker version` and `docker compose version` before starting the application. Missing socket, CLI, Compose plugin, or daemon access fails startup with a focused error instead of letting the application command fail with an ambiguous unknown-command message.

This option is disabled by default and must only be enabled for trusted repositories and commands. Control of the Docker daemon is effectively control of the host. Docker-managed child containers do not automatically inherit the preview workspace or network namespace; Docker-based startup commands can use `SPRINT_PREVIEW_DOCKER_VOLUME`, `SPRINT_PREVIEW_CONTAINER_NAME`, and `SPRINT_PREVIEW_RUNTIME_ROOT` to declare an external named volume and `network_mode: container:<name>` when that topology is required.

## File Browser Comparison

The File Browser is a distinct dashboard surface and runtime capability separate from Browser Preview. While Browser Preview proxies live container ports to a dashboard iframe, the File Browser manages its own dedicated sessions to provide filesystem inspection and Git change reviews.

File Browser sessions expose their own API routes:
- `/api/projects/:projectId/file-browser/sessions` (list sessions)
- `/api/projects/:projectId/sprints/:sprintId/file-browser/start` (launch session)
- `/api/file-browser/sessions/:sessionId/rebuild` (rebuild session)
- `/api/file-browser/sessions/:sessionId/stop` (stop session)
- `/api/file-browser/sessions/:sessionId` (DELETE to remove session)
- `/api/file-browser/sessions/:sessionId/tree` (fetch folder tree)
- `/api/file-browser/sessions/:sessionId/file` (fetch file content)
- `/api/file-browser/sessions/:sessionId/changes` (fetch Git status changes)
- `/api/file-browser/sessions/:sessionId/diff` (fetch Git diff)

The UI provides two primary views:
- **Files mode**: Shows a complete workspace tree and syntax-highlighted file viewer.
- **Changes mode**: Shows a list of modified files in the sprint branch and a diff viewer.

## Verification Notes

For documentation-only updates, run `pnpm run lint` and:

```bash
rg "interaction|reduced motion|aria-busy|asyncFeedback" docs/dashboard docs/index.md docs/SUMMARY.md
```

For Browser UI changes, focused coverage includes `tests/dashboard/v2/browser-page-components.test.tsx`; page-level tests often mock browser rail, chrome, and launch-panel components so BrowserPage assertions can focus on page state.
