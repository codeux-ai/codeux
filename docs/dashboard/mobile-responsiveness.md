# Mobile Responsiveness & Overlay Surfaces

The dashboard UI uses specific constraints to handle small screens, browser chrome changes, and medium-width layouts without clipping important controls or trapping content outside the viewport.

## Responsive Overlays

When using shared overlay components (`Modal`, `Dialog`, `Drawer`, `NotificationPanel`, `SearchOverlay`), follow these responsive constraints:

1.  **Modals & Dialogs**:
    *   Always use dynamic viewport-relative limits: `max-w-[calc(100vw-2rem)]` and `max-h-[calc(100dvh-2rem)]`.
    *   Include `overflow-y-auto` so internal content scrolls naturally if it exceeds the viewport height.
    *   Provide a stable accessible name with `ariaLabel`, `ariaLabelledBy`, or `titleId`; avoid generic fallback labels when the visible title can label the surface.
    *   For layouts with sidebars or decorative panels (e.g., `AddProjectModal`, `AddTaskModal`, `SprintMarkdownModal`), stack the layout on small screens using `flex-col sm:flex-row`, or hide purely decorative panels (`hidden sm:flex`).

2.  **Drawers**:
    *   Drawers must stretch to the full viewport height using `h-[100dvh]` to account for mobile browser UI chrome.
    *   They should act full-width on phones but have a bounded max-width on larger screens (e.g., `w-[calc(100vw-2rem)] sm:w-full max-w-md`).
    *   Internal vertical scrolling must be enabled (`overflow-y-auto`).

3.  **Command Palettes & Positioning (e.g., `SearchOverlay`)**:
    *   Anchored positioning should fall back to a centered, screen-relative mobile command surface if the available space below the anchor is too small (e.g., `< 300px` available) or if the viewport is narrow (e.g., `< 768px`).
    *   Ensure focus return and keyboard navigation work correctly regardless of the layout fallback mode.
    *   Top-nav dropdowns (e.g., project and sprint selectors) must use layout-aware positioning (such as `absolute top-full`) instead of fixed top coordinates, ensuring they remain anchored below the button and wrap cleanly without overlapping if the header height changes. Compact action clusters should use `min-w-0` to allow text truncation and wrap safely without clipping or hiding primary controls.

4.  **Notification Panels**:
    *   Flyout menus and notification surfaces should be collision-aware with width and max-height constraints (e.g., `max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem)]`) so they remain fully visible from the top nav at tablet widths without clipping.

## Responsive Data Display

When using the `Table` component for responsive data displays:
1. **Semantics:** Wrap the entire table in `<Table>`, and ensure `role="rowgroup"` is preserved on `<TableHeader>` and `<TableBody>` to prevent responsive `div` wrappers or `display: block` overrides from breaking native table semantics for assistive technology.
2. **Captions:** Always provide an explicit, descriptive `caption` prop to the `Table` to describe its purpose.
3. **Mobile Labels:** Supply a `mobileLabel` prop to `<TableCell>` components. This programmatic label acts as a substitute for standard column headers when the layout switches to a stacked card presentation on narrow screens.
4. **Accessible Sort States:** Apply `ariaSort` explicitly only on the active sort column.
5. **Handling Long Strings:** To ensure long continuous strings do not overflow the mobile cards or desktop columns, `TableCell` internals must use `min-w-0 break-words` classes. Content rendered inside the cell must support text wrapping safely without breaking the mobile layout.

## Stats Analytics Surfaces

The Stats page combines fixed header-adjacent navigation, chart controls, tabbed ledgers, and dense tables. Its responsive contract is stricter than a simple card grid:

1. **Header Controls:** Time-window presets, custom date fields, and visual modes must wrap inside the Stats hero before any component introduces horizontal overflow. The page itself must not scroll sideways.
2. **Mode Navigation:** The `Trend`, `Composition`, `Models`, `Providers`, `Ledgers`, and `System` control remains keyboard reachable at phone widths. Icon-only mobile rendering must keep stable accessible names and visible focus rings.
3. **Custom Ranges:** Date validation text must stay directly associated with the date inputs and remain visible without overlaying KPI cards or mode controls.
4. **Charts:** Trend charts must keep a readable summary, keyboard bucket exploration, minimap controls, and the screen-reader data table in DOM order even when the visual rail stacks below the plot. Chart values must not depend on hover-only or motion-only disclosure.
5. **Ledgers and Tables:** Ledger tabs use real tab semantics, while task, sprint, Git, and system rows preserve table headers or mobile labels. Long prompts, model names, provider ids, errors, and transcript text must wrap inside the row or detail panel.
6. **Reduced Motion:** Stats shell entrance, chart updates, donut/ribbon animation, hover lift, and tab transitions must respect `prefers-reduced-motion`; disabling motion must not hide filter state, validation errors, chart values, or transcript content.

