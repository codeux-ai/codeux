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

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const protoA = Object.getPrototypeOf(a);
  if (protoA !== null && protoA !== Object.prototype) {
    return false;
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
    p1.activeGoalsCount === p2.activeGoalsCount &&
    isDeepEqual(p1.goals, p2.goals) &&
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

export function isEqualUsageTotals(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.invocationCount === b.invocationCount &&
         a.activeTimeMs === b.activeTimeMs &&
         a.wallTimeMs === b.wallTimeMs &&
         a.inputTokens === b.inputTokens &&
         a.cachedInputTokens === b.cachedInputTokens &&
         a.outputTokens === b.outputTokens &&
         a.reasoningOutputTokens === b.reasoningOutputTokens &&
         a.totalTokens === b.totalTokens &&
         a.reportedInvocationCount === b.reportedInvocationCount &&
         a.estimatedInvocationCount === b.estimatedInvocationCount &&
         a.unavailableInvocationCount === b.unavailableInvocationCount &&
         a.unsupportedInvocationCount === b.unsupportedInvocationCount;
}

export function isEqualBuckets(a: any[], b: any[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].bucketStart !== b[i].bucketStart ||
        a[i].bucketEnd !== b[i].bucketEnd ||
        a[i].label !== b[i].label ||
        !isEqualUsageTotals(a[i].usage, b[i].usage)) {
      return false;
    }
  }
  return true;
}

export function isEqualEntitySummaries(a: any[], b: any[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id ||
        a[i].label !== b[i].label ||
        a[i].secondaryLabel !== b[i].secondaryLabel ||
        a[i].status !== b[i].status ||
        a[i].purpose !== b[i].purpose ||
        a[i].provider !== b[i].provider ||
        a[i].lastActivityAt !== b[i].lastActivityAt ||
        !isEqualUsageTotals(a[i].usage, b[i].usage)) {
      return false;
    }
  }
  return true;
}

export function isEqualTokenSources(a: any[], b: any[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].source !== b[i].source || a[i].count !== b[i].count) return false;
  }
  return true;
}

export function isEqualProjectStatsSnapshot(prev: ProjectExecutionStatsSnapshot | null, next: ProjectExecutionStatsSnapshot | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;

  return prev.projectId === next.projectId &&
         prev.window === next.window &&
         prev.query === next.query &&
         // Note: we can ignore generatedAt for equality checks, or check it. But typically
         // if all the meat of the stats is the same, we consider it equal to avoid thrashing.
         isEqualUsageTotals(prev.usage, next.usage) &&
         isDeepEqual(prev.git, next.git) &&
         isDeepEqual(prev.activeSprint, next.activeSprint) &&
         isEqualBuckets(prev.buckets, next.buckets) &&
         isEqualEntitySummaries(prev.sprints, next.sprints) &&
         isEqualEntitySummaries(prev.tasks, next.tasks) &&
         isEqualEntitySummaries(prev.providers, next.providers) &&
         isEqualEntitySummaries(prev.purposes, next.purposes) &&
         isEqualTokenSources(prev.tokenSources, next.tokenSources);
}

export function stabilizeProjectStatsSnapshot(prev: ProjectExecutionStatsSnapshot | null, next: ProjectExecutionStatsSnapshot | null): ProjectExecutionStatsSnapshot | null {
  if (prev === next) return prev;
  if (!prev || !next) return next;

  const usageUnchanged = isEqualUsageTotals(prev.usage, next.usage);
  const gitUnchanged = isDeepEqual(prev.git, next.git);
  const activeSprintUnchanged = isDeepEqual(prev.activeSprint, next.activeSprint);
  const bucketsUnchanged = isEqualBuckets(prev.buckets, next.buckets);
  const sprintsUnchanged = isEqualEntitySummaries(prev.sprints, next.sprints);
  const tasksUnchanged = isEqualEntitySummaries(prev.tasks, next.tasks);
  const providersUnchanged = isEqualEntitySummaries(prev.providers, next.providers);
  const purposesUnchanged = isEqualEntitySummaries(prev.purposes, next.purposes);
  const tokenSourcesUnchanged = isEqualTokenSources(prev.tokenSources, next.tokenSources);

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

  if (usageUnchanged) {
    stabilized.usage = prev.usage;
  }

  if (gitUnchanged) {
    stabilized.git = prev.git;
  }

  if (activeSprintUnchanged) {
    stabilized.activeSprint = prev.activeSprint;
  }

  if (bucketsUnchanged) {
    stabilized.buckets = prev.buckets;
  } else if (prev.buckets && next.buckets) {
    const prevMap = new Map(prev.buckets.map(b => [b.bucketStart, b]));
    stabilized.buckets = next.buckets.map(b => {
      const p = prevMap.get(b.bucketStart);
      return (p && p.bucketEnd === b.bucketEnd && p.label === b.label && isEqualUsageTotals(p.usage, b.usage)) ? p : b;
    });
  }

  const stabilizeEntities = (prevArr: any[] | undefined, nextArr: any[] | undefined): any[] | undefined => {
    if (!prevArr || !nextArr) return nextArr;
    const prevMap = new Map(prevArr.map(e => [e.id, e]));
    return nextArr.map(e => {
      const p = prevMap.get(e.id);
      if (p && p.label === e.label && p.secondaryLabel === e.secondaryLabel && p.status === e.status && p.purpose === e.purpose && p.provider === e.provider && p.lastActivityAt === e.lastActivityAt && isEqualUsageTotals(p.usage, e.usage)) {
        return p;
      }
      return e;
    });
  };

  if (sprintsUnchanged) stabilized.sprints = prev.sprints;
  else stabilized.sprints = stabilizeEntities(prev.sprints, next.sprints) as any;

  if (tasksUnchanged) stabilized.tasks = prev.tasks;
  else stabilized.tasks = stabilizeEntities(prev.tasks, next.tasks) as any;

  if (providersUnchanged) stabilized.providers = prev.providers;
  else stabilized.providers = stabilizeEntities(prev.providers, next.providers) as any;

  if (purposesUnchanged) stabilized.purposes = prev.purposes;
  else stabilized.purposes = stabilizeEntities(prev.purposes, next.purposes) as any;

  if (tokenSourcesUnchanged) {
    stabilized.tokenSources = prev.tokenSources;
  } else if (prev.tokenSources && next.tokenSources) {
    const prevMap = new Map(prev.tokenSources.map(s => [s.source, s]));
    stabilized.tokenSources = next.tokenSources.map(s => {
      const p = prevMap.get(s.source);
      return (p && p.count === s.count) ? p : s;
    });
  }

  return stabilized;
}
