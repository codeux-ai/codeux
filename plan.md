1. **Refactor NavItem out of Sidebar.tsx**
   - Extract the navigation item logic into `dashboard/src/v2/components/layout/NavItem.tsx` to keep the code modular and clean.
2. **Update Sidebar Background**
   - In `dashboard/src/v2/components/layout/Sidebar.tsx`, update the main `aside` container's `bg-[#F5F3EF]/60` class to `bg-slate-50` for a distinct, very subtle off-white/gray tint in Light Mode.
   - Update the bottom gradient `from-[#F5F3EF]` to `from-slate-50`.
   - Update mobile background `bg-[#F5F3EF]` to `bg-slate-50`.
3. **Update NavItem Active State**
   - In `NavItem.tsx`, change the active background wash from `bg-signal-500/[0.10]` to `bg-signal-500/[0.15]` (or similar) to make it a stronger visual indicator, while keeping it soft.
   - Update the text color in light mode from `text-slate-900` to `text-signal-700` (or `text-signal-600`) to use the primary color text.
4. **Update Settings Link**
   - Also update the "Settings" link in `Sidebar.tsx` to match the new `NavItem` pattern or extract it to use `NavItem`.
5. **Run tests & quality gates**
   - Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run test:coverage`, and `pnpm run build` to ensure the refactor is solid.
6. **Pre-commit checks**
   - Complete pre commit steps to make sure proper testing, verifications, reviews and reflections are done.
7. **Submit the change.**
   - Submit the branch with descriptive commit message.
