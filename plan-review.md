Plan:
1. Modify `dashboard/src/v2/components/ui/CollapsiblePanel.tsx`
   - Import `useId` from `preact/hooks`.
   - Call `useId()` to generate a unique string `contentId`.
   - In the trigger `<button>`, add `aria-expanded={open}` and `aria-controls={contentId}` attributes.
   - Remove the `gsap` animation block (`useLayoutEffect` that controls `height` and `opacity` via `gsap.killTweensOf`, `gsap.set`, `gsap.to`) and the associated `initialMountRef` and `reducedMotion` dependencies since we are replacing it with CSS animations.
   - Remove `useReducedMotion` and `MODAL_MOTION` imports if they are no longer used.
   - Change the wrapper `div` around the content from `<div ref={contentRef}>` to `<div id={contentId} className={`collapsible-section ${open ? "open" : ""}`}>`.
   - Update the inner content `div` to have `className="collapsible-content relative z-10 px-5 pb-5 pt-0"`.

2. Modify `dashboard/src/styles.css`
   - In `.collapsible-content`, add `min-height: 0;` alongside existing properties (`overflow: hidden; opacity: 0; transform: translateY(-4px); transition: ...;`) to ensure the grid template rows animation doesn't clip or leave a permanent height gap during rapid toggling.

3. Modify `tests/dashboard/v2/ui-components.test.tsx`
   - Add a test that renders `CollapsiblePanel` with a fake icon and content.
   - Use `@testing-library/preact` queries to find the trigger `<button>` by role "button" and name/text content matching the title.
   - Verify the button has `aria-expanded="false"`.
   - Use `fireEvent.keyDown` on the button with `{ key: "Enter" }` to toggle state.
   - Verify the button has `aria-expanded="true"`.
   - Use `fireEvent.keyDown` on the button again with `{ key: "Space" }` to toggle state.
   - Verify the button has `aria-expanded="false"`.

4. Run validations
   - Run `npm run lint` and `npm run typecheck`
   - Run `npm run test:dashboard -- tests/dashboard/v2/ui-components.test.tsx`
   - Run `npm run build`

5. Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
6. Submit the change.
