import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import type { MemoryClearTier } from "../../../lib/memory-api.js";
import { ActionButton } from "../SettingsSurface.js";
import { useConfirmDialog } from "../../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../../ui/ConfirmDialog.js";
import { Row } from "../SettingsFormFields.js";
import { SectionCard } from "./SharedPanelComponents.js";
import { AlertTriangle, Database, BrainCircuit } from "lucide-preact";
import { useSettingsOperationsTranslations, type SettingsOperationsTranslate } from "../../../i18n/messages/settings-operations.js";

interface MemoryClearOption {
  tier: MemoryClearTier;
  label: string;
  rowLabel: string;
  description: string;
  confirmBody: string;
}

const PROJECT_MEMORY_OPTIONS = (projectName: string, t: SettingsOperationsTranslate): MemoryClearOption[] => [
  {
    tier: "short_term",
    label: t("Clear Short-Term"),
    rowLabel: t("Short-Term"),
    description: t("Delete per-sprint, per-agent working memories. Long-term knowledge is kept."),
    confirmBody: t("Delete all short-term (sprint) memories for \"{projectName}\"? Long-term memories and claims are kept. This cannot be undone.", { projectName }),
  },
  {
    tier: "long_term",
    label: t("Clear Long-Term"),
    rowLabel: t("Long-Term"),
    description: t("Delete promoted project memories plus all memory claims and evidence."),
    confirmBody: t("Delete all long-term (project) memories, claims, and evidence for \"{projectName}\"? Short-term memories are kept. This cannot be undone.", { projectName }),
  },
  {
    tier: "all",
    label: t("Clear All Memory"),
    rowLabel: t("All Memory"),
    description: t("Delete every memory, claim, and evidence record for this project."),
    confirmBody: t("Delete the entire memory database for \"{projectName}\" — every memory, claim, and piece of evidence? This cannot be undone.", { projectName }),
  },
];

const getSystemMemoryOptions = (t: SettingsOperationsTranslate): MemoryClearOption[] => [
  {
    tier: "short_term",
    label: t("Clear Short-Term"),
    rowLabel: t("Short-Term"),
    description: t("Delete per-sprint, per-agent working memories across every project."),
    confirmBody: t("Delete all short-term (sprint) memories across every project? Long-term memories and claims are kept. This cannot be undone."),
  },
  {
    tier: "long_term",
    label: t("Clear Long-Term"),
    rowLabel: t("Long-Term"),
    description: t("Delete promoted project memories plus all claims and evidence across every project."),
    confirmBody: t("Delete all long-term (project) memories, claims, and evidence across every project? Short-term memories are kept. This cannot be undone."),
  },
  {
    tier: "all",
    label: t("Clear All Memory"),
    rowLabel: t("All Memory"),
    description: t("Delete every memory, claim, and evidence record across every project."),
    confirmBody: t("Delete the entire memory database — every memory, claim, and piece of evidence across every project? This cannot be undone."),
  },
];

