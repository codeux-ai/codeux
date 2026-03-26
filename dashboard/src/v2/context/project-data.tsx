import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren, FunctionComponent } from "preact";
import type { CreateProjectInput, Source, UpdateProjectInput } from "../types.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import {
  createProject as createProjectRequest,
  deleteProject as deleteProjectRequest,
  fetchProjects,
  selectProject as selectProjectRequest,
  updateProject as updateProjectRequest,
} from "../lib/project-api.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";

interface ProjectDataContextValue {
  projects: Source[];
  selectedProjectId: string | null;
  selectedProject: Source | null;
  loading: boolean;
  error: string | null;
  refreshProjects: () => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Source>;
  updateProject: (projectId: string, input: UpdateProjectInput) => Promise<Source>;
  deleteProject: (projectId: string) => Promise<void>;
}

const ProjectDataContext = createContext<ProjectDataContextValue | null>(null);

export const ProjectDataProvider: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => {
  const [projects, setProjects] = useState<Source[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const refreshProjectsSilent = useCallback(async (): Promise<void> => {
    // Only show loading spinner on the very first fetch.
    // All subsequent refreshes (realtime, polling, user actions) update silently.
    const isForeground = !hasLoadedRef.current;
    if (isForeground) {
      setLoading(true);
    }
    try {
      const response = await fetchProjects();
      setProjects(response.projects);
      setSelectedProjectId(response.selectedProjectId ?? response.projects[0]?.id ?? null);
      hasLoadedRef.current = true;
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (isForeground) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshProjectsSilent();
  }, [refreshProjectsSilent]);

  useEffect(() => (
    subscribeToDashboardRealtime(["projects"], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "snapshot_required") {
        void refreshProjectsSilent();
        return;
      }

      if (message.type !== "event" || message.event.eventType !== "projects.updated") {
        return;
      }

      const payload = message.event.payload as Awaited<ReturnType<typeof fetchProjects>>;
      setProjects(payload.projects);
      setSelectedProjectId(payload.selectedProjectId ?? payload.projects[0]?.id ?? null);
      setError(null);
    })
  ), [refreshProjectsSilent]);

  const selectProject = async (projectId: string): Promise<void> => {
    const nextProjectId = await selectProjectRequest(projectId);
    setSelectedProjectId(nextProjectId);
  };

  const createProject = async (input: CreateProjectInput): Promise<Source> => {
    const project = await createProjectRequest(input);
    await refreshProjectsSilent();
    await selectProject(project.id);
    return project;
  };

  const updateProject = async (projectId: string, input: UpdateProjectInput): Promise<Source> => {
    const project = await updateProjectRequest(projectId, input);
    await refreshProjectsSilent();
    return project;
  };

  const deleteProject = async (projectId: string): Promise<void> => {
    await deleteProjectRequest(projectId);
    await refreshProjectsSilent();
  };

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const value: ProjectDataContextValue = {
    projects,
    selectedProjectId,
    selectedProject,
    loading,
    error,
    refreshProjects: refreshProjectsSilent,
    selectProject,
    createProject,
    updateProject,
    deleteProject,
  };

  return (
    <ProjectDataContext.Provider value={value}>
      {children}
    </ProjectDataContext.Provider>
  );
};

export const useProjectData = (): ProjectDataContextValue => {
  const context = useContext(ProjectDataContext);
  if (!context) {
    throw new Error("useProjectData must be used within ProjectDataProvider");
  }
  return context;
};
