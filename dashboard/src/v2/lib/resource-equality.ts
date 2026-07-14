import type { Source } from "../types.js";
import type {
  EffectiveSettingsResponse,
  ProjectExecutionStatsSnapshot
} from "../../types.js";

type UsageTotals = ProjectExecutionStatsSnapshot["usage"];
type CostCoverage = NonNullable<UsageTotals["costCoverage"]>;
type UsageBucket = ProjectExecutionStatsSnapshot["buckets"][number];
type EntitySummary = ProjectExecutionStatsSnapshot["tasks"][number];
type ModelSummary = ProjectExecutionStatsSnapshot["models"][number];
type StatusCounts = ProjectExecutionStatsSnapshot["statusCounts"];
type DurationStats = ProjectExecutionStatsSnapshot["duration"];
type TokenSource = ProjectExecutionStatsSnapshot["tokenSources"][number];
type ChartSeries = ProjectExecutionStatsSnapshot["chartSeries"][number];
type CostAnalytics = NonNullable<ProjectExecutionStatsSnapshot["costAnalytics"]>;

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

  const prevMap = new Map(prev.projects.map(p => [p.id, p]));
  let projectsChanged = false;

  const newProjects = next.projects.map(nextProject => {
    const prevProject = prevMap.get(nextProject.id);
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

function isEqualCostCoverage(
  a: CostCoverage | null | undefined,
  b: CostCoverage | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return a.configuredPricingInvocationCount === b.configuredPricingInvocationCount &&
    a.providerReportedCostInvocationCount === b.providerReportedCostInvocationCount &&
    a.unpricedInvocationCount === b.unpricedInvocationCount &&
    a.providerReportedCostUsd === b.providerReportedCostUsd;
}

export function isEqualUsageTotals(
  a: UsageTotals | null | undefined,
  b: UsageTotals | null | undefined,
): boolean {
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
         a.inputCostUsd === b.inputCostUsd &&
         a.outputCostUsd === b.outputCostUsd &&
         a.cachedInputCostUsd === b.cachedInputCostUsd &&
         a.totalCostUsd === b.totalCostUsd &&
         a.toolCallCount === b.toolCallCount &&
         a.reportedInvocationCount === b.reportedInvocationCount &&
         a.estimatedInvocationCount === b.estimatedInvocationCount &&
         a.unavailableInvocationCount === b.unavailableInvocationCount &&
         a.unsupportedInvocationCount === b.unsupportedInvocationCount &&
         isEqualCostCoverage(a.costCoverage, b.costCoverage);
}

function isEqualBucket(a: UsageBucket, b: UsageBucket): boolean {
  return a.bucketStart === b.bucketStart &&
    a.bucketEnd === b.bucketEnd &&
    a.label === b.label &&
    isEqualUsageTotals(a.usage, b.usage);
}

export function isEqualBuckets(
  a: UsageBucket[] | null | undefined,
  b: UsageBucket[] | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!isEqualBucket(a[i], b[i])) return false;
  }
  return true;
}

function isEqualEntitySummary(a: EntitySummary, b: EntitySummary): boolean {
  return a.id === b.id &&
    a.label === b.label &&
    a.secondaryLabel === b.secondaryLabel &&
    a.status === b.status &&
    a.purpose === b.purpose &&
    a.provider === b.provider &&
    a.lastActivityAt === b.lastActivityAt &&
    isEqualUsageTotals(a.usage, b.usage);
}

export function isEqualEntitySummaries(
  a: EntitySummary[] | null | undefined,
  b: EntitySummary[] | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!isEqualEntitySummary(a[i], b[i])) return false;
  }
  return true;
}

function isEqualStatusCounts(
  a: StatusCounts | null | undefined,
  b: StatusCounts | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return a.completed === b.completed &&
    a.failed === b.failed &&
    a.cancelled === b.cancelled &&
    a.running === b.running &&
    a.paused === b.paused;
}

function isEqualDurationStats(
  a: DurationStats | null | undefined,
  b: DurationStats | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return a.sampleCount === b.sampleCount &&
    a.avgMs === b.avgMs &&
    a.p50Ms === b.p50Ms &&
    a.p95Ms === b.p95Ms &&
    a.maxMs === b.maxMs;
}

function isEqualModelSummary(a: ModelSummary, b: ModelSummary): boolean {
  return a.id === b.id &&
    a.provider === b.provider &&
    a.model === b.model &&
    a.label === b.label &&
    isEqualUsageTotals(a.usage, b.usage) &&
    isEqualStatusCounts(a.statusCounts, b.statusCounts) &&
    a.successRate === b.successRate &&
    isEqualDurationStats(a.duration, b.duration) &&
    a.lastActivityAt === b.lastActivityAt;
}

