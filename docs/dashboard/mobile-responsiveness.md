# Mobile Responsiveness & Overlay Surfaces

The dashboard UI uses specific constraints to handle small screens, browser chrome changes, and medium-width layouts without clipping important controls or trapping content outside the viewport.

## Responsive Overlays

When using shared overlay components (`Modal`, `Dialog`, `Drawer`, `NotificationPanel`, `SearchOverlay`), follow these responsive constraints:

1.  **Modals & Dialogs**:
    *   Always use dynamic viewport-relative limits: `max-w-[calc(100vw-2rem)]` and `max-h-[calc(100dvh-2rem)]`.
    *   Include `overflow-y-auto` so internal content scrolls naturally if it exceeds the viewport height.
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

## Long-Form Modal Scrolling

For modals with extensive form content (like `AddProjectModal` and `AddTaskModal`), the layout should ensure that:
1.  **Headers and Footers are Fixed**: The modal header (title/description) and footer (actions like Cancel/Submit) must remain pinned and visible at all times, independent of scrolling.
2.  **Scrolling Body**: The internal form body should own the vertical scrolling using `overflow-y-auto` and `flex-1 min-h-0`. This ensures forms are robust under small viewport heights and on-screen keyboards.
3.  **Invalid Field Scroll**: When a form validation fails, use `getBoundingClientRect()` against the scrollable container to smoothly scroll the first invalid field into view, preventing the browser from natively scrolling it under fixed headers or keyboards.
