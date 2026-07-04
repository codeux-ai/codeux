# Browser Workbench Design System

The browser workbench is a premium, specialized surface inside the Code UX dashboard used for previewing and developing sprint containers.

## Typography
- Use `font-mono text-[12px]` for all script code, container logs, and port routing to maintain a technical feel.
- Section headers use `text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400`.
- Titles and key states use robust weighting (e.g. `text-xl font-semibold`, `text-slate-800 dark:text-slate-100`).

## Panel Styling
- Main workbench panels use glassmorphic styling: `rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/45 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]`.
- Inner content areas (like logs and scripts) use `rounded-[1.5rem] bg-slate-100/80 p-4 dark:bg-void-950` to create visual depth and separation.

## Disabled States
- Disabled buttons, inputs, and actions should primarily use `disabled:cursor-not-allowed disabled:opacity-50` rather than substituting entire background colors, keeping the design cleaner and indicating the action is structurally there but currently unavailable.
- In `PreviewWindowChrome` address bar inputs: ensure disabled states retain the core styling but apply `opacity-50` to signal the state visually without implying a broken UI.
- Disabled preview controls must keep their accessible names stable and expose the unavailable reason through visible status copy, `title`, or helper text when the reason is not obvious from the current session state.

## Layout and Sizing
- Avoid fixed heights on dynamic content areas like textareas. Use `min-h-[Xrem] w-full` where applicable to ensure contents fit flexibly without breaking layout.
- The `PreviewWindowChrome` handles multiple states (`fullscreen`, `minimized`, `closed`, `normal`). Each state transition must preserve consistent padding, icon alignment, and layout proportions.
- Use `grid-cols-1` stacking below breakpoints (e.g. `xl:grid-cols-[minmax(0,1fr)_340px]`) and apply `min-w-0` to flex child structures to gracefully wrap filenames and address bars without causing horizontal body scrolling.

## Color Semantics
- **Running / Healthy:** `signal-500`
- **Stopped:** `slate-500`
- **Error / Unreachable:** `status-red`
- **Starting / Building:** `ember-500` or `amber-400`

## Interaction And Feedback

- Browser chrome, session rails, file viewers, and diff viewers use `controlFeedback` for local controls, `enterExit` for window/session state changes, and `asyncFeedback` for loading, unavailable, or failed operations.
- Loading and empty file/diff states use polite `role="status"` regions; read or diff failures use `role="alert"`. Reduced motion must keep the visible loading, empty, unavailable, and error text even when spinner or window movement is removed.
- Session and address controls must stay keyboard reachable without hover-only disclosure. Stale preview data should remain visible with a polite refresh/status message when a previous session snapshot exists.