function isEqualModels(
  a: ModelSummary[] | null | undefined,
  b: ModelSummary[] | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!isEqualModelSummary(a[i], b[i])) return false;
  }
  return true;
}

export function isEqualTokenSources(
  a: TokenSource[] | null | undefined,
  b: TokenSource[] | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].source !== b[i].source || a[i].count !== b[i].count) return false;
  }
  return true;
}

function isEqualChartSeriesItem(a: ChartSeries, b: ChartSeries): boolean {
  if (a.id !== b.id ||
      a.label !== b.label ||
      a.grouping !== b.grouping ||
      a.defaultEnabled !== b.defaultEnabled ||
      a.color !== b.color ||
      a.signalLabel !== b.signalLabel ||
      a.formatter !== b.formatter ||
      a.data.length !== b.data.length) {
    return false;
  }
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

function isEqualChartSeries(
  a: ChartSeries[] | null | undefined,
  b: ChartSeries[] | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!isEqualChartSeriesItem(a[i], b[i])) return false;
  }
  return true;
}

function isEqualCostAnalytics(
  a: CostAnalytics | null | undefined,
  b: CostAnalytics | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return isEqualEntitySummaries(a.sprints, b.sprints);
}

export function isEqualProjectStatsSnapshot(prev: ProjectExecutionStatsSnapshot | null, next: ProjectExecutionStatsSnapshot | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;

  return prev.projectId === next.projectId &&
         prev.projectName === next.projectName &&
         prev.window === next.window &&
         isDeepEqual(prev.query, next.query) &&
         isDeepEqual(prev.range, next.range) &&
         // generatedAt records snapshot assembly, not an analytical change.
         isEqualUsageTotals(prev.usage, next.usage) &&
         isEqualCostAnalytics(prev.costAnalytics, next.costAnalytics) &&
         isDeepEqual(prev.git, next.git) &&
         prev.mergeConflictCount === next.mergeConflictCount &&
         isDeepEqual(prev.activeSprint, next.activeSprint) &&
         isEqualBuckets(prev.buckets, next.buckets) &&
         isEqualEntitySummaries(prev.sprints, next.sprints) &&
         isEqualEntitySummaries(prev.tasks, next.tasks) &&
         isEqualEntitySummaries(prev.providers, next.providers) &&
         isEqualEntitySummaries(prev.purposes, next.purposes) &&
         isEqualModels(prev.models, next.models) &&
         isEqualStatusCounts(prev.statusCounts, next.statusCounts) &&
         isEqualDurationStats(prev.duration, next.duration) &&
         isEqualTokenSources(prev.tokenSources, next.tokenSources) &&
         isEqualChartSeries(prev.chartSeries, next.chartSeries);
}

function reconcileKeyedArray<T, K>(
  prev: T[],
  next: T[],
  getKey: (item: T) => K,
  stabilizeItem: (prevItem: T, nextItem: T) => T,
): T[];
function reconcileKeyedArray<T, K>(
  prev: T[] | undefined,
  next: T[] | undefined,
  getKey: (item: T) => K,
  stabilizeItem: (prevItem: T, nextItem: T) => T,
): T[] | undefined;
function reconcileKeyedArray<T, K>(
  prev: T[] | undefined,
  next: T[] | undefined,
  getKey: (item: T) => K,
  stabilizeItem: (prevItem: T, nextItem: T) => T,
): T[] | undefined {
  if (prev === next) return prev;
  if (!prev || !next) return next;

  const prevByKey = new Map<K, T>();
  for (const item of prev) prevByKey.set(getKey(item), item);

  let matchesPreviousArray = prev.length === next.length;
  const reconciled = next.map((nextItem, index) => {
    const prevItem = prevByKey.get(getKey(nextItem));
    const item = prevItem ? stabilizeItem(prevItem, nextItem) : nextItem;
    if (item !== prev[index]) matchesPreviousArray = false;
    return item;
  });

  return matchesPreviousArray ? prev : reconciled;
}

function stabilizeBucket(prev: UsageBucket, next: UsageBucket): UsageBucket {
  if (isEqualBucket(prev, next)) return prev;
  if (isEqualUsageTotals(prev.usage, next.usage)) {
    return { ...next, usage: prev.usage };
  }
  return next;
}

function stabilizeEntitySummary(prev: EntitySummary, next: EntitySummary): EntitySummary {
  if (isEqualEntitySummary(prev, next)) return prev;
  if (isEqualUsageTotals(prev.usage, next.usage)) {
    return { ...next, usage: prev.usage };
  }
  return next;
}

