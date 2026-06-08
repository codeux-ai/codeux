export interface ManagementApproval {
  confirmed: boolean;
}

export interface ManagementRequestEnvelope {
  domain: string;
  action: string;
  payload: Record<string, unknown>;
  approval?: ManagementApproval;
}

export interface ManageCodeUxArgs extends ManagementRequestEnvelope {}

export interface ManageProjectsArgs {
  action: "list" | "get" | "create" | "update" | "select" | "setup" | "delete";
  projectId?: string;
  name?: string;
  description?: string;
  setup?: Record<string, unknown>;
  approval?: ManagementApproval;
}

export interface ManageSprintsArgs {
  action: "list" | "get" | "create" | "update" | "delete" | "start" | "pause" | "cancel" | "force_cancel" | "inspect_run" | "import_issues" | "plan";
  projectId?: string;
  sprintId?: string;
  sprintRunId?: string;
  name?: string;
  title?: string;
  goal?: string;
  goalMarkdown?: string;
  originalPrompt?: string;
  status?: string;
  showcasePinned?: boolean;
  agentPresetId?: string;
  planningAgentPresetId?: string;
  autoStart?: boolean;
  replan?: boolean;
  search?: string;
  provider?: string;
  limit?: number;
  overrides?: Record<string, unknown>;
  approval?: ManagementApproval;
}

export interface ManageTasksArgs {
  action: "list" | "get" | "create" | "update" | "delete" | "start" | "stop" | "force_stop" | "pause" | "inspect_run";
  projectId?: string;
  sprintId?: string;
  taskId?: string;
  taskKey?: string;
  name?: string;
  title?: string;
  promptMarkdown?: string;
  description?: string;
  status?: string;
  priority?: string;
  executorType?: string;
  agentPresetId?: string | null;
  model?: string | null;
  sortOrder?: number;
  dependsOnTaskIds?: string[];
  isIndependent?: boolean;
  isMerged?: boolean;
  provider?: string;
  approval?: ManagementApproval;
}

export interface ManageQuicksprintsArgs {
  action: "list_templates" | "get_template" | "create_template" | "update_template" | "delete_template" | "execute" | "start";
  projectId?: string;
  templateId?: string;
  name?: string;
  description?: string;
  icon?: string;
  category?: string;
  categoryColor?: string;
  agentInstructionMarkdown?: string;
  defaultTaskCount?: number | string;
  taskCount?: number | string;
  submitMode?: "plan_only" | "plan_and_start";
  routeOverride?: string;
  modelOverride?: string;
  planningOverrides?: Record<string, unknown>;
  agentPresetId?: string;
  additionalPrompt?: string;
  approval?: ManagementApproval;
}

export interface ManageSchedulerArgs {
  action: "list" | "create" | "schedule_sprint" | "schedule_quicksprint" | "schedule_chat" | "update" | "delete" | "run_due";
  projectId?: string;
  entryId?: string;
  from?: string;
  to?: string;
  title?: string;
  targetType?: "sprint" | "quicksprint" | "chat";
  status?: "scheduled" | "paused" | "completed" | "failed" | "cancelled";
  scheduledFor?: string;
  timezone?: string;
  recurrence?: Record<string, unknown>;
  sprintTarget?: Record<string, unknown>;
  quicksprintTarget?: Record<string, unknown>;
  chatTarget?: Record<string, unknown>;
  sprintId?: string;
  templateId?: string;
  taskCount?: number | string;
  submitMode?: "plan_only" | "plan_and_start";
  additionalPrompt?: string;
  agentPresetId?: string;
  planningOverrides?: Record<string, unknown>;
  bodyMarkdown?: string;
  threadId?: string | null;
  connectionId?: string | null;
  now?: string;
  approval?: ManagementApproval;
}

export interface ManageAgentsArgs {
  action: "list" | "get" | "sync" | "create" | "update" | "delete";
  projectId?: string;
  presetId?: string;
  name?: string;
  instructionMarkdown?: string;
  labels?: string[];
  avatarConfig?: Record<string, unknown>;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
  approval?: ManagementApproval;
}

export interface ManageMemoryArgs {
  action: "search" | "list" | "get" | "create" | "update" | "delete" | "promote" | "start_reembed" | "get_map" | "count" | "model_status";
  projectId?: string;
  memoryId?: string;
  query?: string;
  scope?: string;
  sprintId?: string;
  agentPresetId?: string;
  limit?: number;
  minSimilarity?: number;
  content?: string;
  category?: string;
  strength?: number;
  memoryIds?: string[];
  reason?: string;
  topKPerNode?: number;
  approval?: ManagementApproval;
}

export interface ManageSettingsArgs {
  action: "get_system" | "get_project_override" | "resolve_project_effective" | "get_sprint_override" | "resolve_sprint_effective" | "replace_system_settings" | "patch_system_setting" | "replace_project_settings" | "patch_project_setting" | "reset_project_settings" | "replace_sprint_settings" | "patch_sprint_setting" | "reset_sprint_settings";
  projectId?: string;
  sprintId?: string;
  path?: string;
  value?: unknown;
  settings?: Record<string, unknown>;
  approval?: ManagementApproval;
}

export interface ManagePreviewArgs {
  action: "list_sessions" | "start_session" | "rebuild_session" | "stop_session" | "remove_session" | "get_script" | "get_logs" | "get_url";
  projectId?: string;
  sprintId?: string;
  sessionId?: string;
  path?: string;
  approval?: ManagementApproval;
}

export interface ManageTelemetryArgs {
  action: "get_project_execution_snapshot" | "get_project_stats_snapshot" | "list_sprint_runs" | "list_task_dispatches" | "list_execution_invocations" | "list_execution_invocation_messages";
  projectId?: string;
  sprintId?: string;
  taskId?: string;
  invocationId?: string;
  type?: string;
}

export interface SearchKnowledgeArgs {
  query: string;
  limit?: number;
  minSimilarity?: number;
}

export interface ManagementResponseEnvelope {
  approvalRequired?: boolean;
  approvalMessage?: string;
  result?: unknown;
}
