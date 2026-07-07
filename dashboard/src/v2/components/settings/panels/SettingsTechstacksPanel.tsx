import type { FunctionComponent } from "preact";
import { Layers3, ListChecks, ShieldCheck, Trash2 } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import type { ProjectSettings, SystemSettings, TechstackCatalogEntrySettings, TechstackItemSettings } from "../../../../types.js";
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

const entryIdError = (entry: TechstackCatalogEntrySettings, entries: TechstackCatalogEntrySettings[]): string | undefined => {
  const id = entry.id.trim();
  if (!id) {
    return "Stack id is required.";
  }
  if (!isValidTechstackId(id)) {
    return "Use letters, numbers, underscores, or hyphens, up to 80 characters.";
  }
  if (entries.some((candidate) => candidate !== entry && candidate.id.trim() === id)) {
    return "Stack id must be unique.";
  }
  return undefined;
};

const itemIdError = (item: TechstackItemSettings, items: TechstackItemSettings[]): string | undefined => {
  const id = item.id.trim();
  if (!id) {
    return "Item id is required.";
  }
  if (!isValidTechstackId(id)) {
    return "Use letters, numbers, underscores, or hyphens, up to 80 characters.";
  }
  if (items.some((candidate) => candidate !== item && candidate.id.trim() === id)) {
    return "Item id must be unique in this stack.";
  }
  return undefined;
};

const entryHasValidationError = (
  entry: TechstackCatalogEntrySettings,
  entries: TechstackCatalogEntrySettings[],
): boolean => Boolean(
  entryIdError(entry, entries)
  || !entry.label.trim()
  || entry.items.length === 0
  || entry.items.some((item) => itemIdError(item, entry.items) || !item.label.trim())
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

const StackSummary: FunctionComponent<{ entry: TechstackCatalogEntrySettings; builtin: boolean }> = ({ entry, builtin }) => (
  <div className="flex min-w-0 flex-col gap-2">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 break-words text-sm font-bold text-slate-800 dark:text-slate-100">{entry.label}</span>
      <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
        {entry.id}
      </span>
      {builtin ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-700 dark:text-signal-300">
          <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
          Built-in
        </span>
      ) : null}
    </div>
    <div className="flex flex-wrap gap-1.5">
      {entry.items.length > 0 ? entry.items.map((item) => (
        <span key={item.id} className="rounded-full border border-black/[0.06] bg-black/[0.025] px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
          {item.label}
        </span>
      )) : (
        <span className="text-xs font-semibold text-status-red">Add at least one technology item.</span>
      )}
    </div>
  </div>
);

