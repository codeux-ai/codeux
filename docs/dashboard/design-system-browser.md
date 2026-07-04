# Browser Workbench Design System

The browser workbench is a premium, specialized surface inside the Code UX dashboard used for previewing and developing sprint containers.

## Typography
- Use `font-mono text-[12px]` for all script code, container logs, and port routing to maintain a technical feel.
- Section headers use `text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400`.
- Titles and key states use robust weighting (e.g. `text-xl font-semibold`, `text-slate-800 dark:text-slate-100`).

## Panel Styling
- Main workbench panels use glassmorphic styling: `rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/45 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]`.
- Inner content areas (like logs and scripts) use `rounded-[1.5rem] bg-slate-100/80 p-4 dark:bg-void-950` to create visual depth and separation.
- Browser Preview should read as one runtime surface: the launch panel, session rail, chrome, address bar, session details, script editor, and logs all use the same rounded glass panel treatment with nested, quieter code/log wells.
- Avoid generic browser-copy defaults. Window controls may evoke a browser frame, but status, copy, and controls should describe sprint preview runtime states and container actions.

## Disabled States
- Disabled buttons, inputs, and actions should primarily use `disabled:cursor-not-allowed disabled:opacity-50` rather than substituting entire background colors, keeping the design cleaner and indicating the action is structurally there but currently unavailable.
- In `PreviewWindowChrome` address bar inputs: ensure disabled states retain the core styling but apply `opacity-50` to signal the state visually without implying a broken UI.
- Disabled address navigation must keep its descriptive `title`, `aria-disabled`, and `aria-busy` behavior. Visual refinements should never remove the explanation that a running container is required.

## Layout and Sizing
- Avoid fixed heights on dynamic content areas like textareas. Use `min-h-[Xrem] w-full` where applicable to ensure contents fit flexibly without breaking layout.
- The `PreviewWindowChrome` handles multiple states (`fullscreen`, `minimized`, `closed`, `normal`). Each state transition must preserve consistent padding, icon alignment, and layout proportions.
- Use `grid-cols-1` stacking below breakpoints (e.g. `xl:grid-cols-[minmax(0,1fr)_340px]`) and apply `min-w-0` to flex child structures to gracefully wrap filenames and address bars without causing horizontal body scrolling.
- Long sprint names should wrap within a two-line card title or a bounded detail heading. Port mappings, startup script paths, log lines, and error messages should use monospace text with `break-all`, `break-words`, or scroll containers so they never overlap controls.
- Log and script wells should keep a stable minimum height, allow vertical scrolling for long content, and keep action buttons in a fixed header row above the scrollable body.

## Color Semantics
- **Running / Healthy:** `signal-500`
- **Stopped:** `slate-500`
- **Error / Unreachable:** `status-red`
- **Starting / Building:** `ember-500` or `amber-400`

## State Treatments
- **No session:** show an inactive chrome shell and a centered empty state that explains how to start a sprint preview.
- **Starting:** keep the iframe area mounted when possible, show a clear runtime overlay, mark navigation controls busy, and preserve logs/script panels.
- **Running:** show signal status chips, enabled address navigation, and active external open affordances.
- **Stopped:** keep the runtime surface visible, disable navigation, and frame the state as waiting for a connection rather than removing context.
- **Error:** show the failed state prominently and preserve the error text in a bounded, scrollable area.
- **Minimized / closed / fullscreen:** these are browser-surface states only. They must hide or resize the iframe frame predictably without ending the underlying preview session.
