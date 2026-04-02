import type { FunctionComponent, ComponentChildren } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { ActionButton } from "../SettingsSurface.js";
import { Row } from "../SettingsFormFields.js";
import { SectionCard } from "./SharedPanelComponents.js";
import { ConfirmationDialog } from "../../ui/ConfirmationDialog.js";

export const SettingsDangerPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    selectedProject,
    deletingProject,
    resettingDatabase,
    handleDeleteProject,
    handleResetDatabase,
    isDeleteProjectDialogOpen,
    setDeleteProjectDialogOpen,
    isResetDatabaseDialogOpen,
    setResetDatabaseDialogOpen,
  } = state;

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Danger Zone" watermark="DGR" danger>
        <Row label="Reset project database" description="Permanently delete all tasks, sprints, and context history." last>
          <ActionButton
            label="Wipe Project"
            onClick={() => setDeleteProjectDialogOpen(true)}
            tone="danger"
            busy={deletingProject}
            disabled={!selectedProject}
          />
          <ConfirmationDialog
            isOpen={isDeleteProjectDialogOpen}
            title="Wipe Project"
            message={`Delete project "${selectedProject?.name}" and all of its sprints, tasks, chats, and runtime records?`}
            confirmText="Delete Project"
            variant="destructive"
            onConfirm={() => void handleDeleteProject()}
            onCancel={() => setDeleteProjectDialogOpen(false)}
          />
        </Row>
      </SectionCard>
      {activeScope === "system" ? (
        <SectionCard title="System Database" watermark="SYS" danger>
          <Row label="Hard reset database" description="Delete all projects, tasks, sprints, and system history. This will cleanly reconstruct the local DB on the next reload." last>
            <ActionButton
              label="Wipe Database"
              onClick={() => setResetDatabaseDialogOpen(true)}
              tone="danger"
              busy={resettingDatabase}
            />
            <ConfirmationDialog
              isOpen={isResetDatabaseDialogOpen}
              title="Wipe Database"
              message="Reset the full database and scoped settings back to a clean development state? This deletes all projects, sprints, tasks, runtime state, chats, and saved settings."
              confirmText="Reset Database"
              variant="destructive"
              onConfirm={() => void handleResetDatabase()}
              onCancel={() => setResetDatabaseDialogOpen(false)}
            />
          </Row>
        </SectionCard>
      ) : null}
    </div>
  );
};
