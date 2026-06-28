1. **dashboard/src/v2/components/layout/PageContainer.tsx**:
   - Update `PAGE_CONTAINER_WIDTH` from `max-w-[2400px]` to `max-w-[1600px] xl:max-w-[1800px]`.
   - Update `pageContainerPadding` presets to the following exact values:
     - `overview`: `"px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-12 md:py-24"`
     - `standard`: `"px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-24"`
     - `section`: `"px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-16"`
     - `stats`: `"px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-20"`
     - `settings`: `"px-4 sm:px-6 md:px-8 xl:px-12 py-16"`
     - `agents`: `"px-4 sm:px-6 md:px-8 lg:px-16 xl:px-20 py-14"`
     - `browser`: `"px-4 sm:px-6 md:px-8 py-6"`
     - `workbench`: `"px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-12"`
     - `chat`: `"px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-12"`
     - `sprintsEmpty`: `"px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-12"`

2. **dashboard/src/v2/components/layout/Sidebar.tsx**:
   - Modify the `aside` container's padding from `py-8` to `pt-8 pb-[max(2rem,env(safe-area-inset-bottom))]` to clear iOS/Android browser chrome safely.
   - Add `pb-28` to the `nav` container so the user can scroll the final navigation items above the 32-pixel bottom gradient.
   - Update the desktop minimized `Settings` tooltip (on line 226) and `Expand` tooltip (on line 254) to replace `whitespace-nowrap` with `max-w-[calc(100vw-6rem)] text-wrap break-words whitespace-normal` to ensure they don't cause page-level horizontal overflow on narrow windows.

3. **dashboard/src/v2/components/layout/NavItem.tsx**:
   - Update the desktop minimized tooltip (on line 45) to replace `whitespace-nowrap` with `max-w-[calc(100vw-6rem)] text-wrap break-words whitespace-normal` to prevent horizontal overflow.

4. **dashboard/src/v2/styles/globals.css**:
   - Add `html, body { min-height: 100dvh; }` inside the `@layer base` block to provide a mobile browser chrome safety rule.

5. **docs/dashboard/dashboard-guide.md**:
   - Append to the end of the file a paragraph documenting: "The PageContainer and Sidebar components use dynamic viewport-safe sizing (`dvh`) and `env(safe-area-inset-bottom)` to be resilient to mobile browser chrome and orientation changes. Padding scales smoothly across breakpoints (`sm`, `md`, `lg`, `xl`) to maximize readable content width on all devices."

6. **dashboard/tests/v2/components/Sidebar.accessibility.test.tsx**:
   - Add a new test case to `dashboard/tests/v2/components/Sidebar.accessibility.test.tsx` within the `describe("Sidebar Mobile Accessibility")` block verifying that the mobile sidebar allows internal scrolling by asserting the navigation element has the `overflow-y-auto` class:
     ```tsx
     it("should allow internal scroll and avoid browser chrome overlap", () => {
         render(<Sidebar isMobile={true} isOpen={true} onClose={() => {}} />);
         const aside = screen.getByRole("dialog", { name: /navigation menu/i });
         expect(aside).toHaveClass("overflow-y-auto");
     });
     ```

7. **Verification**: Run `pnpm run test:dashboard -- dashboard/tests/v2/components/Sidebar.accessibility.test.tsx` and `pnpm run typecheck:dashboard` to ensure tests and types pass.
8. **Pre-commit**: Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
