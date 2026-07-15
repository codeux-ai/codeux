import type { FunctionComponent } from "preact";
import { Layers3, ListChecks, ShieldCheck, Trash2 } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import type { ProjectSettings, SystemSettings, TechstackCatalogEntrySettings, TechstackItemSettings } from "../../../../types.js";
import { useDashboardI18n, type DashboardTranslate } from "../../../i18n/index.js";
import { settingsAgentsGuidanceMessages } from "../../../i18n/messages/settings-agents-guidance.js";
import { BUILTIN_CODE_UX_TECHSTACK_ID } from "../../../../../../src/repositories/settings-defaults.js";
import { ActionButton, NoticePanel } from "../SettingsSurface.js";
import { ActionFeedbackRegion } from "../../ui/ActionFeedbackRegion.js";
import { PillChoiceGroup, TextInput } from "../SettingsFormFields.js";
import { Row, SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";

const UNASSIGNED_VALUE = "__unassigned__";
const UNSPECIFIED_KIND_VALUE = "__unspecified__";
const TECHSTACK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

const isValidTechstackId = (value: string): boolean => TECHSTACK_ID_PATTERN.test(value.trim());

const createUniqueId = (entries: TechstackCatalogEntrySettings[], baseId: string): string => {
  const existingIds = new Set(entries.map((entry) => entry.id));
  if (!existingIds.has(baseId)) {
    return baseId;
  }
  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}`;
};

const entryIdError = (entry: TechstackCatalogEntrySettings, entries: TechstackCatalogEntrySettings[], translate: DashboardTranslate): string | undefined => {
  const id = entry.id.trim();
  if (!id) {
    return translate(settingsAgentsGuidanceMessages, "techStackIdRequired");
  }
  if (!isValidTechstackId(id)) {
    return translate(settingsAgentsGuidanceMessages, "guidanceIdPattern");
  }
  if (entries.some((candidate) => candidate !== entry && candidate.id.trim() === id)) {
    return translate(settingsAgentsGuidanceMessages, "techStackIdUnique");
  }
  return undefined;
};

const itemIdError = (item: TechstackItemSettings, items: TechstackItemSettings[], translate: DashboardTranslate): string | undefined => {
  const id = item.id.trim();
  if (!id) {
    return translate(settingsAgentsGuidanceMessages, "techItemIdRequired");
  }
  if (!isValidTechstackId(id)) {
    return translate(settingsAgentsGuidanceMessages, "guidanceIdPattern");
  }
  if (items.some((candidate) => candidate !== item && candidate.id.trim() === id)) {
    return translate(settingsAgentsGuidanceMessages, "techItemIdUnique");
  }
  return undefined;
};

const entryHasValidationError = (
  entry: TechstackCatalogEntrySettings,
  entries: TechstackCatalogEntrySettings[],
  translate: DashboardTranslate,
): boolean => Boolean(
  entryIdError(entry, entries, translate)
  || !entry.label.trim()
  || entry.items.length === 0
  || entry.items.some((item) => itemIdError(item, entry.items, translate) || !item.label.trim())
);

const updateCatalogEntry = (
  current: SystemSettings,
  entryId: string,
  recipe: (entry: TechstackCatalogEntrySettings) => TechstackCatalogEntrySettings,
): SystemSettings => {
  let nextEntryId = entryId;
  const entries = current.techstackCatalog.entries.map((entry) => {
    if (entry.id !== entryId) {
      return entry;
    }
    const nextEntry = recipe(entry);
    nextEntryId = nextEntry.id;
    return nextEntry;
  });

  return {
    ...current,
    techstackCatalog: {
      defaultTechstackId: current.techstackCatalog.defaultTechstackId === entryId
        ? nextEntryId
        : current.techstackCatalog.defaultTechstackId,
      entries,
    },
    defaults: {
      ...current.defaults,
      techstack: {
        ...current.defaults.techstack,
        selectedTechstackId: current.defaults.techstack.selectedTechstackId === entryId
          ? nextEntryId
          : current.defaults.techstack.selectedTechstackId,
      },
    },
  };
};

const updateCatalogItem = (
  current: SystemSettings,
  entryId: string,
  itemId: string,
  recipe: (item: TechstackItemSettings) => TechstackItemSettings,
): SystemSettings => updateCatalogEntry(current, entryId, (entry) => ({
  ...entry,
  items: entry.items.map((item) => item.id === itemId ? recipe(item) : item),
}));

const StackSummary: FunctionComponent<{ entry: TechstackCatalogEntrySettings; builtin: boolean; translate: DashboardTranslate }> = ({ entry, builtin, translate }) => (
  <div className="flex min-w-0 flex-col gap-2">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 break-words text-sm font-bold text-slate-800 dark:text-slate-100">{entry.label}</span>
      <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
        {entry.id}
      </span>
      {builtin ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-700 dark:text-signal-300">
          <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
          {translate(settingsAgentsGuidanceMessages, "techBuiltInBadge")}
        </span>
      ) : null}
    </div>
    <div className="flex flex-wrap gap-1.5">
      {entry.items.length > 0 ? entry.items.map((item) => (
        <span key={item.id} className="rounded-full border border-black/[0.06] bg-black/[0.025] px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
          {item.label}
        </span>
      )) : (
        <span className="text-xs font-semibold text-status-red">{translate(settingsAgentsGuidanceMessages, "techAddItemRequired")}</span>
      )}
    </div>
  </div>
);

const SystemTechstacks: FunctionComponent<{
  state: SettingsPageState;
  systemSettings: SystemSettings;
}> = ({ state, systemSettings }) => {
  const { translate } = useDashboardI18n();
  const { activeSaving, updateSystem } = state;
  const entries = systemSettings.techstackCatalog.entries;
  const defaultId = systemSettings.techstackCatalog.defaultTechstackId;
  const defaultMissing = !entries.some((entry) => entry.id === defaultId);
  const catalogHasValidationErrors = defaultMissing || entries.some((entry) => entryHasValidationError(entry, entries, translate));

  const addStack = (): void => {
    updateSystem((current) => {
      const id = createUniqueId(current.techstackCatalog.entries, "custom-stack");
      return {
        ...current,
        techstackCatalog: {
          ...current.techstackCatalog,
          entries: [
            ...current.techstackCatalog.entries,
            {
              id,
              label: "Custom Stack",
              items: [{ id: "primary-framework", label: "Primary framework" }],
            },
          ],
        },
      };
    });
  };

  const removeStack = (entryId: string): void => {
    if (entryId === BUILTIN_CODE_UX_TECHSTACK_ID) {
      return;
    }
    updateSystem((current) => {
      const entries = current.techstackCatalog.entries.filter((entry) => entry.id !== entryId);
      return {
        ...current,
        techstackCatalog: {
          defaultTechstackId: current.techstackCatalog.defaultTechstackId === entryId
            ? BUILTIN_CODE_UX_TECHSTACK_ID
            : current.techstackCatalog.defaultTechstackId,
          entries,
        },
        defaults: {
          ...current.defaults,
          techstack: {
            ...current.defaults.techstack,
            selectedTechstackId: current.defaults.techstack.selectedTechstackId === entryId
              ? null
              : current.defaults.techstack.selectedTechstackId,
          },
        },
      };
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionCard
        title={translate(settingsAgentsGuidanceMessages, "techCatalogTitle")}
        watermark="STK"
        helpId="techstacks"
        icon={<Layers3 strokeWidth={2.4} />}
        highlights={[
          { label: translate(settingsAgentsGuidanceMessages, "techStacks"), value: entries.length, tone: "active" },
          { label: translate(settingsAgentsGuidanceMessages, "techDefault"), value: entries.find((entry) => entry.id === defaultId)?.label ?? translate(settingsAgentsGuidanceMessages, "techMissing") },
          { label: translate(settingsAgentsGuidanceMessages, "techBuiltIn"), value: translate(settingsAgentsGuidanceMessages, "techProtected") },
        ]}
        actions={(
          <ActionButton
            label={translate(settingsAgentsGuidanceMessages, "techAddStack")}
            onClick={addStack}
            disabled={activeSaving}
            disabledReason={activeSaving ? translate(settingsAgentsGuidanceMessages, "waitForSave") : undefined}
          />
        )}
      >
        <Row label={translate(settingsAgentsGuidanceMessages, "techDefaultStack")} description={translate(settingsAgentsGuidanceMessages, "techDefaultDescription")}>
          <PillChoiceGroup
            value={defaultId}
            disabled={activeSaving}
            invalid={defaultMissing}
            forceValidation={defaultMissing}
            errorText={translate(settingsAgentsGuidanceMessages, "techDefaultError")}
            onChange={(value) => updateSystem((current) => ({
              ...current,
              techstackCatalog: {
                ...current.techstackCatalog,
                defaultTechstackId: value,
              },
            }))}
            options={entries.map((entry) => ({
              value: entry.id,
              label: entry.label,
              hint: entry.id === BUILTIN_CODE_UX_TECHSTACK_ID ? translate(settingsAgentsGuidanceMessages, "techProtectedHint") : entry.id,
            }))}
          />
        </Row>

        <ActionFeedbackRegion
          status={catalogHasValidationErrors ? "error" : "idle"}
          message={catalogHasValidationErrors ? translate(settingsAgentsGuidanceMessages, "techValidationSummary") : null}
          autoDismiss={false}
        />

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
          {entries.map((entry) => {
            const builtin = entry.id === BUILTIN_CODE_UX_TECHSTACK_ID;
            const idError = entryIdError(entry, entries, translate);
            const labelError = entry.label.trim() ? undefined : translate(settingsAgentsGuidanceMessages, "techStackNameRequired");
            const itemsError = entry.items.length > 0 ? undefined : translate(settingsAgentsGuidanceMessages, "techAddItemRequired");

            return (
              <section key={entry.id} className="flex min-w-0 flex-col gap-4 rounded-[1.35rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <StackSummary entry={entry} builtin={builtin} translate={translate} />
                  {!builtin ? (
                    <ActionButton
                      label={translate(settingsAgentsGuidanceMessages, "techRemoveStack", { label: entry.label || entry.id })}
                      tone="danger"
                      disabled={activeSaving}
                      disabledReason={activeSaving ? translate(settingsAgentsGuidanceMessages, "waitForSave") : undefined}
                      onClick={() => removeStack(entry.id)}
                    />
                  ) : null}
                </div>

                {builtin ? (
                  <NoticePanel title={translate(settingsAgentsGuidanceMessages, "techBuiltInTitle")} tone="success">
                    {translate(settingsAgentsGuidanceMessages, "techBuiltInBody")}
                  </NoticePanel>
                ) : (
                  <>
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                      <TextInput
                        value={entry.id}
                        mono
                        disabled={activeSaving}
                        invalid={Boolean(idError)}
                        forceValidation={Boolean(idError)}
                        errorText={idError}
                        helperText={translate(settingsAgentsGuidanceMessages, "techStackIdHelper")}
                        aria-label={translate(settingsAgentsGuidanceMessages, "techStackIdAria", { label: entry.label || entry.id })}
                        onChange={(value) => updateSystem((current) => updateCatalogEntry(current, entry.id, (currentEntry) => ({
                          ...currentEntry,
                          id: value,
                        })))}
                      />
                      <TextInput
                        value={entry.label}
                        disabled={activeSaving}
                        invalid={Boolean(labelError)}
                        forceValidation={Boolean(labelError)}
                        errorText={labelError}
                        helperText={translate(settingsAgentsGuidanceMessages, "techStackNameHelper")}
                        aria-label={translate(settingsAgentsGuidanceMessages, "techStackNameAria", { id: entry.id })}
                        onChange={(value) => updateSystem((current) => updateCatalogEntry(current, entry.id, (currentEntry) => ({
                          ...currentEntry,
                          label: value,
                        })))}
                      />
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">
                          <ListChecks className="h-3.5 w-3.5" strokeWidth={2.2} />
                          {translate(settingsAgentsGuidanceMessages, "techItems")}
                        </div>
                        <ActionButton
                          label={translate(settingsAgentsGuidanceMessages, "techAddItem")}
                          disabled={activeSaving}
                          disabledReason={activeSaving ? translate(settingsAgentsGuidanceMessages, "waitForSave") : undefined}
                          onClick={() => updateSystem((current) => updateCatalogEntry(current, entry.id, (currentEntry) => {
                            const id = createUniqueId(currentEntry.items.map((item) => ({ id: item.id, label: item.label, items: [] })), "technology");
                            return {
                              ...currentEntry,
                              items: [...currentEntry.items, { id, label: "Technology" }],
                            };
                          }))}
                        />
                      </div>
                      {itemsError ? <div className="text-xs font-semibold text-status-red" role="alert">{itemsError}</div> : null}
                      {entry.items.map((item) => {
                        const idError = itemIdError(item, entry.items, translate);
                        const labelError = item.label.trim() ? undefined : translate(settingsAgentsGuidanceMessages, "techItemNameRequired");
                        return (
                          <div key={item.id} className="grid gap-2 [grid-template-columns:minmax(min(100%,11rem),1fr)_minmax(min(100%,11rem),1fr)_auto] max-[720px]:grid-cols-1">
                            <TextInput
                              value={item.id}
                              mono
                              disabled={activeSaving}
                              invalid={Boolean(idError)}
                              forceValidation={Boolean(idError)}
                              errorText={idError}
                              helperText={translate(settingsAgentsGuidanceMessages, "techItemId")}
                              aria-label={translate(settingsAgentsGuidanceMessages, "techItemIdAria", { label: item.label || item.id })}
                              onChange={(value) => updateSystem((current) => updateCatalogItem(current, entry.id, item.id, (currentItem) => ({
                                ...currentItem,
                                id: value,
                              })))}
                            />
                            <TextInput
                              value={item.label}
                              disabled={activeSaving}
                              invalid={Boolean(labelError)}
                              forceValidation={Boolean(labelError)}
                              errorText={labelError}
                              helperText={translate(settingsAgentsGuidanceMessages, "techItemName")}
                              aria-label={translate(settingsAgentsGuidanceMessages, "techItemNameAria", { id: item.id })}
                              onChange={(value) => updateSystem((current) => updateCatalogItem(current, entry.id, item.id, (currentItem) => ({
                                ...currentItem,
                                label: value,
                              })))}
                            />
                            <button
                              type="button"
                              disabled={activeSaving}
                              aria-label={translate(settingsAgentsGuidanceMessages, "techRemoveItem", { label: item.label || item.id })}
                              title={activeSaving ? translate(settingsAgentsGuidanceMessages, "waitForSave") : undefined}
                              onClick={() => updateSystem((current) => updateCatalogEntry(current, entry.id, (currentEntry) => ({
                                ...currentEntry,
                                items: currentEntry.items.filter((candidate) => candidate.id !== item.id),
                              })))}
                              className="inline-flex min-h-[2.6rem] items-center justify-center rounded-xl border border-status-red/25 bg-status-red/[0.06] px-3 text-status-red transition-colors hover:bg-status-red/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2.2} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
};

const ProjectTechstacks: FunctionComponent<{
  state: SettingsPageState;
  projectSettings: ProjectSettings;
}> = ({ state, projectSettings }) => {
  const { translate } = useDashboardI18n();
  const {
    activeScope,
    activeSaving,
    projectSources,
    systemSettings,
    updateEditableSettings,
    getFieldReset,
  } = state;
  const entries = systemSettings?.techstackCatalog.entries ?? [];
  const selectedStackId = projectSettings.techstack.selectedTechstackId ?? UNASSIGNED_VALUE;
  const applicationKind = projectSettings.techstack.applicationKind ?? UNSPECIFIED_KIND_VALUE;
  const selectedStackMissing = projectSettings.techstack.selectedTechstackId
    ? !entries.some((entry) => entry.id === projectSettings.techstack.selectedTechstackId)
    : false;
  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes)
    ? translate(settingsAgentsGuidanceMessages, "projectOverride")
    : undefined;
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path)
    ? translate(settingsAgentsGuidanceMessages, "projectOverride")
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <SectionCard
        title={translate(settingsAgentsGuidanceMessages, "techProjectTitle")}
        watermark="PRJ"
        helpId="techstacks"
        badge={getBadge("techstack")}
        icon={<Layers3 strokeWidth={2.4} />}
        highlights={[
          { label: translate(settingsAgentsGuidanceMessages, "techStack"), value: entries.find((entry) => entry.id === selectedStackId)?.label ?? translate(settingsAgentsGuidanceMessages, "techUnassigned"), tone: selectedStackId === UNASSIGNED_VALUE ? "warning" : "active" },
          { label: translate(settingsAgentsGuidanceMessages, "techApplication"), value: applicationKind === UNSPECIFIED_KIND_VALUE ? translate(settingsAgentsGuidanceMessages, "techUnspecified") : applicationKind },
          { label: translate(settingsAgentsGuidanceMessages, "techCatalogChoices"), value: entries.length },
        ]}
      >
        <NoticePanel title={translate(settingsAgentsGuidanceMessages, "techImportedTitle")}>
          {translate(settingsAgentsGuidanceMessages, "techImportedBody")}
        </NoticePanel>
        <Row
          label={translate(settingsAgentsGuidanceMessages, "techSelectedLabel")}
          description={translate(settingsAgentsGuidanceMessages, "techSelectedDescription")}
          badge={getFieldBadge("techstack.selectedTechstackId")}
          onReset={getFieldReset("techstack.selectedTechstackId")}
        >
          <PillChoiceGroup
            value={selectedStackId}
            disabled={activeSaving}
            invalid={selectedStackMissing}
            forceValidation={selectedStackMissing}
            errorText={translate(settingsAgentsGuidanceMessages, "techSelectedMissing")}
            helperText={translate(settingsAgentsGuidanceMessages, "techUnassignedHelper")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              techstack: {
                ...current.techstack,
                selectedTechstackId: value === UNASSIGNED_VALUE ? null : value,
              },
            }))}
            options={[
              { value: UNASSIGNED_VALUE, label: translate(settingsAgentsGuidanceMessages, "techUnassigned"), hint: translate(settingsAgentsGuidanceMessages, "techUnassignedHint") },
              ...entries.map((entry) => ({
                value: entry.id,
                label: entry.label,
                hint: entry.items.map((item) => item.label).join(", ") || entry.id,
              })),
            ]}
          />
        </Row>
        <Row
          label={translate(settingsAgentsGuidanceMessages, "techApplicationKind")}
          description={translate(settingsAgentsGuidanceMessages, "techApplicationDescription")}
          badge={getFieldBadge("techstack.applicationKind")}
          onReset={getFieldReset("techstack.applicationKind")}
          last
        >
          <PillChoiceGroup
            value={applicationKind}
            disabled={activeSaving}
            helperText={translate(settingsAgentsGuidanceMessages, "techApplicationHelper")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              techstack: {
                ...current.techstack,
                applicationKind: value === "web" || value === "desktop" ? value : null,
              },
            }))}
            options={[
              { value: UNSPECIFIED_KIND_VALUE, label: translate(settingsAgentsGuidanceMessages, "techUnspecified"), hint: translate(settingsAgentsGuidanceMessages, "techUnspecifiedHint") },
              { value: "web", label: translate(settingsAgentsGuidanceMessages, "techWebApp"), hint: translate(settingsAgentsGuidanceMessages, "techWebHint") },
              { value: "desktop", label: translate(settingsAgentsGuidanceMessages, "techDesktopApp"), hint: translate(settingsAgentsGuidanceMessages, "techDesktopHint") },
            ]}
          />
        </Row>
      </SectionCard>
    </div>
  );
};

export const SettingsTechstacksPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { translate } = useDashboardI18n();
  const { activeScope, projectSettings, selectedProject, systemSettings } = state;

  if (!systemSettings) {
    return null;
  }

  if (activeScope === "system") {
    return <SystemTechstacks state={state} systemSettings={systemSettings} />;
  }

  if (!selectedProject || !projectSettings) {
    return (
      <NoticePanel title={translate(settingsAgentsGuidanceMessages, "techProjectUnavailable")}>
        {translate(settingsAgentsGuidanceMessages, "techSelectProject")}
      </NoticePanel>
    );
  }

  return <ProjectTechstacks state={state} projectSettings={projectSettings} />;
};
