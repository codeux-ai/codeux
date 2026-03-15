import type { InstructionTemplateId } from "../instructions/instruction-template-catalog.js";

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
  [key: string]: unknown;
}

export type SubtaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED";
export type SubtaskMergeIndicator = "CI" | "AUTOMERGE" | "MERGED" | "MERGE_BLOCKED" | "MERGE_CONFLICT";
export type ProviderId = "jules" | "gemini" | "codex" | "claude-code";
export type ProviderStrategy = "MANUAL" | "WEIGHTED" | "ORCHESTRATOR";
export type ThinkingMode = "SMALL" | "MEDIUM" | "HIGH";
export type CliExecutionMode = "HOST" | "DOCKER";
export type FeaturePrAutoMergeMode = "OFF" | "WHEN_GREEN" | "ALWAYS";
export type WorkerExecutionMode = "CONNECTED_MCP" | "VIRTUAL";
export type VirtualWorkerProvider = Exclude<ProviderId, "jules">;

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
  worker_branch?: string;
  pr_url?: string;
  activities?: JulesActivity[];
  is_independent: boolean;
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
  completed: number;
  failed: number;
  ci: number;
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
  autoResumePaused: boolean;
  clarificationAnswerTemplate: string;
}

export interface ProviderSettings {
  enabled: boolean;
  model: string;
  weight: number;
  thinkingMode: ThinkingMode;
  apiKey: string;
}

export interface AiProviderSettings {
  provider: ProviderId;
  strategy: ProviderStrategy;
  providers: Record<ProviderId, ProviderSettings>;
  julesApiKey: string;
}

export interface GitSettings {
  githubMode: "REMOTE" | "LOCAL";
  githubToken: string;
  defaultBranch: string;
  autoCreatePr: boolean;
  featureBranchPrefix: string;
  sprintBranchScheme: string;
}

export interface CiIntelligenceSettings {
  enabled: boolean;
  enableLivePrMonitoring: boolean;
  waitForCiBeforeMainMerge: boolean;
  resolveAllCommentsBeforeMainMerge: boolean;
  resolveMainMergeConflicts: boolean;
  waitForCiBeforeFeatureMerge: boolean;
  resolveAllCommentsBeforeFeatureMerge: boolean;
  resolveMergeConflicts: boolean;
  waitForJulesCiAutofix: boolean;
  julesCiAutofixMaxRetries: number;
  featurePrAutoMergeMode: FeaturePrAutoMergeMode;
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
  resumeFailedTaskInSameWorkspace: boolean;
  executionMode: CliExecutionMode;
  containerImage: string;
  containerSetupScriptPath: string;
  containerCacheSetupScriptImage: boolean;
  containerMountGitConfig: boolean;
  containerMountGithubAuth: boolean;
  containerMountGeminiAuth: boolean;
  containerMountCodexAuth: boolean;
  containerMountClaudeCodeAuth: boolean;
  containerGithubAuthPath: string;
  containerGeminiAuthPath: string;
  containerCodexAuthPath: string;
  containerClaudeCodeAuthPath: string;
}

export interface WorkerSettings {
  executionMode: WorkerExecutionMode;
  virtualWorkerProvider: VirtualWorkerProvider;
}

export interface AgentSettings {
  saveToProjectDirectory: boolean;
  instructionTemplates: Record<InstructionTemplateId, string>;
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

export interface DashboardSettings {
  dashboardPort: number;
  enableDebugLogFile: boolean;
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  aiProvider: AiProviderSettings;
  git: GitSettings;
  ciIntelligence: CiIntelligenceSettings;
  sprintLoopSteps: SprintLoopStepSettings;
  cliWorkflow: CliWorkflowSettings;
  workers: WorkerSettings;
  agents: AgentSettings;
  skills: SkillToggle[];
  mcpTools: McpToolToggle[];
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
    githubToken: string;
  };
  settingsJson: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    claudeCodeApiKey: string;
    githubToken: string;
  };
  resolved: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    claudeCodeApiKey: string;
    githubToken: string;
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
