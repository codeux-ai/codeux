import type {
  JulesActivity,
  SubtaskStatus,
  SubtaskMergeIndicator,
  ProviderId,
  ProviderStrategy,
  ThinkingMode,
  CliExecutionMode,
  FeaturePrAutoMergeMode,
  Subtask,
  DashboardStatus,
  LiveActivitiesResponse,
  ExecutionDashboardSnapshot,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  DashboardStats,
  AutomationLevel,
  AutomationInterventionsSettings,
  ProviderSettings,
  SkillToggle,
  McpToolToggle,
  DashboardSettings,
  GitStatusCheck,
  GitPullRequestStatus,
  GitCiRunStatus,
  GitMergeStatus,
  GitTrackingScope,
  GitTrackingTarget,
  GitTrackingStatus,
  ExternalSettingsHints
} from "../../src/contracts/app-types.js";

export type {
  JulesActivity,
  SubtaskStatus,
  SubtaskMergeIndicator,
  ProviderId,
  ProviderStrategy,
  ThinkingMode,
  CliExecutionMode,
  FeaturePrAutoMergeMode,
  Subtask,
  DashboardStatus,
  LiveActivitiesResponse,
  ExecutionDashboardSnapshot,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  DashboardStats,
  AutomationLevel,
  AutomationInterventionsSettings,
  ProviderSettings,
  SkillToggle,
  McpToolToggle,
  DashboardSettings,
  GitStatusCheck,
  GitPullRequestStatus,
  GitCiRunStatus,
  GitMergeStatus,
  GitTrackingScope,
  GitTrackingTarget,
  GitTrackingStatus,
  ExternalSettingsHints
};

/**
 * Compatibility alias for TaskStatus.
 * In the backend we use SubtaskStatus, but the dashboard originally used TaskStatus.
 */
export type TaskStatus = SubtaskStatus;
