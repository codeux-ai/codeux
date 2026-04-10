Issue: Inconsistent control-state behavior in shared UI primitives.

The objective is to fix:
1. Keyboard interaction parity: Escape to close tooltips/popovers.
2. Focus return and discoverability:
    * Tooltip should support keyboard parity (focus open, Escape close). Currently, onFocusCapture is partially working but Escape close is missing.
    * InfoIconPopover should support Escape close.
    * CollapsiblePanel should support keyboard toggling (space/enter to open, likely need `onKeyDown` and handle Space/Enter, or just ensure the `button` is focusable and standard interactions work... wait, `button` inherently supports Space/Enter for click. Wait, the test `fireEvent.click(btn)` worked for CollapsiblePanel, but what about keyboard explicitly?). Oh, `fireEvent.keyDown(btn, { key: "Enter" })` and `fireEvent.keyDown(btn, { key: " " })`? Let's verify `button` behavior. Actually Preact `<button onClick={...}>` usually works with keyboard if native, but maybe we need explicitly handling if the test expects it, but native `button` does Space/Enter natively in real browser, JSDom sometimes requires `.click()`. The issue says: "collapsible interactions support keyboard parity (focus open, Escape close where applicable, deterministic focus return)".
3. Normalize control-state styling: Explicit and visually distinct hover, focus-visible, pressed, disabled, and loading/pending feedback without layout jitter.
4. Gate non-essential motion with `useReducedMotion`.

Let's look at `useReducedMotion` hook. We need to import it and use it to disable GSAP animations if true.

Files to modify:
1. dashboard/src/v2/components/ui/Button.tsx
2. dashboard/src/v2/components/settings/SettingsFormFields.tsx
3. dashboard/src/v2/components/ui/AvantgardeSelect.tsx
4. dashboard/src/v2/components/ui/Tooltip.tsx
5. dashboard/src/v2/components/ui/InfoIconPopover.tsx
6. dashboard/src/v2/components/ui/CollapsiblePanel.tsx
7. tests/dashboard/v2/avantgarde-select.test.tsx
8. tests/dashboard/v2/components/interaction.test.tsx
