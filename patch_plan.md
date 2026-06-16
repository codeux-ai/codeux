# Plan

1. Modify `FieldWrapper` (`dashboard/src/v2/components/forms/FieldWrapper.tsx`):
- Add optional `helperTextId` prop to support description linking.
- Ensure `required` indicator provides a screen reader accessible text (currently it adds `<span class="sr-only">(required)</span>`).
- Support stable `id` even without `htmlFor`. We can use `useId()` and link everything with `aria-describedby` or `aria-errormessage`.
- Currently, `aria-errormessage` is conditionally added to the cloned child. Ensure this is robust.

2. Modify `AddProjectModal` (`dashboard/src/v2/components/ui/AddProjectModal.tsx`):
- For "Project Name" field: Add `autocomplete="off"` to explicitly disable generic autocomplete (as it's misleading). Add `aria-invalid`, `aria-describedby` or `aria-errormessage`. Add screen-reader text for required fields or just use `FieldWrapper`. (Actually, `AddProjectModal` doesn't use `FieldWrapper`, it defines custom form markup).
- We'll update the custom markup in `AddProjectModal` directly to use `FormError` for inline errors (e.g. `validationErrors.name`, `validationErrors.path`) rather than `div` with simple text.
- Ensure inline errors are linked via `aria-errormessage` or `aria-describedby` and the inputs have stable ids.
- Update required indicators (e.g., adding visually hidden "(required)" text or aria-required).
- Add `autocomplete` to `gitUrl`, `localPath`, `cloneDir`. Set to "url" or "off" depending on appropriateness.
- Add `role="alert"` for the main `submitError` and directory picker errors, ensuring they can be announced. The main error already has `role="alert"`, so we will check the directory picker error.
- Check source type fieldset and legend to ensure accessibility.
- Update `directoryPickerError` to have `role="alert"`.

3. Create Tests:
- `dashboard/tests/v2/components/AddProjectModal.accessibility.test.tsx`
- `dashboard/tests/v2/components/FieldWrapper.test.tsx`

4. Run `npm run typecheck` and `npm run test` as the pre-commit step.
