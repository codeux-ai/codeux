import { useState } from "preact/hooks";
import type { Sprint, Task } from "../../types.js";

export type ProjectManagementImportProvider = "notion" | "asana" | "linear";

export function useSprintsPageModals() {
  const [showCreateComposer, setShowCreateComposer] = useState(false);
  const [editingSprint, setEditingSprint] = useState<Sprint | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportState, setExportState] = useState<{
    sprintLabel: string;
    sprintMarkdown: string;
    tasksMarkdown: string;
  } | null>(null);
  const [overrideSprint, setOverrideSprint] = useState<Sprint | null>(null);
  const [addTaskForSprint, setAddTaskForSprint] = useState<Sprint | null>(null);
  const [addTaskSprintTasks, setAddTaskSprintTasks] = useState<Task[]>([]);
  const [showQuicksprint, setShowQuicksprint] = useState(false);
  const [projectManagementImportProvider, setProjectManagementImportProvider] = useState<ProjectManagementImportProvider | null>(null);

  return {
    showCreateComposer,
    setShowCreateComposer,
    editingSprint,
    setEditingSprint,
    showImportModal,
    setShowImportModal,
    exportState,
    setExportState,
    overrideSprint,
    setOverrideSprint,
    addTaskForSprint,
    setAddTaskForSprint,
    addTaskSprintTasks,
    setAddTaskSprintTasks,
    showQuicksprint,
    setShowQuicksprint,
    projectManagementImportProvider,
    setProjectManagementImportProvider,
  };
}
