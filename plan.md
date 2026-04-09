1. Create `interactions.ts` in `dashboard/src/v2/lib/motion/interactions.ts`.
   - Define constants: `MAGNETIC_RADIUS = 110`, `HAPTIC_PRESS_SCALE = 0.96`, `HOVER_EASE = "elastic.out(1, 0.7)"`, `RELEASE_EASE = "power2.out"`.
2. Verify the creation and contents of `interactions.ts` using `run_in_bash_session` with `cat`.
3. Update `IconButton.tsx`:
   - Import `useRef` and `gsap`, and the constants from `interactions.ts`.
   - Add `onMouseMove`, `onMouseLeave`, `onPointerDown`, `onPointerUp`, and `onPointerLeave` to handle magnetic fisheye and haptic spring-back.
   - Use `prefers-reduced-motion` hook.
   - Remove Tailwind's `active:scale-95` to avoid conflicting with GSAP's haptic animation.
4. Update `Button.tsx`:
   - Use `useRef` and attach GSAP event handlers for haptic spring back.
   - Add a `magnetic` prop (defaulting to false) to toggle the magnetic effect, allowing buttons with icons to opt-in easily.
   - Remove Tailwind's `active:scale-95`.
5. Update `AvantgardeSelect.tsx`:
   - Use `useRef` on the trigger button and dropdown option buttons, and attach GSAP event handlers (`onPointerDown`, `onPointerUp`, `onPointerLeave`) for haptic spring-back using `HAPTIC_PRESS_SCALE`.
6. Update `KineticDock.tsx`:
   - Ensure `updateIndicatorPosition` is called precisely after first layout paint. Replace the simple `useLayoutEffect` call by queuing it with `requestAnimationFrame` to account for transformation-invariant offsets fully. Replace hardcoded magnetic values with constants from `interactions.ts`.
7. Run all project quality gates (`npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:coverage`, and `npm run build`) via `run_in_bash_session` to verify changes and ensure no regressions were introduced.
8. Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
