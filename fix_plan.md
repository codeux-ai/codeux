1. **Button.tsx**:
   - Issue: Layout jitter on hover/active or missing state normalization.
   - Fix: Ensure `active:scale-95` doesn't conflict with GSAP (wait, button doesn't use GSAP currently). The prompt mentions: "Normalize control-state styling and semantics so each primitive has explicit and visually distinct hover, focus-visible, pressed, disabled, and loading/pending feedback without layout jitter."
   - Button currently has `hover:-translate-y-px` and `active:scale-95`. Removing layout shifts like translate-y if it causes jitter, or just keeping `active:scale-95` since it's common. Wait, the problem says "without layout jitter" and "preserve non-motion cues ... gate non-essential motion with `useReducedMotion`".
   - I should use `useReducedMotion` to disable `hover:-translate-y-px` and `active:scale-95` if motion is reduced, OR replace them with `transform-gpu` or `motion-safe:...` via Tailwind. Tailwind supports `motion-safe:hover:-translate-y-px motion-safe:active:scale-95`.
   - Update: Let's use `motion-safe` variants for the Button `active:scale-95` and `hover:-translate-y-px`.

2. **SettingsFormFields.tsx**:
   - `Toggle`, `PillChoiceGroup`, `TextInput`, `NumberInput`.
   - `Toggle`: Uses `active:scale-95`. Change to `motion-safe:active:scale-95`.
   - `PillChoiceGroup`: Uses `active:scale-95`, `hover:-translate-y-px`. Change to `motion-safe`.
   - `TextInput`, `NumberInput`: Check focus rings and disabled states. Ensure explicitly distinct hover/focus/disabled. No motion here usually, just colors.

3. **AvantgardeSelect.tsx**:
   - Already has `reducedMotion`. Ensure `gsap` doesn't animate if `reducedMotion` is true. `if (!reducedMotion) gsap.fromTo(...) else gsap.set(...)`
   - Wait, `AvantgardeSelect` has `reducedMotion` but doesn't seem to use it for GSAP?
   - Let's check `AvantgardeSelect.tsx:157`: `gsap.fromTo(...)`. It doesn't check `reducedMotion`.

4. **Tooltip.tsx**:
   - Support `Escape` key close. Since it uses `onFocusCapture`/`onBlurCapture`, add `onKeyDown` to wrapper to handle `Escape`.
   - Add `useReducedMotion` and conditionally run GSAP animations.
   - `tabIndex={0}` on wrapper? Wait, tooltips usually just wrap a trigger. If the trigger is focusable, the wrapper gets `onFocusCapture`. If `Escape` is pressed, we close the tooltip.

5. **InfoIconPopover.tsx**:
   - Support `Escape` key close. Add `onKeyDown` handler.
   - It has `tabIndex={0}`? The wrapper has `onFocusCapture`. Let's add `tabIndex={0}` so it can be focused directly if not wrapping a focusable element (wait, InfoIconPopover currently wraps an `Info` icon and has `onClick`, `onMouseEnter`, `onFocusCapture`. Since it is interactive, the wrapper itself should be `role="button"` or `tabIndex={0}`).

6. **CollapsiblePanel.tsx**:
   - Add `onKeyDown` handler to the `button` to support explicit keyboard interaction if needed? Wait, native `button` handles Space/Enter. The problem states "support keyboard parity (focus open, Escape close where applicable, deterministic focus return)". For CollapsiblePanel, maybe it just lacks proper focus visible styles or missing `aria-expanded`? Let's add `aria-expanded={open}`.

7. **Verification**:
   - Run typecheck, tests, etc.
