import type { InstructionTemplateId } from "../instructions/instruction-template-catalog.js";
import type { ProviderInvocationPurpose, TokenUsageSource } from "./execution-types.js";
import type { MemorySettings } from "./memory-types.js";

export interface JulesSource {
  name: string;
  id: string;
  [key: string]: unknown;
}

export interface PullRequestOutput {
  url?: string;
  workerBranch?: string;
  [key: string]: unknown;
}

export interface SessionOutput {
  pullRequest?: PullRequestOutput;
  [key: string]: unknown;
}

export interface JulesSession {
  name: string;
  id: string;
  title?: string;
  state?: string;
  provider?: ProviderId;
  prompt: string;
  createTime?: string;
  outputs?: SessionOutput[];
}

export interface ActivitySummary {
  id: string;
  name: string;
  createTime: string;
  originator: string;
  kind: string;
  preview?: string;
  [key: string]: unknown;
}

export interface JulesActivityArtifact {
  changeSet?: {
    source?: string;
    gitPatch?: {
      unidiffPatch?: string;
      baseCommitId?: string;
      suggestedCommitMessage?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  media?: {
    data?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JulesActivity {
  name: string;
  id: string;
  createTime: string;
  originator?: "agent" | "user" | "system" | string;
  agentMessaged?: { agentMessage?: string };
  userMessaged?: { userMessage?: string };
  progressUpdated?: { title?: string; description?: string };
  planGenerated?: { plan?: { steps?: Array<{ title?: string }> } };
  planApproved?: { planId?: string };
  sessionFailed?: { reason?: string };
  sessionCompleted?: unknown;
  description?: string;
  artifacts?: JulesActivityArtifact[];
  [key: string]: unknown;
}

export type SubtaskStatus = "PENDING" | "RUNNING" | "CODING_COMPLETED" | "COMPLETED" | "FAILED" | "BLOCKED" | "QUOTA" | "QA_REVIEW_FAILED";
export type SubtaskMergeIndicator = "CI" | "AUTOMERGE" | "MERGED" | "MERGE_BLOCKED" | "MERGE_CONFLICT" | "PR_ONLY" | "QA_PENDING";
export type ProviderId = "jules" | "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity";
export type ProviderConfigId = string;
export type ProviderStrategy = "MANUAL" | "WEIGHTED" | "AGENT";
export type ThinkingMode = "SMALL" | "MEDIUM" | "HIGH";
export type InvocationRoutingProfile = "GLOBAL" | "WORKER";
export type InvocationRoutingId =
  | "task_coding"
  | "planning"
  | "dashboard_reply"
  | "clarification_reply"
  | "qa_review"
  | "ci_fix"
  | "merge_conflict";
export type CliExecutionMode = "DOCKER" | "HOST";
export type FeaturePrAutoMergeMode = "OFF" | "CREATE_PR" | "WHEN_GREEN" | "ALWAYS";
export type WorkerExecutionMode = "VIRTUAL";
export type VirtualWorkerProvider = Exclude<ProviderId, "jules">;
export type AgentRoutingMode = "MANUAL" | "ORCHESTRATOR";

export interface Subtask {
  record_id?: string;
  project_id?: string;
  sprint_id?: string;
  id: string;
  title: string;
  prompt: string;
  depends_on: string[];
  status?: SubtaskStatus;
  session_id?: string;
  session_name?: string;
  session_state?: string;
  provider?: ProviderId;
  model?: string;
  agentPresetId?: string | null;
  worker_branch?: string;
  pr_url?: string;
  activities?: JulesActivity[];
  is_independent: boolean;
  qa_review?: {
    error_reason?: string;
    [key: string]: any;
  };
  latestReview?: {
    status: string;
    outcome: string | null;
    summary: string | null;
    findings: string[];
    reviewer: string | null;
    finishedAt: string | null;
  };
  is_merged?: boolean;
  merge_indicator?: SubtaskMergeIndicator;
  intervention_owner?: InterventionOwner;
  intervention_hint?: string;
}

export interface DashboardStatus {
  project_id?: string;
  sprint_id?: string;
  sprint_number?: number;
  source_id?: string;
  repo_path?: string;
  feature_branch?: string;
  subtasks: Subtask[];
  reportText?: string;
  statusTable?: string;
  instructions?: string;
  timestamp: string | null;
}

export interface LocalDirectoryBrowserEntry {
  name: string;
  path: string;
}

export interface LocalDirectoryBrowserResponse {
  currentPath: string;
  parentPath: string | null;
  rootPath: string;
  homePath: string;
  directories: LocalDirectoryBrowserEntry[];
}

/**
 * The authoritative contract for the Live page snapshot.
 *
 * Boundary Contract:
 * - SQLite is the absolute source of truth.
 * - The server assembles the snapshot (`getProjectLiveSnapshot` module).
 * - Websockets transport committed snapshot changes.
 * - The browser renders the snapshot without reconciling competing sources.
 */
export interface ProjectLiveDashboardSnapshot {
  /** Owned by `ProjectManagementRepository`. Mutated when a project is selected or created. */
  projectId: string | null;
  /** Owned by `ProjectManagementRepository`. Mutated when a sprint is selected or changed. */
  selectedSprintId: string | null;
  /** Owned by `ProjectRuntimeRepository`. Mutated when task states change, a sprint is run, or orchestration loop updates progress. */
  status: DashboardStatus;
  /** Owned by `ExecutionRepository` (via `getProjectExecutionSnapshot`). Mutated when sprint runs are dispatched, worker states change, or attention items are created/claimed. */
  execution: ExecutionDashboardSnapshot;
  /** Owned by the external git system. Mutated when local branches or upstream changes are detected. */
  gitStatus: GitTrackingStatus | null;
  /** Error state for git tracking. Mutated when external git/ci fails to load. */
  gitStatusError: string | null;
  /** Owned by the server assembly module. Mutated upon every assembly call to track the snapshot timestamp. */
  updatedAt: string | null;
}

export interface LiveActivitiesResponse {
  activitiesBySession: Record<string, JulesActivity[]>;
  polledAt: string;
  cacheTtlMs: number;
}

export interface ExecutionSprintRunSummary {
  id: string;
  projectId: string;
  sprintId: string;
  sprintName: string;
  sprintNumber: number | null;
  status: string;
  triggerType: string;
  triggeredBy: string | null;
  executorMode: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  activeLeaseOwnerKey: string | null;
  activeLeaseExpiresAt: string | null;
  humanIntervention: ExecutionHumanInterventionSummary | null;
  usage?: ExecutionUsageTotals;
}

export interface ExecutionHumanInterventionSummary {
  title: string;
  reason: string;
  instructions: string;
  attentionType: string | null;
  severity: string | null;
  ownerType: string | null;
}

export interface ExecutionTaskDispatchSummary {
  id: string;
  projectId: string;
  sprintId: string;
  sprintRunId: string;
  sprintName: string;
  sprintNumber: number | null;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  status: string;
  executorType: string;
  priority: number;
  connectionId: string | null;
  connectionDisplayName: string | null;
  connectionRole: string | null;
  taskRunId: string | null;
  taskRunState: string | null;
  provider: string | null;
  sessionId: string | null;
  sessionName: string | null;
  workerBranch: string | null;
  prUrl: string | null;
  queuedAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  errorMessage: string | null;
  activeLeaseOwnerKey: string | null;
  activeLeaseExpiresAt: string | null;
  usage?: ExecutionUsageTotals;
}

export interface ExecutionRuntimeEventSummary {
  id: string;
  scopeType: "task_run" | "sprint_run";
  taskRunId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  projectId: string;
  sprintId: string;
  sprintName: string;
  sprintNumber: number | null;
  sprintRunStatus: string | null;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  taskRunState: string | null;
  eventType: string;
  originator: string | null;
  sourceEventKey: string | null;
  provider: string | null;
  sessionId: string | null;
  sessionName: string | null;
  workerBranch: string | null;
  prUrl: string | null;
  connectionId: string | null;
  connectionDisplayName: string | null;
  connectionRole: string | null;
  createdAt: string;
  payload: Record<string, unknown> | null;
}

export type ExecutionTaskRunEventSummary = ExecutionRuntimeEventSummary;

export interface ExecutionConnectionSummary {
  id: string;
  connectionKey: string;
  displayName: string;
  role: string;
  transport: string;
  status: string;
  model: string | null;
  instruction: string | null;
  labels: string[];
  listenMode: boolean;
  machineName: string | null;
  platform: string | null;
  arch: string | null;
  localExecutionRuntime: string | null;
  lastHeartbeatAt: string | null;
  projectIds: string[];
  activeProjectIds: string[];
  tasksRunCount: number;
  threadCount: number;
  messageCount: number;
  pendingInboxCount: number;
  activeDispatchCount: number;
}

export interface ExecutionAssignedWorkerSummary {
  assignmentId: string;
  workerEndpointId: string | null;
  workerEndpointKey: string;
  workerEndpointType: string;
  workerDisplayName: string;
  connectionId: string | null;
  connectionKey: string | null;
  transport: string | null;
  assignmentRole: string;
  status: string;
  assignedAt: string;
  lastAffinityAt: string;
  workerStatus: string | null;
  canSuperviseProjects: boolean;
  canExecuteTasks: boolean;
}

export interface ExecutionAttentionItemSummary {
  id: string;
  sprintId: string | null;
  taskId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  attentionType: string;
  severity: string;
  ownerType: string;
  status: string;
  assignedWorkerEndpointId: string | null;
  title: string;
  summaryMarkdown: string;
  payload: Record<string, unknown> | null;
  openedAt: string;
  claimedAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
}

export interface ExecutionDashboardSnapshot {
  projectId: string | null;
  projectName: string | null;
  sprintRuns: ExecutionSprintRunSummary[];
  taskDispatches: ExecutionTaskDispatchSummary[];
  connections: ExecutionConnectionSummary[];
  primaryAssignedWorker: ExecutionAssignedWorkerSummary | null;
  overflowAssignedWorkers: ExecutionAssignedWorkerSummary[];
  attentionItems: ExecutionAttentionItemSummary[];
  recentEvents: ExecutionRuntimeEventSummary[];
  updatedAt: string | null;
}

export interface ExecutionUsageTotals {
  invocationCount: number;
  activeTimeMs: number;
  wallTimeMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  reportedInvocationCount: number;
  estimatedInvocationCount: number;
  unavailableInvocationCount: number;
  unsupportedInvocationCount: number;
}

export interface ExecutionInvocationStatusCounts {
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  paused: number;
}

export interface ExecutionDurationStats {
  sampleCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface ExecutionModelStatsSummary {
  id: string;
  provider: string;
  model: string | null;
  label: string;
  usage: ExecutionUsageTotals;
  statusCounts: ExecutionInvocationStatusCounts;
  successRate: number | null;
  duration: ExecutionDurationStats;
  lastActivityAt: string | null;
}

export interface ExecutionGitMetrics {
  insertions: number;
  deletions: number;
  filesChanged: number;
  prCount: number;
  mergedCount: number;
  mergeConflictCount: number;
}

export interface ExecutionGitStatsEntitySummary {
  id: string;
  label: string;
  secondaryLabel: string | null;
  metrics: ExecutionGitMetrics;
}

export interface ExecutionGitStatsBucketSummary {
  bucketStart: string;
  bucketEnd: string;
  label: string;
  metrics: ExecutionGitMetrics;
}

export interface ExecutionGitStatsSummary {
  totals: ExecutionGitMetrics;
  buckets: ExecutionGitStatsBucketSummary[];
  tasks: ExecutionGitStatsEntitySummary[];
  sprints: ExecutionGitStatsEntitySummary[];
}

export interface ExecutionUsageBucketSummary {
  bucketStart: string;
  bucketEnd: string;
  label: string;
  usage: ExecutionUsageTotals;
}

export interface ExecutionStatsEntitySummary {
  id: string;
  label: string;
  secondaryLabel: string | null;
  status: string | null;
  purpose: ProviderInvocationPurpose | null;
  provider: ProviderId | string | null;
  usage: ExecutionUsageTotals;
  lastActivityAt: string | null;
}

export type ProjectStatsWindow = "1h" | "24h" | "7d" | "30d" | "all" | "custom";
export type ProjectStatsResolution = "hour" | "day" | "week";

export interface ProjectStatsQuery {
  window: ProjectStatsWindow;
  from?: string | null;
  to?: string | null;
}

export interface ProjectStatsRangeSummary {
  window: ProjectStatsWindow;
  label: string;
  resolution: ProjectStatsResolution;
  resolutionLabel: string;
  from: string;
  to: string;
  bucketCount: number;
  isCustom: boolean;
}

export interface ProjectExecutionStatsChartSeries {
  id: string;
  label: string;
  grouping: string;
  defaultEnabled: boolean;
  data: number[];
  color?: string;
  signalLabel?: string;
  formatter?: 'tokens' | 'duration' | 'number' | 'percent';
}

export interface ProjectExecutionStatsSnapshot {
  projectId: string;
  projectName: string;
  window: ProjectStatsWindow;
  query: ProjectStatsQuery;
  range: ProjectStatsRangeSummary;
  generatedAt: string;
  usage: ExecutionUsageTotals;
  git: ExecutionGitStatsSummary;
  mergeConflictCount?: number;
  activeSprint: {
    sprintId: string;
    sprintName: string;
    sprintNumber: number | null;
  } | null;
  buckets: ExecutionUsageBucketSummary[];
  sprints: ExecutionStatsEntitySummary[];
  tasks: ExecutionStatsEntitySummary[];
  providers: ExecutionStatsEntitySummary[];
  purposes: ExecutionStatsEntitySummary[];
  models: ExecutionModelStatsSummary[];
  statusCounts: ExecutionInvocationStatusCounts;
  duration: ExecutionDurationStats;
  tokenSources: Array<{
    source: TokenUsageSource;
    count: number;
  }>;
  chartSeries: ProjectExecutionStatsChartSeries[];
}

export interface OverviewTelemetryProjectSummary {
  projectId: string;
  projectName: string;
  sprintId: string;
  sprintName: string;
  sprintNumber: number | null;
  sprintRunId: string;
  sprintRunStatus: string;
  activeDispatchCount: number;
  runningDispatchCount: number;
  updatedAt: string | null;
  humanIntervention: ExecutionHumanInterventionSummary | null;
}

export interface OverviewTelemetrySnapshot {
  activeProjects: OverviewTelemetryProjectSummary[];
  attentionProjects: OverviewTelemetryProjectSummary[];
  recentEvents: ExecutionRuntimeEventSummary[];
  updatedAt: string | null;
}

export type DashboardRealtimeScopeType = "overview" | "projects" | "project" | "thread";

export interface DashboardRealtimeEvent {
  sequence: number;
  emittedAt: string;
  scopeType: DashboardRealtimeScopeType;
  scopeId: string;
  scope: string;
  eventType: string;
  entityType: string;
  entityId: string;
  projectId: string | null;
  sprintId: string | null;
  threadId: string | null;
  taskId: string | null;
  dispatchId: string | null;
  sprintRunId: string | null;
  taskRunId: string | null;
  connectionId: string | null;
  correlationId: string | null;
  payload: unknown;
}

export interface DashboardRealtimeSetSubscriptionsMessage {
  type: "set_subscriptions";
  scopes: string[];
  lastSequence?: number | null;
}

export interface DashboardRealtimeReadyMessage {
  type: "ready";
}

export interface DashboardRealtimeSubscribedMessage {
  type: "subscribed";
  scopes: string[];
  lastSequence: number | null;
}

export interface DashboardRealtimeEventMessage {
  type: "event";
  event: DashboardRealtimeEvent;
}

export interface DashboardRealtimeSnapshotRequiredMessage {
  type: "snapshot_required";
  reason: string;
}

export type DashboardRealtimeServerMessage =
  | DashboardRealtimeReadyMessage
  | DashboardRealtimeSubscribedMessage
  | DashboardRealtimeEventMessage
  | DashboardRealtimeSnapshotRequiredMessage;

export type DashboardRealtimeClientMessage = DashboardRealtimeSetSubscriptionsMessage;

export interface DashboardStats {
  total: number;
  running: number;
  codingCompleted: number;
  completed: number;
  failed: number;
  ci: number;
  qa: number;
  automerge: number;
  merged: number;
  mergeBlocked: number;
  mergeConflicts: number;
}

export interface Settings {
  maxFailures?: number;
  [key: string]: unknown;
}

export type AutomationLevel = "FULL" | "SEMI_AUTO" | "ALWAYS_ASK";
export type InterventionOwner = "HUMAN" | "AGENT";

export interface AutomationInterventionsSettings {
  autoApprovePlan: boolean;
  autoAnswerClarification: boolean;
  autoAnswerClarificationMode: "TEMPLATE" | "WORKER";
  autoResumePaused: boolean;
  clarificationAnswerTemplate: string;
  clarificationCooldownSeconds: number;
}

export interface ProviderSettings {
  provider: ProviderId;
  name: string;
  enabled: boolean;
  model: string;
  weight: number;
  thinkingMode: ThinkingMode;
  apiKey: string;
  mountAuth: boolean;
  authPath: string;
  /** Custom API endpoint base URL for providers that support it (claude-code, codex). */
  customBaseUrl?: string;
  /** Custom model identifier sent to the CLI when routing through a custom base URL (claude-code, codex). */
  customModel?: string;
  maxConcurrentTasks: number;
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
}

export interface InvocationProviderOverrideSettings {
  enabled?: boolean;
  model?: string;
  weight?: number;
  thinkingMode?: ThinkingMode;
}

export interface QwenModelProviderSettings {
  id: string;
  name: string;
  authType: "openai" | "anthropic" | "gemini";
  envKey: string;
  apiKey: string;
  baseUrl: string;
  description?: string;
}

export interface InvocationRoutingSettings {
  profile: InvocationRoutingProfile;
  strategy: ProviderStrategy;
  provider: ProviderConfigId | null;
  allowedProviders: ProviderConfigId[];
  providers: Record<ProviderConfigId, InvocationProviderOverrideSettings>;
}

export interface AiProviderSettings {
  provider: ProviderConfigId | null;
  strategy: ProviderStrategy;
  providers: Record<ProviderConfigId, ProviderSettings>;
  invocationRouting: Record<InvocationRoutingId, InvocationRoutingSettings>;
}

export interface GitSettings {
  githubMode: "REMOTE" | "LOCAL";
  githubToken: string;
  gitlabToken?: string;
  defaultBranch: string;
  autoCreatePr: boolean;
  autoCloseLinkedIssues: boolean;
  featureBranchPrefix: string;
  sprintBranchScheme: string;
  sprintKeyPrefix: string;
}

export interface JiraSettings {
  host: string;               // e.g. "https://company.atlassian.net"
  email: string;              // used for Basic Auth on Jira Cloud
  apiToken: string;
  autoCloseLinkedIssues: boolean;
  defaultProject: string;     // default project key shown in import modal
  closeTransitionName: string; // transition name for closing, default "Done"
}

export interface CiIntelligenceSettings {
  enabled: boolean;
  enableLivePrMonitoring: boolean;
  resolveAllCommentsBeforeMainMerge: boolean;
  resolveMainMergeConflicts: boolean;
  resolveAllCommentsBeforeFeatureMerge: boolean;
  resolveMergeConflicts: boolean;
  waitForJulesCiAutofix: boolean;
  julesCiAutofixMaxRetries: number;
  featurePrAutoMergeMode: FeaturePrAutoMergeMode;
  mainBranchAutoMergeMode: FeaturePrAutoMergeMode;
}

/**
 * Agent job types tracked and capped by the unified guardrail layer. A subset of
 * {@link ProviderInvocationPurpose} (execution-types.ts). `qa_review` is intentionally
 * excluded: QA review caps are handled by the dedicated `qaRunsCap` to avoid two
 * competing caps colliding with `agents.qualityAssurance.maxTaskReviewRuns`.
 */
export type GuardrailJobType =
  | "task_coding"
  | "ci_fix"
  | "merge_conflict"
  | "clarification_reply"
  | "planning";

/** What happens when a task hits an invocation cap for a given job type. */
export type GuardrailOnLimitAction =
  | "BLOCK_AND_ESCALATE" // block the task, hand to human, open an attention item
  | "STOP_AND_WAIT" // stop auto-handling this job type, leave the attention item open
  | "WARN_ONLY"; // record + log only, do not block

export interface GuardrailJobConfig {
  /** Max invocations of this job type per task. 0 = unlimited. */
  cap: number;
  onLimit: GuardrailOnLimitAction;
}

export interface GuardrailSettings {
  enabled: boolean;
  /** Optional hard cap on total agent invocations per task across all job types. 0 = unlimited. */
  perTaskTotalCeiling: number;
  jobs: Record<GuardrailJobType, GuardrailJobConfig>;
  /** Separate per-task QA-review cap. Distinct from agents.qualityAssurance.maxTaskReviewRuns. 0 = unlimited. */
  qaRunsCap: number;
  qaRunsOnLimit: GuardrailOnLimitAction;
}

export interface SprintLoopStepSettings {
  branchPreflight: boolean;
  planningPreflight: boolean;
  loadSubtasks: boolean;
  sessionSync: boolean;
  statusDerivation: boolean;
  startReadyTasks: boolean;
  mergeProtocol: boolean;
  actionRequiredProtocol: boolean;
  statusTable: boolean;
  watchLoop: boolean;
  watchLoopIntervalSeconds: number;
  watchLoopOutputIntervalSeconds: number;
}

export interface CliWorkflowSettings {
  cleanupWorktreeOnSuccess: boolean;
  cleanupWorktreeOnFailure: boolean;
  retryOnReadFileNotFound: boolean;
  retryOnQuotaReset: boolean;
  retryOnRateLimit: boolean;
  rateLimitRetryDelaySeconds: number;
  maxRateLimitRetries: number;
  maxParsingRetries: number;
  resumeFailedTaskInSameWorkspace: boolean;
  gitMode: "remote" | "local";
  executionMode: CliExecutionMode;
  containerImage: string;
  containerSetupScriptPath: string;
  containerCacheSetupScriptImage: boolean;
  containerMountGitConfig: boolean;
  containerGitUserName: string;
  containerGitUserEmail: string;
  containerMountGithubAuth: boolean;
  containerMountGeminiAuth: boolean;
  containerMountCodexAuth: boolean;
  containerMountClaudeCodeAuth: boolean;
  containerMountQwenCodeAuth: boolean;
  containerMountOpenCodeAuth: boolean;
  containerMountAntigravityAuth: boolean;
  containerGithubAuthPath: string;
  containerGeminiAuthPath: string;
  containerCodexAuthPath: string;
  containerClaudeCodeAuthPath: string;
  containerQwenCodeAuthPath: string;
  containerOpenCodeAuthPath: string;
  containerAntigravityAuthPath: string;
  maxPlanningJsonRetries: number;
  maxQuotaRetriesWithoutTimer: number;
}

export interface SprintPreviewSettings {
  enabled: boolean;
  showInAppBrowser: boolean;
  autoStartOnRunningSprint: boolean;
  rebuildOnTaskCompletion: boolean;
  rebuildOnSprintCompletion: boolean;
  autoStopOnTerminalSprint: boolean;
  maxConcurrentContainers: number;
  hostPortRangeStart: number;
  hostPortRangeEnd: number;
  containerAppPort: number;
  startupScriptPath: string;
}

export interface WorkerSettings {
  executionMode: WorkerExecutionMode;
  virtualWorkerProvider: ProviderConfigId;
  model: string;
  maxConcurrency: number;
  timeoutSeconds: number;
}

export interface QualityAssuranceTriggerSettings {
  enabled: boolean;
  agentPresetId: string | null;
}

export interface QualityAssuranceSettings {
  enabled: boolean;
  maxTaskReviewRuns: number;
  taskCompletion: QualityAssuranceTriggerSettings;
  sprintCompletion: QualityAssuranceTriggerSettings;
  completedTaskWithoutPr: QualityAssuranceTriggerSettings;
}

export interface CodingAgentRoutingSettings {
  mode: AgentRoutingMode;
  agentPresetId: string | null;
  orchestratorAgentPresetIds: string[];
}

export interface ManualAgentRoutingSettings {
  agentPresetId: string | null;
}

export interface AgentRoutingSettings {
  planning: ManualAgentRoutingSettings;
  taskCoding: CodingAgentRoutingSettings;
  ciFix: ManualAgentRoutingSettings;
  mergeConflict: ManualAgentRoutingSettings;
  dashboardReply: ManualAgentRoutingSettings;
  clarificationReply: ManualAgentRoutingSettings;
}

export interface AgentSettings {
  saveToProjectDirectory: boolean;
  routing: AgentRoutingSettings;
  instructionTemplates: Record<InstructionTemplateId, string>;
  qualityAssurance: QualityAssuranceSettings;
}

export type BackgroundPattern = "NONE" | "DIAGONAL_LINES" | "HORIZONTAL_LINES" | "VERTICAL_LINES" | "CROSSHATCH" | "DOTS" | "DIAMONDS" | "HEXAGONS" | "TRIANGLES" | "WAVES" | "NOISE";

export interface AppearanceSettings {
  navigationMode: "DOCK" | "SIDEBAR";
  theme: "LIGHT" | "DARK" | "SYSTEM";
  reducedMotion: "AUTO" | "REDUCE" | "NONE";
  backgroundMode: "ANIMATED" | "STATIC";
  animatedBackground: string;
  staticBackgroundColor: string;
  backgroundImage?: string | null;
  backgroundPattern?: BackgroundPattern | null;
  zoomLevel: number;
}

export interface SkillToggle {
  name: string;
  enabled: boolean;
  isInternal: boolean;
}

export interface McpToolToggle {
  name: string;
  enabled: boolean;
  isInternal: boolean;
}

export type CustomMcpTransport = "http" | "stdio";

export interface CustomMcpServer {
  id: string;
  name: string;
  label?: string;
  description?: string;
  enabled: boolean;
  transport: CustomMcpTransport;
  // http transport
  url?: string;
  headers?: Record<string, string>;
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  providers?: ProviderId[];
}

export type ConsoleLogLevel = "standard" | "full";

export interface DashboardSettings {
  dashboardPort: number;
  enableDebugLogFile: boolean;
  consoleLogLevel: ConsoleLogLevel;
  dbAutoVacuumOnStartup: boolean;
  dbPruningEnabled: boolean;
  dbRetentionDays: number;
  appearance: AppearanceSettings;
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  aiProvider: AiProviderSettings;
  git: GitSettings;
  jira: JiraSettings;
  ciIntelligence: CiIntelligenceSettings;
  guardrails: GuardrailSettings;
  sprintLoopSteps: SprintLoopStepSettings;
  cliWorkflow: CliWorkflowSettings;
  sprintPreview: SprintPreviewSettings;
  workers: WorkerSettings;
  agents: AgentSettings;
  skills: SkillToggle[];
  mcpTools: McpToolToggle[];
  customMcpServers: CustomMcpServer[];
  memory: MemorySettings;
}

export interface DashboardSettingsScope {
  projectId?: string;
  sprintId?: string | null;
}

export interface GitStatusCheck {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface GitPullRequestStatus {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string | null;
  baseRefName: string | null;
  mergeStateStatus: string | null;
  reviewDecision: string | null;
  updatedAt: string | null;
  comments: number;
  checks: GitStatusCheck[];
}

export interface GitCiRunStatus {
  id: number | null;
  name: string;
  workflowName: string | null;
  status: string;
  conclusion: string | null;
  event: string | null;
  headBranch: string | null;
  url: string;
  updatedAt: string | null;
  failedJobs?: GitCiFailedJob[];
}

export interface GitCiFailedJob {
  id: number | null;
  name: string;
  conclusion: string | null;
  failedSteps: string[];
  logExcerpt: string | null;
  logCommand: string | null;
}

export interface GitMergeStatus {
  number: number;
  title: string;
  url: string;
  headRefName: string | null;
  baseRefName: string | null;
  mergedAt: string | null;
  mergedBy: string | null;
}

export type GitTrackingScope = "FEATURE_PR_CI" | "MAIN_MERGE_PR_CI" | "MAIN_BRANCH_CI" | "REPOSITORY";

export interface GitTrackingTarget {
  scope: GitTrackingScope;
  label: string;
  branch: string | null;
}

export interface GitTrackingStatus {
  mode: "REMOTE" | "LOCAL";
  available: boolean;
  repositoryRoot: string | null;
  branch: string | null;
  hasRemote: boolean;
  dirty: boolean;
  openPullRequests: GitPullRequestStatus[];
  ciRuns: GitCiRunStatus[];
  mergedPullRequests: GitMergeStatus[];
  tracking: GitTrackingTarget;
  warnings: string[];
  lastUpdated: string;
}

export interface ExternalSettingsHints {
  env: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    claudeCodeApiKey: string;
    qwenCodeApiKey: string;
    openCodeApiKey: string;
    antigravityApiKey: string;
    githubToken: string;
    gitlabToken?: string;
    jiraToken?: string;
  };
  settingsJson: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    claudeCodeApiKey: string;
    qwenCodeApiKey: string;
    openCodeApiKey: string;
    antigravityApiKey: string;
    githubToken: string;
    gitlabToken?: string;
    jiraToken?: string;
  };
  resolved: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    claudeCodeApiKey: string;
    qwenCodeApiKey: string;
    openCodeApiKey: string;
    antigravityApiKey: string;
    githubToken: string;
    gitlabToken?: string;
    jiraToken?: string;
  };
  providerAvailability: {
    jules: { hasApiKey: boolean; hasLocalAuth: boolean; hasDashboardAuth: boolean };
    gemini: { hasApiKey: boolean; hasLocalAuth: boolean; hasDashboardAuth: boolean };
    codex: { hasApiKey: boolean; hasLocalAuth: boolean; hasDashboardAuth: boolean };
    claudeCode: { hasApiKey: boolean; hasLocalAuth: boolean; hasDashboardAuth: boolean };
    qwenCode: { hasApiKey: boolean; hasLocalAuth: boolean; hasDashboardAuth: boolean };
    openCode: { hasApiKey: boolean; hasLocalAuth: boolean; hasDashboardAuth: boolean };
    antigravity: { hasApiKey: boolean; hasLocalAuth: boolean; hasDashboardAuth: boolean };
  };
}

export interface GetCiStatusForScopeArgs {
  repoPath: string;
  scope: "FEATURE_PR_CI" | "MAIN_MERGE_PR_CI";
  featureBranch: string;
  defaultBranch: string;
  featureBranchPrefix: string;
  cacheTtlMs?: number;
}

export interface AutoMergeFeaturePrArgs {
  repoPath: string;
  prNumber: number;
}

export interface AutoMergeFeaturePrResult {
  ok: boolean;
  merged?: boolean;
  autoMergeScheduled?: boolean;
  mergeConflict?: boolean;
  message?: string;
}

export interface PersistTaskMergedFlagArgs {
  repoPath: string;
  sprintNumber: number;
  taskId: string;
  merged: boolean;
}

export interface ReadinessProbeStatus {
  status: "UP" | "READY" | "NOT_READY" | "DOWN";
  components?: {
    settingsDb: "UP" | "DOWN";
    dashboardBind: "UP" | "DOWN";
    mcpService: "UP" | "DOWN";
  };
}

export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  runningFor: string;
  labels: Record<string, string>;
}

export type OnboardingCheckStatus = "ready" | "warning" | "missing";
export type OnboardingClusterStatus = "ready" | "not_ready";

export interface OnboardingDependencyCheck {
  id: string;
  label: string;
  status: OnboardingCheckStatus;
  required: boolean;
  description: string;
  resolution: string;
  detail?: string;
}

export interface OnboardingProviderCredentialStatus {
  provider: ProviderId;
  label: string;
  authPath: string;
  available: boolean;
  mountEnabled: boolean;
  detectedFiles: string[];
  description: string;
}

export interface OnboardingRuntimeReadiness {
  checkedAt: string;
  cluster: {
    status: OnboardingClusterStatus;
    label: string;
    detail: string;
  };
  dependencies: OnboardingDependencyCheck[];
  providers: OnboardingProviderCredentialStatus[];
}

export interface UserOnboardingState {
  completed: boolean;
  onboardingCompletedAt: string | null;
}

export type SprintPreviewSessionStatus = "stopped" | "starting" | "running" | "error";
export type SprintPreviewHealthStatus = "unknown" | "healthy" | "unreachable";
export type SprintPreviewStartupMode = "auto" | "script";

export interface SprintPreviewSession {
  id: string;
  projectId: string;
  sprintId: string;
  projectName: string;
  sprintName: string;
  sprintNumber: number | null;
  status: SprintPreviewSessionStatus;
  hostPort: number | null;
  containerAppPort: number;
  containerId: string | null;
  containerName: string | null;
  worktreePath: string | null;
  featureBranch: string | null;
  startupScriptPath: string;
  startupMode: SprintPreviewStartupMode;
  installCommand: string | null;
  buildCommand: string | null;
  runCommand: string | null;
  lastCompletedTaskCount: number;
  lastSeenSprintStatus: string | null;
  lastKnownPath: string | null;
  healthStatus: SprintPreviewHealthStatus;
  lastError: string | null;
  lastBuildAt: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SprintPreviewScript {
  projectId: string;
  sprintId: string;
  path: string;
  exists: boolean;
  mode: SprintPreviewStartupMode;
  content: string;
  detectedInstallCommand: string | null;
  detectedBuildCommand: string | null;
  detectedRunCommand: string | null;
}

export type FileBrowserSessionStatus = "stopped" | "starting" | "running" | "error";

export interface FileBrowserSession {
  id: string;
  projectId: string;
  sprintId: string;
  projectName: string;
  sprintName: string;
  sprintNumber: number | null;
  status: FileBrowserSessionStatus;
  containerId: string | null;
  containerName: string | null;
  workspacePath: string | null;
  featureBranch: string | null;
  defaultBranch: string | null;
  lastCompletedTaskCount: number;
  lastSeenSprintStatus: string | null;
  lastError: string | null;
  lastBuildAt: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileBrowserTreeNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileBrowserTreeNode[];
}

export interface FileBrowserTree {
  sessionId: string;
  root: FileBrowserTreeNode[];
  fileCount: number;
  truncated: boolean;
}

export interface FileBrowserFileContent {
  path: string;
  content: string;
  encoding: "utf8";
  size: number;
  truncated: boolean;
  binary: boolean;
  language: string | null;
}

export type FileBrowserChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileBrowserChange {
  path: string;
  oldPath: string | null;
  status: FileBrowserChangeStatus;
  additions: number;
  deletions: number;
}

export interface FileBrowserChangeSet {
  sessionId: string;
  featureBranch: string;
  defaultBranch: string;
  available: boolean;
  reason: string | null;
  files: FileBrowserChange[];
}

export interface FileBrowserDiff {
  path: string;
  oldPath: string | null;
  status: FileBrowserChangeStatus;
  original: string | null;
  modified: string | null;
  binary: boolean;
  language: string | null;
}

export interface DashboardStatusSnapshot {
  project_id?: string;
  sprint_id?: string;
  sprint_number?: number;
  source_id?: string;
  repo_path?: string;
  feature_branch?: string;
  subtasks: Subtask[];
  reportText?: string;
  statusTable?: string;
  instructions?: string;
  timestamp: string | null;
}
