import re

with open('src/contracts/execution-types.ts', 'r') as f:
    content = f.read()

replacement = """export interface ProviderInvocationUsageRecord {
  id: string;
  projectId: string;
  sprintId: string | null;
  taskId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  taskRunId: string | null;
  attentionItemId: string | null;
  connectionId: string | null;
  sessionId: string;
  provider: string;
  purpose: ProviderInvocationPurpose;
  status: ProviderInvocationStatus;
  model: string | null;
  nativeSessionId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  promptChars: number;
  transcriptChars: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  usageSource: TokenUsageSource;
  costCents: number | null;
  rawUsageJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}"""

content = re.sub(r'export interface ProviderInvocationUsageRecord \{[\s\S]*?  updatedAt: string;\n\}', replacement, content)

with open('src/contracts/execution-types.ts', 'w') as f:
    f.write(content)
