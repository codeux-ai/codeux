import type { JulesActivity } from "../../contracts/app-types.js";

/**
 * Token-usage estimation for Jules sessions.
 *
 * The Jules Agent API does not report token usage, so we estimate it from the
 * session's activity stream. The previous implementation counted *every*
 * agent-side artifact — including the entire unified diff and a flat
 * `churn * 10` term — as **output** tokens, which both wildly inflated totals
 * (a large PR diff alone is hundreds of KB) and mis-categorised them: in a real
 * agentic run the dominant cost is **input** (the growing conversation context
 * is re-sent to the model on every turn), not output.
 *
 * This estimator models the run the way the underlying model actually bills:
 *
 * - A running **context** window accumulates the system prompt, the user
 *   prompt, every user/plan message, every agent message, and the code the
 *   agent produces.
 * - Each agent turn (message, plan, progress update, completion) is billed as
 *   `input += currentContext` (the model read the whole context to produce the
 *   turn) and `output += tokensGenerated`.
 * - Generated **code** counts as output only for the lines the agent actually
 *   wrote (added `+` lines of a unified diff), not the diff's context/headers
 *   or removed lines. The full patch still re-enters the context window.
 * - Context is capped to model the periodic compaction Jules performs, so long
 *   sessions don't grow without bound.
 *
 * The result is an input-heavy, realistically-shaped estimate with output
 * reflecting only what the agent generated. It is deterministic given the same
 * activities, and `usageSource` remains `"estimated"`.
 */

/** Rough size of the Jules agent harness/system prompt, in tokens. Jules does
 *  not expose it; this is a conservative constant included in the seed context. */
export const JULES_SYSTEM_PROMPT_TOKENS = 800;

/** Upper bound on the running context window (tokens). Models the context
 *  compaction Jules performs and prevents quadratic blow-up on long sessions. */
export const JULES_CONTEXT_TOKEN_CAP = 200_000;

/** Fallback tokens-per-added-line when a diff isn't available but PR git stats are. */
export const JULES_TOKENS_PER_ADDED_LINE = 12;

export interface JulesUsageEstimate {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  /** Number of tool-style operations the agent performed (patch applications,
   *  progress steps) — surfaced in stats as tool-call activity. */
  toolCallCount: number;
  /** Characters of generated (output) content, for the transcript_chars column. */
  transcriptChars: number;
  /** Characters of prompt/user-side input content. */
  promptChars: number;
}

export interface JulesUsageEstimateInput {
  /** The initial session prompt, if known. */
  prompt?: string | null;
  /** Activities for the session (any order; sorted internally by createTime). */
  activities: JulesActivity[];
  /** PR git stats, used only when no unified diff artifact is present. */
  gitMetrics?: { insertions?: number; deletions?: number; filesChanged?: number } | null;
  /** Token counter (e.g. a cl100k_base encoder). Injected for testability. */
  countTokens: (text: string) => number;
}

/** Extracts the agent-authored content of a unified diff: only added (`+`)
 *  lines, excluding the `+++` file headers. Returns the joined text so the
 *  caller can tokenise just the code the agent generated. */
export function extractAddedDiffLines(unidiffPatch: string): string {
  const added: string[] = [];
  for (const line of unidiffPatch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added.push(line.slice(1));
    }
  }
  return added.join("\n");
}

function planToMarkdown(activity: JulesActivity): string {
  const steps = activity.planGenerated?.plan?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return "";
  }
  return steps
    .map((step, index) => `- Step ${index + 1}: ${step.title || "Untitled step"}`)
    .join("\n");
}

function sortByCreateTime(activities: JulesActivity[]): JulesActivity[] {
  return activities
    .slice()
    .sort((a, b) => new Date(a.createTime || 0).getTime() - new Date(b.createTime || 0).getTime());
}

/**
 * Estimates token usage for a Jules session. Pure and deterministic given the
 * same inputs and `countTokens` implementation.
 */
