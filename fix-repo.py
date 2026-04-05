import re

with open('src/repositories/execution-repository.ts', 'r') as f:
    content = f.read()

# Add connectionId and costCents to the map functions returning ProviderInvocationUsageRecord
replacement = """  private mapProviderInvocationUsageRow(row: ProviderInvocationUsageRow): ProviderInvocationUsageRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskId: row.task_id,
      sprintRunId: row.sprint_run_id,
      dispatchId: row.dispatch_id,
      taskRunId: row.task_run_id,
      attentionItemId: row.attention_item_id,
      sessionId: row.session_id,
      provider: row.provider,
      purpose: row.purpose as any,
      status: row.status as any,
      model: row.model,
      nativeSessionId: row.native_session_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms !== null ? Number(row.duration_ms) : null,
      promptChars: Number(row.prompt_chars),
      transcriptChars: Number(row.transcript_chars),
      inputTokens: Number(row.input_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      outputTokens: Number(row.output_tokens),
      reasoningOutputTokens: Number(row.reasoning_output_tokens),
      totalTokens: Number(row.total_tokens),
      usageSource: row.usage_source as any,
      connectionId: (row as any).connection_id || null,
      costCents: (row as any).cost_cents !== null && (row as any).cost_cents !== undefined ? Number((row as any).cost_cents) : null,
      rawUsageJson: (row as any).raw_usage_json ? parsePayloadJson((row as any).raw_usage_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
    };
  }"""

# Actually, the repo should use the mapper we exported!
# Let's make sure it imports the exported mapper.
