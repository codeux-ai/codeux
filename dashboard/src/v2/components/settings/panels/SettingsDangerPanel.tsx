import type { FunctionComponent, ComponentChildren } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { ActionButton } from "../SettingsSurface.js";
import { useConfirmDialog } from "../../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../../ui/ConfirmDialog.js";
import { Row } from "../SettingsFormFields.js";
import { SectionCard } from "./SharedPanelComponents.js";
import { AlertTriangle, Database } from "lucide-preact";

export const SettingsDangerPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    selectedProject,
    deletingProject,
    resettingDatabase,
    handleDeleteProject,
    handleResetDatabase,
  } = state;
  const projectConfirm = useConfirmDialog();
  const dbConfirm = useConfirmDialog();

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Danger Zone" watermark="DGR" danger icon={<AlertTriangle strokeWidth={2.4} />}>
        <Row label="Reset project database" description="Permanently delete all tasks, sprints, and context history." last>
          <ActionButton
            label="Wipe Project"
            onClick={() => projectConfirm.requestConfirm({
              title: "Wipe Project",
              body: `Permanently delete "${selectedProject?.name}" and all of its tasks, sprints, and context history? This action cannot be undone.`,
              confirmLabel: "Wipe Project",
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

      <ConfirmDialog isOpen={projectConfirm.isOpen} options={projectConfirm.options} onConfirm={projectConfirm.handleConfirm} onCancel={projectConfirm.handleCancel} triggerRef={projectConfirm.triggerRef} />
      <ConfirmDialog isOpen={dbConfirm.isOpen} options={dbConfirm.options} onConfirm={dbConfirm.handleConfirm} onCancel={dbConfirm.handleCancel} triggerRef={dbConfirm.triggerRef} />
    </div>
  );
};