const SystemTechstacks: FunctionComponent<{
  state: SettingsPageState;
  systemSettings: SystemSettings;
}> = ({ state, systemSettings }) => {
  const { activeSaving, updateSystem } = state;
  const entries = systemSettings.techstackCatalog.entries;
  const defaultId = systemSettings.techstackCatalog.defaultTechstackId;
  const defaultMissing = !entries.some((entry) => entry.id === defaultId);
  const catalogHasValidationErrors = defaultMissing || entries.some((entry) => entryHasValidationError(entry, entries));

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
        title="Techstacks Catalog"
        watermark="STK"
        helpId="techstacks"
        icon={<Layers3 strokeWidth={2.4} />}
        actions={(
          <ActionButton
            label="Add Stack"
            onClick={addStack}
            disabled={activeSaving}
            disabledReason={activeSaving ? "Wait for the current settings save to finish." : undefined}
          />
        )}
      >
        <Row label="Default stack" description="The catalog default is available to project setup flows, but imported projects stay unassigned until a stack is selected or detected.">
          <PillChoiceGroup
            value={defaultId}
            disabled={activeSaving}
            invalid={defaultMissing}
            forceValidation={defaultMissing}
            errorText="Choose an existing catalog entry as the default stack."
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
              hint: entry.id === BUILTIN_CODE_UX_TECHSTACK_ID ? "Protected built-in stack." : entry.id,
            }))}
          />
        </Row>

        <ActionFeedbackRegion
          status={catalogHasValidationErrors ? "error" : "idle"}
          message={catalogHasValidationErrors ? "Fix the highlighted techstack ids, names, or items before saving the catalog." : null}
          autoDismiss={false}
        />

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
          {entries.map((entry) => {
            const builtin = entry.id === BUILTIN_CODE_UX_TECHSTACK_ID;
            const idError = entryIdError(entry, entries);
            const labelError = entry.label.trim() ? undefined : "Stack name is required.";
            const itemsError = entry.items.length > 0 ? undefined : "Add at least one technology item.";

            return (
              <section key={entry.id} className="flex min-w-0 flex-col gap-4 rounded-[1.35rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <StackSummary entry={entry} builtin={builtin} />
                  {!builtin ? (
                    <ActionButton
                      label={`Remove ${entry.label || entry.id}`}
                      tone="danger"
                      disabled={activeSaving}
                      disabledReason={activeSaving ? "Wait for the current settings save to finish." : undefined}
                      onClick={() => removeStack(entry.id)}
                    />
                  ) : null}
                </div>

                {builtin ? (
                  <NoticePanel title="Built-in stack protected" tone="success">
                    The Code UX Stack is restored by settings normalization and cannot be edited or removed.
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
                        helperText="Letters, numbers, underscores, or hyphens."
                        aria-label={`Stack id for ${entry.label || entry.id}`}
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
                        helperText="Human-readable catalog name."
                        aria-label={`Stack name for ${entry.id}`}
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
                          Tech items
                        </div>
                        <ActionButton
                          label="Add Item"
                          disabled={activeSaving}
                          disabledReason={activeSaving ? "Wait for the current settings save to finish." : undefined}
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
                        const idError = itemIdError(item, entry.items);
                        const labelError = item.label.trim() ? undefined : "Item name is required.";
                        return (
                          <div key={item.id} className="grid gap-2 [grid-template-columns:minmax(min(100%,11rem),1fr)_minmax(min(100%,11rem),1fr)_auto] max-[720px]:grid-cols-1">
                            <TextInput
                              value={item.id}
                              mono
                              disabled={activeSaving}
                              invalid={Boolean(idError)}
                              forceValidation={Boolean(idError)}
                              errorText={idError}
                              helperText="Item id"
                              aria-label={`Tech item id for ${item.label || item.id}`}
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
                              helperText="Item name"
                              aria-label={`Tech item name for ${item.id}`}
                              onChange={(value) => updateSystem((current) => updateCatalogItem(current, entry.id, item.id, (currentItem) => ({
                                ...currentItem,
                                label: value,
                              })))}
                            />
                            <button
                              type="button"
                              disabled={activeSaving}
                              aria-label={`Remove ${item.label || item.id}`}
                              title={activeSaving ? "Wait for the current settings save to finish." : undefined}
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
  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Project Techstack" watermark="PRJ" helpId="techstacks" badge={getBadge("techstack")} icon={<Layers3 strokeWidth={2.4} />}>
        <NoticePanel title="Imported projects stay unassigned">
          Existing and imported projects keep `Unassigned` until you select a stack here or a setup/package scan detects one later.
        </NoticePanel>
        <Row
          label="Selected techstack"
          description="Assign a catalog stack to this project, or clear it back to Unassigned."
          badge={getFieldBadge("techstack.selectedTechstackId")}
          onReset={getFieldReset("techstack.selectedTechstackId")}
        >
          <PillChoiceGroup
            value={selectedStackId}
            disabled={activeSaving}
            invalid={selectedStackMissing}
            forceValidation={selectedStackMissing}
            errorText="The selected stack is not in the system catalog."
            helperText="Unassigned means Code UX will not classify this project by techstack yet."
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              techstack: {
                ...current.techstack,
                selectedTechstackId: value === UNASSIGNED_VALUE ? null : value,
              },
            }))}
            options={[
              { value: UNASSIGNED_VALUE, label: "Unassigned", hint: "Leave imported or unknown projects unclassified." },
              ...entries.map((entry) => ({
                value: entry.id,
                label: entry.label,
                hint: entry.items.map((item) => item.label).join(", ") || entry.id,
              })),
            ]}
          />
        </Row>
        <Row
          label="Application kind"
          description="Classify the project runtime shape for setup hints and future package-scan behavior."
          badge={getFieldBadge("techstack.applicationKind")}
          onReset={getFieldReset("techstack.applicationKind")}
          last
        >
          <PillChoiceGroup
            value={applicationKind}
            disabled={activeSaving}
            helperText="Use Unspecified until the project is known to be a browser/web app or desktop app."
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              techstack: {
                ...current.techstack,
                applicationKind: value === "web" || value === "desktop" ? value : null,
              },
            }))}
            options={[
              { value: UNSPECIFIED_KIND_VALUE, label: "Unspecified", hint: "No app-kind classification yet." },
              { value: "web", label: "Web app", hint: "Browser or hosted web runtime." },
              { value: "desktop", label: "Desktop app", hint: "Electron or desktop-shell runtime." },
            ]}
          />
        </Row>
      </SectionCard>
    </div>
  );
};

export const SettingsTechstacksPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { activeScope, projectSettings, selectedProject, systemSettings } = state;

  if (!systemSettings) {
    return null;
  }

  if (activeScope === "system") {
    return <SystemTechstacks state={state} systemSettings={systemSettings} />;
  }

  if (!selectedProject || !projectSettings) {
    return (
      <NoticePanel title="Project scope unavailable">
        Select a project first to assign or clear its techstack.
      </NoticePanel>
    );
  }

  return <ProjectTechstacks state={state} projectSettings={projectSettings} />;
};
