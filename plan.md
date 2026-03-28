1. **Add `defaultSprintKey` to GitSettings**
   - File: `src/contracts/app-types.ts`
   - Action: Add `defaultSprintKey: string;` to `GitSettings`.

2. **Update default settings**
   - File: `src/repositories/settings-defaults.ts`
   - Action: Add `defaultSprintKey: "SPR"` to `DEFAULT_DASHBOARD_SETTINGS.git`.

3. **Update settings schema validation**
   - File: `src/domain/settings/settings-schema.ts`
   - Action: Add a validation for `defaultSprintKey` in `validateGitSettings`.

4. **Update settings sanitizer**
   - File: `src/domain/settings/settings-sanitizers/git-sanitizer.ts`
   - Action: Add `defaultSprintKey` logic to `sanitizeGit`, defaulting to `DEFAULT_DASHBOARD_SETTINGS.git.defaultSprintKey`.

5. **Update test cases**
   - Action: Find tests covering git-sanitizer and add checks for `defaultSprintKey`.

6. **Update dashboard/src/v2/components/settings/ProjectSettingsEditor.tsx**
   - File: `dashboard/src/v2/components/settings/ProjectSettingsEditor.tsx`
   - Action: Add a new `<Row>` below "Sprint branch scheme" for "Default sprint key".
   - Bind this field to `settings.git.defaultSprintKey`.
   - The label should be "Default sprint key" and description: "Prefix used for new sprints, e.g., 'SPR' or 'DEV'."

7. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**
