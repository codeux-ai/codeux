import re

with open('src/repositories/execution/execution-repository-types.ts', 'r') as f:
    content = f.read()

replacement = """export interface ProviderInvocationUsageRow {
  id: string;
  project_id: string;
  sprint_id: string | null;
  task_id: string | null;
  sprint_run_id: string | null;
  dispatch_id: string | null;
  task_run_id: string | null;
  attention_item_id: string | null;
  session_id: string;
  provider: string;
  purpose: string;
  status: string;
  model: string | null;
  native_session_id: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | string | null;
  prompt_chars: number | string;
  transcript_chars: number | string;
  input_tokens: number | string;
  cached_input_tokens: number | string;
  output_tokens: number | string;
  reasoning_output_tokens: number | string;
  total_tokens: number | string;
  usage_source: string;
  cost_cents: number | string | null;
  connection_id: string | null;
  raw_usage_json?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ProjectAttentionSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string | null;
  sprint_run_id: string | null;
  attention_type: string;
  severity: string;
  owner_type: string;
  status: string;
  title: string;
  summary_markdown: string;
  payload_json: string | null;
  updated_at: string;
}"""

content = re.sub(r'export interface ProjectAttentionSummaryRow[\s\S]*?\}', '', content)
content = re.sub(r'export interface ProviderInvocationUsageRow[\s\S]*?\}', '', content)

content = content + "\n" + replacement

with open('src/repositories/execution/execution-repository-types.ts', 'w') as f:
    f.write(content)
