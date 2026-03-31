1. **Extract `useSettingsPageState` Hook**:
    - Create `dashboard/src/v2/hooks/use-settings-page-state.ts`.
    - Move types `SettingsScope`, `CategoryId`, `AgentInstructionTemplateId`, `IntegrationId`, `Category`, `IntegrationDefinition`, `CATEGORIES`, `CATEGORY_SEARCH_HINTS`, `providerLabels`, `thinkingModeOptions`, `invocationRouteDefinitions`, `routingProfileOptions`, `INTEGRATIONS`, `AGENT_INSTRUCTION_TEMPLATE_OPTIONS` from `SettingsPage.tsx` or expose them so they can be imported.
    - Extract state management (useState calls, useEffect hooks for fetching/saving/resetting settings, and calculated values like `filteredCategories`) into `useSettingsPageState` hook.
    - Return a comprehensive object exposing the state, computed values, and action handlers.

2. **Extract `SettingsCategoryRail` Component**:
    - Create `dashboard/src/v2/components/settings/SettingsCategoryRail.tsx`.
    - Accept props for `categories`, `filteredCategories`, `activeCategory`, `settingsSearch`, `onSearchChange`, `onCategoryChange`.
    - Move the sticky sidebar rendering code from `SettingsPage.tsx` into this component.

3. **Extract `SettingsContentPanels` Component**:
    - Create `dashboard/src/v2/components/settings/SettingsContentPanels.tsx`.
    - Accept props for all necessary state and handlers to render the active category's content panel.
    - Move the `renderContent`, `renderGeneralSection`, etc., and `IntegrationConfigRow`, `SectionCard` from `SettingsPage.tsx` or keep `SectionCard` in `SettingsSurface.tsx` if it's there. Actually, `SectionCard` and `IntegrationConfigRow` are defined in `SettingsPage.tsx` and should be moved or exported. We'll likely move them to `SettingsContentPanels.tsx` or export them. The requirement mentions `SettingsSurface.tsx`, maybe `SectionCard` belongs there? Let's check `SettingsSurface.tsx`.

4. **Update `SettingsSurface.tsx`**:
    - Move `SectionCard` and `IntegrationConfigRow` to `SettingsSurface.tsx` if they fit as generic layout surfaces for settings, or keep them local to panels if they are highly specific. The prompt mentions `- dashboard/src/v2/components/settings/SettingsSurface.tsx`.

5. **Refactor `SettingsPage.tsx`**:
    - Import the new hook `useSettingsPageState`.
    - Import `SettingsCategoryRail` and `SettingsContentPanels`.
    - Re-wire the component to be a thin wrapper around these extracted parts.

6. **Add Tests**:
    - Update/Create `tests/dashboard/v2/settings-page-state.test.tsx` to verify the state transitions, filtering, and hook behavior.
    - Run `npm run lint`, `npm run typecheck:dashboard`, `npm run test`, `npm run build`.

7. **Submit**:
    - Commit pre-commit steps and submit.
