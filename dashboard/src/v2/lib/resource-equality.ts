import type { Source } from "../types.js";
import type {
  EffectiveSettingsResponse,
  ProjectExecutionStatsSnapshot
} from "../../types.js";

// Note: Using explicit simple loops and Object.keys for deep equality instead of heavy JSON.stringify.
// This is not meant to be a full clone of lodash/isEqual, but focused on the schema shapes we have.
export function isDeepEqual(a: any, b: any): boolean {
  if (a === b) return true;

  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isDeepEqual(a[key], b[key])) return false;
  }

  return true;
}

export interface ProjectsResponse {
  projects: Source[];
  selectedProjectId: string | null;
}

export function isEqualProject(p1: Source, p2: Source): boolean {
  if (p1 === p2) return true;
  if (!p1 || !p2) return false;

  return p1.id === p2.id &&
    p1.slug === p2.slug &&
    p1.name === p2.name &&
    p1.status === p2.status &&
    p1.openTasks === p2.openTasks &&
    p1.completedTasks === p2.completedTasks &&
    p1.isRunning === p2.isRunning &&
    p1.updatedAt === p2.updatedAt &&
    p1.sprintsCount === p2.sprintsCount &&
    isDeepEqual(p1.agentBindings, p2.agentBindings) &&
    isDeepEqual(p1.settingsOverrides, p2.settingsOverrides);
}

export function isEqualProjectsResponse(prev: ProjectsResponse, next: ProjectsResponse): boolean {
  if (prev === next) return true;
  if (prev.selectedProjectId !== next.selectedProjectId) {
    return false;
  }
  if (prev.projects.length !== next.projects.length) {
    return false;
  }
  for (let i = 0; i < prev.projects.length; i++) {
    const p1 = prev.projects[i];
    const p2 = next.projects[i];
    if (!isEqualProject(p1, p2)) {
      return false;
    }
  }
  return true;
}

export function stabilizeProjectsResponse(prev: ProjectsResponse, next: ProjectsResponse): ProjectsResponse {
  if (prev === next) return prev;

  let projectsChanged = false;
  const newProjects = next.projects.map((nextProject, i) => {
    // If lengths differ, prev.projects[i] might be undefined, but we're mostly
    // trying to stabilize when array sizes match or when items align.
    // To be safe, we try to match by ID instead of purely by index, but index is okay
    // since `isEqualProjectsResponse` checks order. Let's just find by ID to be robust.
    const prevProject = prev.projects.find(p => p.id === nextProject.id);
    if (prevProject && isEqualProject(prevProject, nextProject)) {
      return prevProject;
    }
    projectsChanged = true;
    return nextProject;
  });

  if (prev.selectedProjectId === next.selectedProjectId && !projectsChanged && prev.projects.length === next.projects.length) {
    return prev;
  }

  return {
    selectedProjectId: next.selectedProjectId,
    projects: newProjects,
  };
}

export function isEqualEffectiveSettings(prev: EffectiveSettingsResponse | null, next: EffectiveSettingsResponse | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;

  return isDeepEqual(prev.settings, next.settings) &&
         isDeepEqual(prev.sources, next.sources);
}

export function stabilizeEffectiveSettings(prev: EffectiveSettingsResponse | null, next: EffectiveSettingsResponse | null): EffectiveSettingsResponse | null {
  if (prev === next) return prev;
  if (!prev || !next) return next;

  const settingsUnchanged = isDeepEqual(prev.settings, next.settings);
  const sourcesUnchanged = isDeepEqual(prev.sources, next.sources);

  if (settingsUnchanged && sourcesUnchanged) return prev;

  return {
    settings: settingsUnchanged ? prev.settings : next.settings,
    sources: sourcesUnchanged ? prev.sources : next.sources,
  };
}

export function isEqualProjectStatsSnapshot(prev: ProjectExecutionStatsSnapshot | null, next: ProjectExecutionStatsSnapshot | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;

  return prev.projectId === next.projectId &&
         prev.window === next.window &&
         prev.query === next.query &&
         // Note: we can ignore generatedAt for equality checks, or check it. But typically
         // if all the meat of the stats is the same, we consider it equal to avoid thrashing.
         // Let's actually check deep equality on the core fields.
         isDeepEqual(prev.usage, next.usage) &&
         isDeepEqual(prev.git, next.git) &&
         isDeepEqual(prev.activeSprint, next.activeSprint) &&
         isDeepEqual(prev.buckets, next.buckets) &&
         isDeepEqual(prev.sprints, next.sprints) &&
         isDeepEqual(prev.tasks, next.tasks) &&
         isDeepEqual(prev.providers, next.providers) &&
         isDeepEqual(prev.purposes, next.purposes) &&
         isDeepEqual(prev.tokenSources, next.tokenSources);
}

export function stabilizeProjectStatsSnapshot(prev: ProjectExecutionStatsSnapshot | null, next: ProjectExecutionStatsSnapshot | null): ProjectExecutionStatsSnapshot | null {
  if (prev === next) return prev;
  if (!prev || !next) return next;

  const usageUnchanged = isDeepEqual(prev.usage, next.usage);
  const gitUnchanged = isDeepEqual(prev.git, next.git);
  const activeSprintUnchanged = isDeepEqual(prev.activeSprint, next.activeSprint);
  const bucketsUnchanged = isDeepEqual(prev.buckets, next.buckets);
  const sprintsUnchanged = isDeepEqual(prev.sprints, next.sprints);
  const tasksUnchanged = isDeepEqual(prev.tasks, next.tasks);
  const providersUnchanged = isDeepEqual(prev.providers, next.providers);
  const purposesUnchanged = isDeepEqual(prev.purposes, next.purposes);
  const tokenSourcesUnchanged = isDeepEqual(prev.tokenSources, next.tokenSources);

  if (
    prev.projectId === next.projectId &&
    prev.window === next.window &&
    prev.query === next.query &&
    usageUnchanged &&
    gitUnchanged &&
    activeSprintUnchanged &&
    bucketsUnchanged &&
    sprintsUnchanged &&
    tasksUnchanged &&
    providersUnchanged &&
    purposesUnchanged &&
    tokenSourcesUnchanged
  ) {
    return prev;
  }

  // Create a mixed object where unchanged nested structures keep their previous references
  const stabilized = { ...next };

  if (usageUnchanged) stabilized.usage = prev.usage;
  if (gitUnchanged) stabilized.git = prev.git;
  if (activeSprintUnchanged) stabilized.activeSprint = prev.activeSprint;
  if (bucketsUnchanged) stabilized.buckets = prev.buckets;
  if (sprintsUnchanged) stabilized.sprints = prev.sprints;
  if (tasksUnchanged) stabilized.tasks = prev.tasks;
  if (providersUnchanged) stabilized.providers = prev.providers;
  if (purposesUnchanged) stabilized.purposes = prev.purposes;
  if (tokenSourcesUnchanged) stabilized.tokenSources = prev.tokenSources;

  return stabilized;
}