export const SettingsDangerPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { t } = useSettingsOperationsTranslations();
  const {
    activeScope,
    selectedProject,
    resettingProject,
    deletingProject,
    resettingDatabase,
    memoryClearBusy,
    handleResetProject,
    handleDeleteProject,
    handleResetDatabase,
    handleClearMemory,
  } = state;
  const resetProjectConfirm = useConfirmDialog();
  const projectConfirm = useConfirmDialog();
  const dbConfirm = useConfirmDialog();
  const memoryConfirm = useConfirmDialog();

  const requestMemoryClear = (
    scope: "project" | "system",
    option: MemoryClearOption,
    title: string,
  ) => {
    void memoryConfirm.requestConfirm({
      title,
      body: option.confirmBody,
      confirmLabel: option.label,
      destructive: true,
    }).then((confirmed) => {
      if (confirmed) {
        void handleClearMemory(scope, option.tier);
      }
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <SectionCard
        title={t("Danger Zone")}
        watermark="DGR"
        danger
        icon={<AlertTriangle strokeWidth={2.4} />}
        highlights={[
          { label: t("Scope"), value: activeScope === "project" ? t("Selected project") : t("System"), tone: "warning" },
          { label: t("Project"), value: selectedProject ? t("Selected") : t("None") },
          { label: t("Confirmation"), value: t("Always required") },
        ]}
        configureLabel={t("Review destructive actions")}
      >
        {activeScope === "project" ? (
          <Row label={t("Reset project overrides")} description={t("Clear this project's saved settings overrides and inherit the current system defaults again. Project tasks, sprints, memories, and history are kept.")}>
            <ActionButton
              label={t("Reset Project")}
              onClick={() => resetProjectConfirm.requestConfirm({
                title: t("Reset Project Overrides"),
                body: t("Clear saved settings overrides for \"{projectName}\" and inherit system defaults again? Project tasks, sprints, memories, and history will be kept.", { projectName: selectedProject?.name ?? "" }),
                confirmLabel: t("Reset Project"),
                destructive: true
              }).then((confirmed) => {
                if (confirmed) {
                  void handleResetProject();
                }
              })}
              tone="danger"
              busy={resettingProject}
              disabled={!selectedProject}
            />
          </Row>
        ) : null}
        <Row label={t("Delete project")} description={t("Permanently delete this project and all of its tasks, sprints, memories, and context history.")} last>
          <ActionButton
            label={t("Delete Project")}
            onClick={() => projectConfirm.requestConfirm({
              title: t("Delete Project"),
              body: t("Permanently delete \"{projectName}\" and all of its tasks, sprints, memories, and context history? This action cannot be undone.", { projectName: selectedProject?.name ?? "" }),
              confirmLabel: t("Delete Project"),
              destructive: true
            }).then((confirmed) => {
              if (confirmed) {
                void handleDeleteProject();
              }
            })}
            tone="danger"
            busy={deletingProject}
            disabled={!selectedProject}
          />
        </Row>
      </SectionCard>

      {selectedProject ? (
        <SectionCard title={t("Project Memory")} watermark="MEM" danger icon={<BrainCircuit strokeWidth={2.4} />} highlights={[{ label: t("Scope"), value: t("Project"), tone: "warning" }, { label: t("Tiers"), value: t("3 choices") }, { label: t("Reversible"), value: t("No") }]} configureLabel={t("Review memory cleanup")}>
          {PROJECT_MEMORY_OPTIONS(selectedProject.name, t).map((option, index, options) => (
            <Row key={option.tier} label={option.rowLabel} description={option.description} last={index === options.length - 1}>
              <ActionButton
                label={option.label}
                onClick={() => requestMemoryClear("project", option, t("Clear Project Memory"))}
                tone="danger"
                busy={memoryClearBusy === `project:${option.tier}`}
                disabled={memoryClearBusy !== null}
              />
            </Row>
          ))}
        </SectionCard>
      ) : null}

      {activeScope === "system" ? (
        <SectionCard title={t("System Memory")} watermark="MEM" danger icon={<BrainCircuit strokeWidth={2.4} />} highlights={[{ label: t("Scope"), value: t("All projects"), tone: "warning" }, { label: t("Tiers"), value: t("3 choices") }, { label: t("Reversible"), value: t("No") }]} configureLabel={t("Review memory cleanup")}>
          {getSystemMemoryOptions(t).map((option, index, options) => (
            <Row key={option.tier} label={option.rowLabel} description={option.description} last={index === options.length - 1}>
              <ActionButton
                label={option.label}
                onClick={() => requestMemoryClear("system", option, t("Clear System Memory"))}
                tone="danger"
                busy={memoryClearBusy === `system:${option.tier}`}
                disabled={memoryClearBusy !== null}
              />
            </Row>
          ))}
        </SectionCard>
      ) : null}

      {activeScope === "system" ? (
        <SectionCard title={t("System Database")} watermark="SYS" danger icon={<Database strokeWidth={2.4} />} highlights={[{ label: t("Impact"), value: t("All local state"), tone: "warning" }, { label: t("Rebuild"), value: t("On reload") }, { label: t("Reversible"), value: t("No") }]} configureLabel={t("Review database reset")}>
          <Row label={t("Hard reset database")} description={t("Delete all projects, tasks, sprints, and system history. This will cleanly reconstruct the local DB on the next reload.")} last>
            <ActionButton
              label={t("Wipe Database")}
              onClick={() => dbConfirm.requestConfirm({
                title: t("Wipe System Database"),
                body: t("Delete all projects, tasks, sprints, and system history? This action cannot be undone."),
                confirmLabel: t("Wipe Database"),
                destructive: true
              }).then((confirmed) => {
                if (confirmed) {
                  void handleResetDatabase();
                }
              })}
              tone="danger"
              busy={resettingDatabase}
            />
          </Row>
        </SectionCard>
      ) : null}

      <ConfirmDialog isOpen={resetProjectConfirm.isOpen} options={resetProjectConfirm.options} onConfirm={resetProjectConfirm.handleConfirm} onCancel={resetProjectConfirm.handleCancel} />
      <ConfirmDialog isOpen={projectConfirm.isOpen} options={projectConfirm.options} onConfirm={projectConfirm.handleConfirm} onCancel={projectConfirm.handleCancel} />
      <ConfirmDialog isOpen={dbConfirm.isOpen} options={dbConfirm.options} onConfirm={dbConfirm.handleConfirm} onCancel={dbConfirm.handleCancel} />
      <ConfirmDialog isOpen={memoryConfirm.isOpen} options={memoryConfirm.options} onConfirm={memoryConfirm.handleConfirm} onCancel={memoryConfirm.handleCancel} />
    </div>
  );
};
