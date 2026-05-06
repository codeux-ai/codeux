1. **Motion Tokens (`tooltipMotion` and `AvantgardeSelect`)**:
   - In `dashboard/src/v2/utils/motion.ts`, update `tooltipMotion.enter` and `exit`. If `config?.duration === 0`, ensure `y`/`x` are omitted or set to 0.
   - In `dashboard/src/v2/components/ui/AvantgardeSelect.tsx`, update the GSAP `fromTo` and `to` definitions: if `durations.base === 0` (which is checked via `reducedMotion`), avoid animating `filter` ("blur") and conditionally remove `y` slide so it's a pure fade/toggle.

2. **Select Component Keyboard/Focus**:
   - Improve `listboxRef` tracking by adding a `focusout` handler or `onBlur` that checks if the `relatedTarget` is within `triggerRef` or `panelRef`. If it's outside, close the popover.
   - Improve `Tab` and `Escape` handlers in `AvantgardeSelect`'s `onKeyDown`. Focus on `triggerRef` should occur before `setOpen(false)` so that it reliably moves focus back. (Actually, current code does `setOpen(false)` then `triggerRef.current?.focus()`, which works, but let's make sure it's tight).
   - Ensure `activeIndex` resets cleanly to `value` or tracks accurately. Currently, `useEffect` on `open` resets `activeIndex` to the index of `value`.

3. **Tooltip Keyboard Parity**:
   - In `Tooltip.tsx`, remove the `:focus-visible` check from `handleFocus`.
   - Add a ref `isPointerInteraction = useRef(false)`.
   - Add `onPointerDown={() => { isPointerInteraction.current = true; }}`.
   - In `handleFocus`, if `isPointerInteraction.current` is true, reset it to false and `return;`. Otherwise, call `handleMouseEnter()`.
   - Update `onKeyDownCapture` to handle `Escape`.

4. **Focus Trap Refactor (Completed in feature branch)**:
   - Refactor `dashboard/src/v2/hooks/use-focus-trap.ts` to improve Tab logic, Escape handling, and focus restoration resilience.
   - Consolidate tests in `tests/dashboard/v2/use-focus-trap.test.tsx`.

5. **Tests Updates**:
   - Update `tests/dashboard/v2/tooltip.test.tsx` to handle the pointer interaction ref.
   - Run tests.
