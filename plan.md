1. **Apply T01 interaction tokens to settings controls**
   - Update `SettingsCategoryRail` clickable categories with `SHARED_INTERACTION_CLASSES`.
   - Update `SettingsFormFields.tsx` (specifically `PillChoiceGroup`, `TextInput`, `TextAreaInput`, and `NumberInput`) to use `SHARED_INTERACTION_CLASSES` and T01 validation reveal styles (`aria-[invalid=true]:...` and `data-[valid=true]:...`).
2. **Improve category rail keyboard behavior and accessibility semantics**
   - Set `aria-current="page"` for the active category in `SettingsCategoryRail.tsx`.
3. **Enhance state clarity and feedback (T04)**
   - Update `SettingsPage.tsx` to use `ActionFeedbackRegion` for saving and error states (which has proper aria semantics and motion). Include dismissal callback logic via `clearFeedback` in `use-settings-page-state.ts`.
   - Update `NoticePanel` in `SettingsSurface.tsx` to add `error` and `pending` tones, using `lucide-preact` icons matching `ActionFeedbackRegion`'s style and classes. Add proper `role` and `aria-live`.
   - Update `ActionButton` in `SettingsSurface.tsx` to include additional `tone` mapping logic for `success` and `warning` with matching box shadows.
4. **Testing Step**
   - Run Vitest locally on settings tests: `pnpm exec vitest run dashboard/src/v2/components/settings/__tests__/SettingsControls.test.tsx dashboard/tests/v2/components/FieldWrapper.test.tsx`.
5. **Typecheck Step**
   - Run local type checker using `pnpm run typecheck:dashboard`.
6. **Pre-commit Checks**
   - Call the `pre_commit_instructions` tool to make sure proper testing, verifications, and reflections are performed prior to submit.
7. **Submit Changes**
   - `submit` the changes with a concise commit message detailing the update.
