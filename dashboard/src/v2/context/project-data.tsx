import { createContext } from "preact";
import { useCallback, useContext, useMemo, useState } from "preact/hooks";
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
    // API client doesn't explicitly accept signal for this, but could be added
    return await fetchProjects();
  }, []);

  const isEqual = useCallback((_prev: ProjectsResponse, _next: ProjectsResponse) => false, []);

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

  const selectProject = async (projectId: string): Promise<void> => {
    updateDataLocally((curr) => ({ ...curr, selectedProjectId: projectId }));
    const nextProjectId = await selectProjectRequest(projectId);
    updateDataLocally((curr) => ({ ...curr, selectedProjectId: nextProjectId }));
  };

  const createProject = async (input: CreateProjectInput): Promise<Source> => {
    const project = await createProjectRequest(input);
    await refetch({ silent: true });
    await selectProject(project.id);
    return project;
  };

  const updateProject = async (projectId: string, input: UpdateProjectInput): Promise<Source> => {
    const project = await updateProjectRequest(projectId, input);
    await refetch({ silent: true });
    return project;
  };

  const deleteProject = async (projectId: string): Promise<void> => {
    await deleteProjectRequest(projectId);
    await refetch({ silent: true });
  };

  const activeSelectedProjectId = data.selectedProjectId ?? data.projects[0]?.id ?? null;

  const selectedProject = useMemo(
    () => data.projects.find((project) => project.id === activeSelectedProjectId) || null,
    [data.projects, activeSelectedProjectId],
  );

  const value: ProjectDataContextValue = {
    projects: data.projects,
    selectedProjectId: activeSelectedProjectId,
    selectedProject,
    loading,
    error,
    refreshProjects: () => refetch({ silent: true }),
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
