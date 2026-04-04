1. **Create the `useTooltip` hook**
   - File: `dashboard/src/v2/hooks/useTooltip.ts`
   - Description: Implement a hook that manages the tooltip state (open/closed, position coordinates) and GSAP animations.
   - Behavior:
     - Track a target element reference and use `getBoundingClientRect` to position a portal-based tooltip.
     - Accept a slight 150ms delay for hover-in. Zero delay for hover-out.
     - Trigger `gsap.to()` on hover in (using `back.out(1.7)` easing for a spring effect) and a quick fade out on hover out.
     - Include logic to calculate coordinates so the tooltip stays within window boundaries.

2. **Implement a generic `Tooltip` component**
   - File: `dashboard/src/v2/components/ui/Tooltip.tsx`
   - Description: A portal-rendered component driven by `useTooltip`.
   - Behavior: Renders the tooltip UI, receives state from the hook, handles ARIA attributes, and positions itself using absolute coordinates against the viewport.

3. **Refactor `IconButton.tsx` to use the new `Tooltip` component**
   - File: `dashboard/src/v2/components/IconButton.tsx`
   - Description: Instead of using standard `title` attributes on the button, wrap or attach the `Tooltip` component when the `title` prop is present. Ensure backwards compatibility with `aria-label` logic.

4. **Refactor `TopNav.tsx` generic buttons with standard tooltips**
   - File: `dashboard/src/v2/components/TopNav.tsx`
   - Description: Ensure standard buttons that use native `title` (or implicit tooltips) transition to `Tooltip` usage. Actually, checking the codebase, IconButton instances using `title` will automatically inherit the update. For other native elements with title (like the preview browser buttons or theme toggles in TopNav), replace native title attributes with the custom Tooltip or wrapped IconButton.
   - Specific update: In TopNav, ensure Theme Toggle and Notification buttons use `Tooltip` or `IconButton`.

5. **Pre-commit Steps**
   - Description: Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
