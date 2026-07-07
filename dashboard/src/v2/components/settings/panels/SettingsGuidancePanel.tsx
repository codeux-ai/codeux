import type { FunctionComponent } from "preact";
import { Code2, Palette, ShieldCheck, Trash2 } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import type { DesignGuidanceEntrySettings, DesignGuidanceSettings } from "../../../../types.js";
import { DESIGN_GUIDANCE_NONE_ID } from "../../../../../../src/domain/settings/design-guidance-catalog.js";
import {
  createDesignGuidanceCustomEntry,
  getAllDesignGuidanceEntries,
  getCustomDesignGuidanceEntries,
  getDesignGuidanceActiveLabel,
  getDesignGuidanceSelectedId,
  getVisibleDesignGuidanceEntries,
  hasDesignGuidanceValidationErrors,
  isSelectedDefaultStyleguideHidden,
  validateDesignGuidanceCustomEntry,
  type DesignGuidanceEntryKind,
} from "../../../lib/settings-view-models.js";
import { ActionButton, NoticePanel } from "../SettingsSurface.js";
import { SelectInput, TextAreaInput, TextInput, Toggle } from "../SettingsFormFields.js";
import { ActionFeedbackRegion } from "../../ui/ActionFeedbackRegion.js";
import { Row, SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";

const KIND_COPY: Record<DesignGuidanceEntryKind, {
  title: string;
  customTitle: string;
  selectorLabel: string;
  selectorDescription: string;
  emptyTitle: string;
  emptyBody: string;
}> = {
  techStack: {
    title: "Tech Stack",
    customTitle: "Custom tech stack guidance",
    selectorLabel: "Active tech stack guidance",
    selectorDescription: "Choose extra implementation guidance for the active settings scope, or clear it to None.",
    emptyTitle: "No custom tech stack guidance",
    emptyBody: "Add a custom entry when the built-in tech stack guidance does not fit this scope.",
  },
  styleguide: {
    title: "Styleguide",
    customTitle: "Custom styleguides",
    selectorLabel: "Active styleguide",
    selectorDescription: "Choose visual and interaction guidance for the active settings scope, or clear it to None.",
    emptyTitle: "No custom styleguides",
    emptyBody: "Add a custom styleguide when the default styleguides do not match this product surface.",
  },
};

const getSelectedKey = (kind: DesignGuidanceEntryKind): keyof Pick<DesignGuidanceSettings, "selectedTechStackId" | "selectedStyleguideId"> => (
  kind === "techStack" ? "selectedTechStackId" : "selectedStyleguideId"
);

const withSelectedId = (
  guidance: DesignGuidanceSettings,
  kind: DesignGuidanceEntryKind,
  id: string,
): DesignGuidanceSettings => (
  kind === "techStack"
    ? { ...guidance, selectedTechStackId: id }
    : { ...guidance, selectedStyleguideId: id }
);

const withCustomEntries = (
  guidance: DesignGuidanceSettings,
  kind: DesignGuidanceEntryKind,
  entries: DesignGuidanceEntrySettings[],
): DesignGuidanceSettings => (
  kind === "techStack"
    ? { ...guidance, customTechStacks: entries }
    : { ...guidance, customStyleguides: entries }
);

const GuidanceEntryEditor: FunctionComponent<{
  kind: DesignGuidanceEntryKind;
  entry: DesignGuidanceEntrySettings;
  entries: DesignGuidanceEntrySettings[];
  index: number;
  disabled: boolean;
  onUpdate: (recipe: (entry: DesignGuidanceEntrySettings) => DesignGuidanceEntrySettings) => void;
  onDelete: () => void;
}> = ({ kind, entry, entries, index, disabled, onUpdate, onDelete }) => {
  const copy = KIND_COPY[kind];
  const validation = validateDesignGuidanceCustomEntry(entry, entries, kind, index);
  const label = entry.name.trim() || entry.id.trim() || `Custom ${copy.title}`;

  return (
    <section
      aria-label={`${copy.title} custom entry ${label}`}
      className="flex min-w-0 flex-col gap-4 rounded-[1.35rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 break-words text-sm font-bold text-slate-800 dark:text-slate-100">{label}</span>
            <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
              {entry.id || "missing-id"}
            </span>
          </div>
          <div className="mt-1 max-w-2xl break-words text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
            {entry.summary || "Add a concise summary so operators can recognize this guidance in selectors."}
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Delete ${label}`}
          title={disabled ? "Wait for the current settings save to finish." : undefined}
          onClick={onDelete}
          className="inline-flex min-h-[2.6rem] items-center justify-center rounded-xl border border-status-red/25 bg-status-red/[0.06] px-3 text-status-red transition-colors hover:bg-status-red/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-danger)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-void-900"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
        <TextInput
          value={entry.id}
          mono
          disabled={disabled}
          invalid={Boolean(validation.id)}
          forceValidation={Boolean(validation.id)}
          errorText={validation.id}
          helperText="Letters, numbers, underscores, or hyphens."
          aria-label={`${copy.title} guidance id for ${label}`}
          onChange={(value) => onUpdate((current) => ({ ...current, id: value }))}
        />
        <TextInput
          value={entry.name}
          disabled={disabled}
          invalid={Boolean(validation.name)}
          forceValidation={Boolean(validation.name)}
          errorText={validation.name}
          helperText="Human-readable selector label."
          aria-label={`${copy.title} guidance name for ${entry.id || label}`}
          onChange={(value) => onUpdate((current) => ({ ...current, name: value }))}
        />
        <TextInput
          value={entry.summary}
          disabled={disabled}
          invalid={Boolean(validation.summary)}
          forceValidation={Boolean(validation.summary)}
          errorText={validation.summary}
          helperText="Short selector summary."
          aria-label={`${copy.title} guidance summary for ${label}`}
          onChange={(value) => onUpdate((current) => ({ ...current, summary: value }))}
        />
      </div>
      <TextAreaInput
        value={entry.instructionMarkdown}
        rows={6}
        disabled={disabled}
        invalid={Boolean(validation.instructionMarkdown)}
        forceValidation={Boolean(validation.instructionMarkdown)}
        errorText={validation.instructionMarkdown}
        helperText="Markdown instructions appended to worker guidance when this entry is selected."
        aria-label={`${copy.title} instruction markdown for ${label}`}
        onChange={(value) => onUpdate((current) => ({ ...current, instructionMarkdown: value }))}
      />
    </section>
  );
};

const GuidanceManagementSection: FunctionComponent<{
  state: SettingsPageState;
  guidance: DesignGuidanceSettings;
  kind: DesignGuidanceEntryKind;
}> = ({ state, guidance, kind }) => {
  const copy = KIND_COPY[kind];
  const {
    activeSaving,
    activeScope,
    projectSources,
    updateEditableSettings,
    getFieldReset,
  } = state;
  const selectedId = getDesignGuidanceSelectedId(guidance, kind);
  const selectedVisible = getVisibleDesignGuidanceEntries(guidance, kind)
    .some((entry) => entry.id === selectedId);
  const selectedHiddenDefault = kind === "styleguide" && isSelectedDefaultStyleguideHidden(guidance);
  const customEntries = getCustomDesignGuidanceEntries(guidance, kind);
  const allEntries = getAllDesignGuidanceEntries(guidance, kind);
  const hasValidationErrors = hasDesignGuidanceValidationErrors(guidance, kind);
  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);
  const selectedPath = `designGuidance.${getSelectedKey(kind)}`;
  const customPath = kind === "techStack" ? "designGuidance.customTechStacks" : "designGuidance.customStyleguides";
  const Icon = kind === "techStack" ? Code2 : Palette;

  const updateGuidance = (recipe: (current: DesignGuidanceSettings) => DesignGuidanceSettings): void => {
    updateEditableSettings((current) => ({
      ...current,
      designGuidance: recipe(current.designGuidance),
    }));
  };

  const addEntry = (): void => {
    updateGuidance((current) => {
      const entry = createDesignGuidanceCustomEntry(current, kind);
      const entries = [...getCustomDesignGuidanceEntries(current, kind), entry];
      return withSelectedId(withCustomEntries(current, kind, entries), kind, entry.id);
    });
  };

  const updateEntry = (
    entryIndex: number,
    recipe: (entry: DesignGuidanceEntrySettings) => DesignGuidanceEntrySettings,
  ): void => {
    updateGuidance((current) => {
      const previousEntries = getCustomDesignGuidanceEntries(current, kind);
      const previousEntry = previousEntries[entryIndex];
      if (!previousEntry) {
        return current;
      }
      const nextEntries = previousEntries.map((entry, index) => (
        index === entryIndex ? recipe(entry) : entry
      ));
      const nextEntry = nextEntries[entryIndex]!;
      const selectedKey = getSelectedKey(kind);
      const nextGuidance = withCustomEntries(current, kind, nextEntries);
      return current[selectedKey] === previousEntry.id && nextEntry.id !== previousEntry.id
        ? withSelectedId(nextGuidance, kind, nextEntry.id)
        : nextGuidance;
    });
  };

  const deleteEntry = (entryIndex: number): void => {
    updateGuidance((current) => {
      const previousEntries = getCustomDesignGuidanceEntries(current, kind);
      const removedEntry = previousEntries[entryIndex];
      if (!removedEntry) {
        return current;
      }
      const nextEntries = previousEntries.filter((_, index) => index !== entryIndex);
      const nextGuidance = withCustomEntries(current, kind, nextEntries);
      return current[getSelectedKey(kind)] === removedEntry.id
        ? withSelectedId(nextGuidance, kind, DESIGN_GUIDANCE_NONE_ID)
        : nextGuidance;
    });
  };

  return (
    <SectionCard
      title={copy.title}
      watermark={kind === "techStack" ? "STK" : "STY"}
      helpId="guidance"
      badge={getBadge("designGuidance", selectedPath, customPath)}
      icon={<Icon strokeWidth={2.4} />}
      actions={(
        <ActionButton
          label={`Add ${copy.title}`}
          onClick={addEntry}
          disabled={activeSaving}
          disabledReason={activeSaving ? "Wait for the current settings save to finish." : undefined}
        />
      )}
    >
      <NoticePanel title="Built-ins are protected" tone="success">
        Built-in {copy.title.toLowerCase()} entries can be selected, but only custom entries can be edited or deleted.
      </NoticePanel>

      <Row
        label={copy.selectorLabel}
        description={copy.selectorDescription}
        badge={getFieldBadge(selectedPath)}
        onReset={getFieldReset(selectedPath)}
      >
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <SelectInput
              value={selectedVisible ? selectedId : ""}
              disabled={activeSaving}
              disabledReason={activeSaving ? "Wait for the current settings save to finish." : undefined}
              aria-label={copy.selectorLabel}
              onChange={(value) => updateGuidance((current) => withSelectedId(current, kind, value))}
              options={getVisibleDesignGuidanceEntries(guidance, kind).map((entry) => ({
                value: entry.id,
                label: entry.name,
              }))}
            />
            <ActionButton
              label="Clear"
              onClick={() => updateGuidance((current) => withSelectedId(current, kind, DESIGN_GUIDANCE_NONE_ID))}
              disabled={activeSaving || selectedId === DESIGN_GUIDANCE_NONE_ID}
              disabledReason={activeSaving ? "Wait for the current settings save to finish." : undefined}
            />
          </div>
          <div className="text-xs font-semibold leading-relaxed text-slate-500 dark:text-slate-400">
            Active: {getDesignGuidanceActiveLabel(guidance, kind)}
          </div>
          {selectedHiddenDefault ? (
            <NoticePanel title="Default styleguide hidden" tone="warning">
              The selected default styleguide is preserved, but hidden from the selector while default styleguides are hidden. Choose None, a custom styleguide, or turn defaults back on to change it here.
            </NoticePanel>
          ) : null}
          {!selectedVisible && !selectedHiddenDefault ? (
            <ActionFeedbackRegion
              status="error"
              message={`The selected ${copy.title.toLowerCase()} id is not available in this scope.`}
              autoDismiss={false}
            />
          ) : null}
        </div>
      </Row>

      {kind === "styleguide" ? (
        <Row
          label="Hide default styleguides"
          description="Hide built-in styleguides from the selector while keeping None and custom styleguides available."
          badge={getFieldBadge("designGuidance.hideDefaultStyleguides")}
          onReset={getFieldReset("designGuidance.hideDefaultStyleguides")}
        >
          <Toggle
            value={guidance.hideDefaultStyleguides}
            disabled={activeSaving}
            aria-label="Hide default styleguides"
            onChange={(value) => updateGuidance((current) => ({
              ...current,
              hideDefaultStyleguides: value,
            }))}
          />
        </Row>
      ) : null}

      <div className="flex min-w-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">
        <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.2} />
        {copy.customTitle}
        <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-0.5 text-[9px] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04]">
          {customEntries.length} custom / {allEntries.length} total
        </span>
      </div>

      <ActionFeedbackRegion
        status={hasValidationErrors ? "error" : "idle"}
        message={hasValidationErrors ? `Fix the highlighted ${copy.title.toLowerCase()} ids, names, summaries, or instructions before saving.` : null}
        autoDismiss={false}
      />

      {customEntries.length === 0 ? (
        <NoticePanel title={copy.emptyTitle}>
          {copy.emptyBody}
        </NoticePanel>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,23rem),1fr))]">
          {customEntries.map((entry, index) => (
            <GuidanceEntryEditor
              key={`${entry.id}-${index}`}
              kind={kind}
              entry={entry}
              entries={customEntries}
              index={index}
              disabled={activeSaving}
              onUpdate={(recipe) => updateEntry(index, recipe)}
              onDelete={() => deleteEntry(index)}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
};

export const SettingsGuidancePanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { activeScope, editableSettings, selectedProject } = state;

  if (activeScope === "project" && !selectedProject) {
    return (
      <NoticePanel title="Project scope unavailable">
        Select a project first to manage project-specific guidance.
      </NoticePanel>
    );
  }

  if (!editableSettings) {
    return null;
  }

  const guidance = editableSettings.designGuidance;

  return (
    <div className="flex flex-col gap-5">
      <GuidanceManagementSection state={state} guidance={guidance} kind="techStack" />
      <GuidanceManagementSection state={state} guidance={guidance} kind="styleguide" />
    </div>
  );
};