function stabilizeModelSummary(prev: ModelSummary, next: ModelSummary): ModelSummary {
  if (isEqualModelSummary(prev, next)) return prev;

  return {
    ...next,
    usage: isEqualUsageTotals(prev.usage, next.usage) ? prev.usage : next.usage,
    statusCounts: isEqualStatusCounts(prev.statusCounts, next.statusCounts) ? prev.statusCounts : next.statusCounts,
    duration: isEqualDurationStats(prev.duration, next.duration) ? prev.duration : next.duration,
  };
}

function stabilizeCostAnalytics(
  prev: CostAnalytics | undefined,
  next: CostAnalytics | undefined,
): CostAnalytics | undefined {
  if (prev === next) return prev;
  if (!prev || !next) return next;

  const sprints = reconcileKeyedArray(prev.sprints, next.sprints, (sprint) => sprint.id, stabilizeEntitySummary);
  if (sprints === prev.sprints) return prev;
  if (sprints === next.sprints) return next;
  return { ...next, sprints };
}

export function stabilizeProjectStatsSnapshot(prev: ProjectExecutionStatsSnapshot | null, next: ProjectExecutionStatsSnapshot | null): ProjectExecutionStatsSnapshot | null {
  if (prev === next) return prev;
  if (!prev || !next) return next;

  const usageUnchanged = isEqualUsageTotals(prev.usage, next.usage);
  const queryUnchanged = isDeepEqual(prev.query, next.query);
  const rangeUnchanged = isDeepEqual(prev.range, next.range);
  const costAnalytics = stabilizeCostAnalytics(prev.costAnalytics, next.costAnalytics);
  const gitUnchanged = isDeepEqual(prev.git, next.git);
  const activeSprintUnchanged = isDeepEqual(prev.activeSprint, next.activeSprint);
  const buckets = reconcileKeyedArray(prev.buckets, next.buckets, (bucket) => bucket.bucketStart, stabilizeBucket);
  const sprints = reconcileKeyedArray(prev.sprints, next.sprints, (sprint) => sprint.id, stabilizeEntitySummary);
  const tasks = reconcileKeyedArray(prev.tasks, next.tasks, (task) => task.id, stabilizeEntitySummary);
  const providers = reconcileKeyedArray(prev.providers, next.providers, (provider) => provider.id, stabilizeEntitySummary);
  const purposes = reconcileKeyedArray(prev.purposes, next.purposes, (purpose) => purpose.id, stabilizeEntitySummary);
  const models = reconcileKeyedArray(prev.models, next.models, (model) => model.id, stabilizeModelSummary);
  const statusCountsUnchanged = isEqualStatusCounts(prev.statusCounts, next.statusCounts);
  const durationUnchanged = isEqualDurationStats(prev.duration, next.duration);
  const tokenSources = reconcileKeyedArray(
    prev.tokenSources,
    next.tokenSources,
    (source) => source.source,
    (previous, current) => previous.count === current.count ? previous : current,
  );
  const chartSeries = reconcileKeyedArray(
    prev.chartSeries,
    next.chartSeries,
    (series) => series.id,
    (previous, current) => isEqualChartSeriesItem(previous, current) ? previous : current,
  );

  if (
    prev.projectId === next.projectId &&
    prev.projectName === next.projectName &&
    prev.window === next.window &&
    queryUnchanged &&
    rangeUnchanged &&
    usageUnchanged &&
    costAnalytics === prev.costAnalytics &&
    gitUnchanged &&
    prev.mergeConflictCount === next.mergeConflictCount &&
    activeSprintUnchanged &&
    buckets === prev.buckets &&
    sprints === prev.sprints &&
    tasks === prev.tasks &&
    providers === prev.providers &&
    purposes === prev.purposes &&
    models === prev.models &&
    statusCountsUnchanged &&
    durationUnchanged &&
    tokenSources === prev.tokenSources &&
    chartSeries === prev.chartSeries
  ) {
    return prev;
  }

  // Create a mixed object where unchanged nested structures keep their previous references
  const stabilized = { ...next };

  if (usageUnchanged) {
    stabilized.usage = prev.usage;
  }

  if (queryUnchanged) stabilized.query = prev.query;
  if (rangeUnchanged) stabilized.range = prev.range;
  stabilized.costAnalytics = costAnalytics;

  if (gitUnchanged) {
    stabilized.git = prev.git;
  }

  if (activeSprintUnchanged) {
    stabilized.activeSprint = prev.activeSprint;
  }

  stabilized.buckets = buckets;
  stabilized.sprints = sprints;
  stabilized.tasks = tasks;
  stabilized.providers = providers;
  stabilized.purposes = purposes;
  stabilized.models = models;
  if (statusCountsUnchanged) stabilized.statusCounts = prev.statusCounts;
  if (durationUnchanged) stabilized.duration = prev.duration;
  stabilized.tokenSources = tokenSources;
  stabilized.chartSeries = chartSeries;

  return stabilized;
}