export function estimateJulesUsage(input: JulesUsageEstimateInput): JulesUsageEstimate {
  const { countTokens, gitMetrics } = input;
  const activities = sortByCreateTime(input.activities || []);

  let inputTokens = 0;
  let outputTokens = 0;
  const reasoningOutputTokens = 0;
  let toolCallCount = 0;
  let transcriptChars = 0;
  let promptChars = 0;

  // Running input context, seeded with the harness prompt + the initial prompt.
  let context = JULES_SYSTEM_PROMPT_TOKENS;
  const prompt = input.prompt || "";
  if (prompt) {
    promptChars += prompt.length;
    context = Math.min(JULES_CONTEXT_TOKEN_CAP, context + countTokens(prompt));
  }

  const addContext = (tokens: number) => {
    context = Math.min(JULES_CONTEXT_TOKEN_CAP, context + tokens);
  };

  // An agent turn: the model reads the whole context, then emits `genTokens`.
  const billAgentTurn = (genTokens: number) => {
    inputTokens += Math.min(context, JULES_CONTEXT_TOKEN_CAP);
    outputTokens += genTokens;
    addContext(genTokens);
  };

  let sawUnidiffPatch = false;

  for (const activity of activities) {
    // User-side / context-growing events: consumed by the next agent turn's input.
    if (activity.userMessaged?.userMessage) {
      const text = activity.userMessaged.userMessage;
      promptChars += text.length;
      addContext(countTokens(text));
    }
    if (activity.planApproved?.planId) {
      const text = `Approved plan (ID: ${activity.planApproved.planId})`;
      promptChars += text.length;
      addContext(countTokens(text));
    }

    // Agent-side model output turns.
    if (activity.agentMessaged?.agentMessage) {
      const text = activity.agentMessaged.agentMessage;
      transcriptChars += text.length;
      billAgentTurn(countTokens(text));
    }
    if (activity.planGenerated?.plan?.steps) {
      const text = `Proposed plan:\n\n${planToMarkdown(activity)}`;
      transcriptChars += text.length;
      billAgentTurn(countTokens(text));
    }
    if (activity.progressUpdated?.title || activity.progressUpdated?.description) {
      // Progress updates are short status lines the agent emits while driving
      // tools — count one tool-style operation plus the small generated text.
      const title = activity.progressUpdated.title || "";
      const desc = activity.progressUpdated.description || "";
      const text = `${title}\n${desc}`;
      transcriptChars += text.length;
      toolCallCount += 1;
      billAgentTurn(countTokens(text));
    }
    if (activity.sessionCompleted !== undefined && activity.sessionCompleted !== null) {
      billAgentTurn(countTokens("Jules session completed successfully."));
    }
    if (activity.sessionFailed?.reason) {
      billAgentTurn(countTokens(`Jules session failed: ${activity.sessionFailed.reason}`));
    }

    // Code artifacts: the model produced a patch (a tool result). Count only the
    // added lines as generated output; the whole patch re-enters context.
    for (const art of activity.artifacts || []) {
      const unidiffPatch = art.changeSet?.gitPatch?.unidiffPatch;
      if (unidiffPatch) {
        sawUnidiffPatch = true;
        toolCallCount += 1;
        const addedCode = extractAddedDiffLines(unidiffPatch);
        const codeTokens = countTokens(addedCode);
        outputTokens += codeTokens;
        transcriptChars += addedCode.length;
        addContext(countTokens(unidiffPatch));
      }
      const commitMessage = art.changeSet?.gitPatch?.suggestedCommitMessage;
      if (commitMessage) {
        const msgTokens = countTokens(commitMessage);
        outputTokens += msgTokens;
        transcriptChars += commitMessage.length;
        addContext(msgTokens);
      }
      if (art.media?.data) {
        // An attached image is model *input* (it is read into context), not output.
        // Use the standard ~258-token cost of a vision tile.
        addContext(258);
      }
    }
  }

  // Fallback: no diff artifact was present (common when the PR is created out of
  // band), but we know the PR's churn from git stats. Approximate the generated
  // code from the number of added lines.
  if (!sawUnidiffPatch && gitMetrics) {
    const insertions = Math.max(0, gitMetrics.insertions ?? 0);
    if (insertions > 0) {
      const codeTokens = insertions * JULES_TOKENS_PER_ADDED_LINE;
      outputTokens += codeTokens;
      toolCallCount += 1;
      addContext(codeTokens);
    }
  }

  const totalTokens = inputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    toolCallCount,
    transcriptChars,
    promptChars,
  };
}