## Warm Void Responsive Consistency

1. **Text Zoom & Narrow Widths:** Test narrow widths and browser text zoom with long provider names, model ids, sprint names, branch names, workflow names, file paths, command labels, and connection keys. Controls should wrap or compact without overlapping adjacent shell, rail, or card content.
2. **Shell Navigation:** Top-nav project/sprint selectors, notification menus, theme/Docker controls, sidebar links, and the bottom `KineticDock` must keep their accessible names when the visual treatment becomes icon-only. Tooltip text may be visual-only, but the control itself needs the stable name.
3. **Browser Rails:** Browser Preview session rails, launch cards, address controls, script editor actions, log panels, and file-browser tree/change lists own their overflow inside the rail or panel. The iframe/workbench should remain viewport-bounded rather than forcing body-level horizontal or vertical overflow.
4. **Task Cards:** Task board lanes and cards stack cleanly, preserve lane headings and count summaries, and keep task id/title/status/priority/dependency/session/PR/duration/QA context readable without hover. Drag treatment remains pointer-only unless a real keyboard reordering contract is implemented.
5. **Color Discipline:** Use Signal Jade for focus, active selection, primary route accents, and running/healthy signals. Use Ember/status tones for warning, error, danger, intervention, and destructive states. Do not solve mobile emphasis by adding unrelated one-off accent colors.
6. **Motion:** Mobile layouts follow the same motion tokens as desktop. Reduced motion snaps rail movement, chart transitions, task-card tilt, status waves, and background animation while retaining static state cues.

## Horizontal Dashboard Rails

Horizontally overflowing dashboard surfaces, including Quicksprint template rails, should contain their own horizontal scrolling within the component boundary. The page itself must not gain horizontal scroll at mobile, tablet, or desktop widths.

For Quicksprint templates, keep the two-row rail layout reachable on narrow screens by allowing native horizontal touch and trackpad scrolling inside the rail. Left and right controls may remain available where space allows, but they should supplement native scrolling rather than replace it. Vertical wheel movement over a rail must continue scrolling the surrounding panel or page, and the rail must not claim touch panning in a way that blocks vertical scrolling. Use viewport-safe max widths, `min-w-0` on rail containers, and scroll padding or end spacers when needed so the first and last cards, focus rings, and controls are not clipped.

## Long-Form Modal Scrolling

For modals with extensive form content (like `AddProjectModal` and `AddTaskModal`), the layout should ensure that:
1.  **Headers and Footers are Fixed**: The modal header (title/description) and footer (actions like Cancel/Submit) must remain pinned and visible at all times, independent of scrolling.
2.  **Scrolling Body**: The internal form body should own the vertical scrolling using `overflow-y-auto` and `flex-1 min-h-0`. This ensures forms are robust under small viewport heights and on-screen keyboards.
3.  **Invalid Field Scroll**: When a form validation fails, use `getBoundingClientRect()` against the scrollable container to smoothly scroll the first invalid field into view, preventing the browser from natively scrolling it under fixed headers or keyboards.
4.  **Error Wiring**: Validation errors should be exposed only while visible using `aria-describedby` or `aria-errormessage`, and invalid submits should focus the first invalid control with `preventScroll` before scrolling the internal form body.

## Safe Areas & Bottom Navigation

Fixed bottom navigation elements, such as the `KineticDock`, must account for mobile browser UI chrome and safe areas:
1. **Dynamic Bottom Constraints**: Use `bottom-0` and set the container's height dynamically with `h-[calc(height+env(safe-area-inset-bottom))]` while applying `pb-[env(safe-area-inset-bottom)]` or a style attribute for bottom padding to elevate the controls above the iOS home indicator.
2. **Horizontal Scroll Boundaries**: For horizontally scrolling lists inside constrained boundaries (e.g., `snap-x`), add an explicit right spacer (`<div className="w-[1px] shrink-0" aria-hidden="true" />`) and apply horizontal scroll padding (`scroll-px-*`) to prevent the last navigation item from being clipped visually or causing focus states to overflow out of bounds.

For route-level responsive checks, use the [Dashboard Accessibility Quality Audit](./accessibility-quality-audit.md).
