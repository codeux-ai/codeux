import { createContext } from "preact";
import { useCallback, useContext, useMemo } from "preact/hooks";
import type { ComponentChildren, FunctionComponent } from "preact";
import type { CreateProjectInput, Source, UpdateProjectInput } from "../types.js";
import {
  createProject as createProjectRequest,
  deleteProject as deleteProjectRequest,
  fetchProjects,
  selectProject as selectProjectRequest,
  updateProject as updateProjectRequest,
} from "../lib/project-api.js";
import { useRealtimeResource } from "../../hooks/use-realtime-resource.js";

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

interface ProjectsResponse {
  projects: Source[];
  selectedProjectId: string | null;
}

const EMPTY_PROJECTS: ProjectsResponse = {
  projects: [],
  selectedProjectId: null,
};

export const ProjectDataProvider: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => {
  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    return await fetchProjects(signal);
  }, []);

  const isEqual = useCallback((prev: ProjectsResponse, next: ProjectsResponse) => {
    if (prev.selectedProjectId !== next.selectedProjectId) {
      return false;
    }
    if (prev.projects.length !== next.projects.length) {
      return false;
    }
    for (let i = 0; i < prev.projects.length; i++) {
      const p1 = prev.projects[i];
      const p2 = next.projects[i];
      if (!p1 || !p2) return false;
      if (
        p1.id !== p2.id ||
        p1.slug !== p2.slug ||
        p1.name !== p2.name ||
        p1.status !== p2.status ||
        p1.openTasks !== p2.openTasks ||
        p1.completedTasks !== p2.completedTasks ||
        p1.isRunning !== p2.isRunning ||
        p1.updatedAt !== p2.updatedAt ||
        p1.sprintsCount !== p2.sprintsCount ||
        JSON.stringify(p1.agentBindings) !== JSON.stringify(p2.agentBindings) ||
        JSON.stringify(p1.settingsOverrides) !== JSON.stringify(p2.settingsOverrides)
      ) {
        return false;
      }
    }
    return true;
  }, []);

  const {
    data,
    loading,
    error,
    refetch,
    updateDataLocally,
  } = useRealtimeResource<ProjectsResponse>({
    initialData: EMPTY_PROJECTS,
    fetchResource,
    isEqual,
    realtime: {
      scopes: ["projects"],
      eventType: "projects.updated",
      updateDirectlyFromEvent: true,
    },
    isAlreadyLoaded: false,
  });

  const selectProject = useCallback(async (projectId: string): Promise<void> => {
    updateDataLocally((curr) => ({ ...curr, selectedProjectId: projectId }));
    const nextProjectId = await selectProjectRequest(projectId);
    updateDataLocally((curr) => ({ ...curr, selectedProjectId: nextProjectId }));
  }, [updateDataLocally]);

  const createProject = useCallback(async (input: CreateProjectInput): Promise<Source> => {
    const project = await createProjectRequest(input);
    await refetch({ silent: true });
    await selectProject(project.id);
    return project;
  }, [refetch, selectProject]);

  const updateProject = useCallback(async (projectId: string, input: UpdateProjectInput): Promise<Source> => {
    const project = await updateProjectRequest(projectId, input);
    await refetch({ silent: true });
    return project;
  }, [refetch]);

  const deleteProject = useCallback(async (projectId: string): Promise<void> => {
    await deleteProjectRequest(projectId);
    await refetch({ silent: true });
  }, [refetch]);

  const refreshProjects = useCallback(async (): Promise<void> => {
    await refetch({ silent: true });
  }, [refetch]);

  const activeSelectedProjectId = data.selectedProjectId ?? data.projects[0]?.id ?? null;

  const selectedProject = useMemo(
    () => data.projects.find((project) => project.id === activeSelectedProjectId) || null,
    [data.projects, activeSelectedProjectId],
  );

  const value = useMemo<ProjectDataContextValue>(() => ({
    projects: data.projects,
    selectedProjectId: activeSelectedProjectId,
    selectedProject,
    loading,
    error,
    refreshProjects,
    selectProject,
    createProject,
    updateProject,
    deleteProject,
  }), [
    data.projects,
    activeSelectedProjectId,
    selectedProject,
    loading,
    error,
    refreshProjects,
    selectProject,
    createProject,
    updateProject,
    deleteProject,
  ]);

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
