import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import type { MemoryClearTier } from "../../../lib/memory-api.js";
import { ActionButton } from "../SettingsSurface.js";
import { useConfirmDialog } from "../../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../../ui/ConfirmDialog.js";
import { Row } from "../SettingsFormFields.js";
import { SectionCard } from "./SharedPanelComponents.js";
import { AlertTriangle, Database, BrainCircuit } from "lucide-preact";

interface MemoryClearOption {
  tier: MemoryClearTier;
  label: string;
  description: string;
  confirmBody: string;
}

const PROJECT_MEMORY_OPTIONS = (projectName: string): MemoryClearOption[] => [
  {
    tier: "short_term",
    label: "Clear Short-Term",
    description: "Delete per-sprint, per-agent working memories. Long-term knowledge is kept.",
    confirmBody: `Delete all short-term (sprint) memories for "${projectName}"? Long-term memories and claims are kept. This cannot be undone.`,
  },
  {
    tier: "long_term",
    label: "Clear Long-Term",
    description: "Delete promoted project memories plus all memory claims and evidence.",
    confirmBody: `Delete all long-term (project) memories, claims, and evidence for "${projectName}"? Short-term memories are kept. This cannot be undone.`,
  },
  {
    tier: "all",
    label: "Clear All Memory",
    description: "Delete every memory, claim, and evidence record for this project.",
    confirmBody: `Delete the entire memory database for "${projectName}" — every memory, claim, and piece of evidence? This cannot be undone.`,
  },
];

const SYSTEM_MEMORY_OPTIONS: MemoryClearOption[] = [
  {
    tier: "short_term",
    label: "Clear Short-Term",
    description: "Delete per-sprint, per-agent working memories across every project.",
    confirmBody: "Delete all short-term (sprint) memories across every project? Long-term memories and claims are kept. This cannot be undone.",
  },
  {
    tier: "long_term",
    label: "Clear Long-Term",
    description: "Delete promoted project memories plus all claims and evidence across every project.",
    confirmBody: "Delete all long-term (project) memories, claims, and evidence across every project? Short-term memories are kept. This cannot be undone.",
  },
  {
    tier: "all",
    label: "Clear All Memory",
    description: "Delete every memory, claim, and evidence record across every project.",
    confirmBody: "Delete the entire memory database — every memory, claim, and piece of evidence across every project? This cannot be undone.",
  },
];

export const SettingsDangerPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    selectedProject,
    deletingProject,
    resettingDatabase,
    memoryClearBusy,
    handleDeleteProject,
    handleResetDatabase,
    handleClearMemory,
  } = state;
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
    <div className="flex flex-col gap-5">
      <SectionCard title="Danger Zone" watermark="DGR" danger icon={<AlertTriangle strokeWidth={2.4} />}>
        <Row label="Delete project" description="Permanently delete this project and all of its tasks, sprints, memories, and context history." last>
          <ActionButton
            label="Delete Project"
            onClick={() => projectConfirm.requestConfirm({
              title: "Delete Project",
              body: `Permanently delete "${selectedProject?.name}" and all of its tasks, sprints, memories, and context history? This action cannot be undone.`,
              confirmLabel: "Delete Project",
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
        <SectionCard title="Project Memory" watermark="MEM" danger icon={<BrainCircuit strokeWidth={2.4} />}>
          {PROJECT_MEMORY_OPTIONS(selectedProject.name).map((option, index, options) => (
            <Row key={option.tier} label={option.label.replace(/^Clear /, "")} description={option.description} last={index === options.length - 1}>
              <ActionButton
                label={option.label}
                onClick={() => requestMemoryClear("project", option, "Clear Project Memory")}
                tone="danger"
                busy={memoryClearBusy === `project:${option.tier}`}
                disabled={memoryClearBusy !== null}
              />
            </Row>
          ))}
        </SectionCard>
      ) : null}

      {activeScope === "system" ? (
        <SectionCard title="System Memory" watermark="MEM" danger icon={<BrainCircuit strokeWidth={2.4} />}>
          {SYSTEM_MEMORY_OPTIONS.map((option, index, options) => (
            <Row key={option.tier} label={option.label.replace(/^Clear /, "")} description={option.description} last={index === options.length - 1}>
              <ActionButton
                label={option.label}
                onClick={() => requestMemoryClear("system", option, "Clear System Memory")}
                tone="danger"
                busy={memoryClearBusy === `system:${option.tier}`}
                disabled={memoryClearBusy !== null}
              />
            </Row>
          ))}
        </SectionCard>
      ) : null}

      {activeScope === "system" ? (
        <SectionCard title="System Database" watermark="SYS" danger icon={<Database strokeWidth={2.4} />}>
          <Row label="Hard reset database" description="Delete all projects, tasks, sprints, and system history. This will cleanly reconstruct the local DB on the next reload." last>
            <ActionButton
              label="Wipe Database"
              onClick={() => dbConfirm.requestConfirm({
                title: "Wipe System Database",
                body: "Delete all projects, tasks, sprints, and system history? This action cannot be undone.",
                confirmLabel: "Wipe Database",
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

      <ConfirmDialog isOpen={projectConfirm.isOpen} options={projectConfirm.options} onConfirm={projectConfirm.handleConfirm} onCancel={projectConfirm.handleCancel} />
      <ConfirmDialog isOpen={dbConfirm.isOpen} options={dbConfirm.options} onConfirm={dbConfirm.handleConfirm} onCancel={dbConfirm.handleCancel} />
      <ConfirmDialog isOpen={memoryConfirm.isOpen} options={memoryConfirm.options} onConfirm={memoryConfirm.handleConfirm} onCancel={memoryConfirm.handleCancel} />
    </div>
  );
};
