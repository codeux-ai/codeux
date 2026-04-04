export interface ExecutionSprintRunSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  status: string;
  trigger_type: string;
  triggered_by: string | null;
  executor_mode: string;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  active_lease_owner_key: string | null;
  active_lease_expires_at: string | null;
}

export interface ExecutionTaskDispatchSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string;
  sprint_run_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  task_id: string;
  task_key: string;
  task_title: string;
  status: string;
  executor_type: string;
  priority: number | string;
  connection_id: string | null;
  connection_display_name: string | null;
  connection_role: string | null;
  task_run_id: string | null;
  task_run_state: string | null;
  provider: string | null;
  session_id: string | null;
  session_name: string | null;
  worker_branch: string | null;
  pr_url: string | null;
  queued_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  error_message: string | null;
  active_lease_owner_key: string | null;
  active_lease_expires_at: string | null;
}

export interface ExecutionRuntimeEventSummaryRow {
  id: string;
  scope_type: string;
  task_run_id: string | null;
  sprint_run_id: string | null;
  dispatch_id: string | null;
  project_id: string;
  sprint_id: string;
  sprint_name: string;
  sprint_number: number | string | null;
  sprint_run_status: string | null;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
  task_run_state: string | null;
  event_type: string;
  originator: string | null;
  source_event_key: string | null;
  provider: string | null;
  session_id: string | null;
  session_name: string | null;
  worker_branch: string | null;
  pr_url: string | null;
  connection_id: string | null;
  connection_display_name: string | null;
  connection_role: string | null;
  created_at: string;
  payload_json: string | null;
}
