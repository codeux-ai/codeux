import type { JulesActivity, JulesActivityArtifact } from "../../contracts/app-types.js";
import type {
  JulesUsageActivityProjection,
} from "./jules-activity-projection.js";

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

/** Maximum string slice passed to the tokenizer at once. `js-tiktoken`
 * materializes token arrays and regex matches, so feeding it a multi-megabyte
 * patch in one call can temporarily consume gigabytes of V8 heap. */
export const JULES_TOKENIZER_CHUNK_CHARS = 64 * 1024;

/** Fallback tokens-per-added-line when a diff isn't available but PR git stats are. */
export const JULES_TOKENS_PER_ADDED_LINE = 12;
export const JULES_APPROXIMATE_PATCH_CHARS_PER_TOKEN = 4;

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

/** Tokenizes large values in bounded slices. Jules usage is already an
 * estimate, and the tiny BPE-boundary variance is preferable to an unbounded
 * temporary allocation for generated patches and transcripts. */
export function countJulesTokensInChunks(
  text: string,
  countTokens: (chunk: string) => number,
): number {
  let total = 0;
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + JULES_TOKENIZER_CHUNK_CHARS);
    if (
      end < text.length
      && end > offset
      && text.charCodeAt(end - 1) >= 0xD800
      && text.charCodeAt(end - 1) <= 0xDBFF
    ) {
      end -= 1;
    }
    total += countTokens(text.slice(offset, end));
    offset = end;
  }
  return total;
}

function measureAddedDiffLines(
  unidiffPatch: string,
  countTokens: (text: string) => number,
): { chars: number; tokens: number } {
  let batch = "";
  let chars = 0;
  let tokens = 0;
  let hasAddedLine = false;
  let cursor = 0;

  const flush = () => {
    if (!batch) {
      return;
    }
    tokens += countJulesTokensInChunks(batch, countTokens);
    batch = "";
  };

  while (cursor <= unidiffPatch.length) {
    const newline = unidiffPatch.indexOf("\n", cursor);
    const end = newline >= 0 ? newline : unidiffPatch.length;
    const line = unidiffPatch.slice(cursor, end);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const addedLine = line.slice(1);
      const separator = hasAddedLine ? "\n" : "";
      chars += separator.length + addedLine.length;
      if (batch.length + separator.length + addedLine.length > JULES_TOKENIZER_CHUNK_CHARS) {
        flush();
      }
      batch += separator + addedLine;
      hasAddedLine = true;
    }
    if (newline < 0) {
      break;
    }
    cursor = newline + 1;
  }
  flush();
  return { chars, tokens };
}

function planToMarkdown(activity: JulesActivity): string {
  const steps = activity.planGenerated?.plan?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return "";
  }
  return steps
    .map((step, index) => {
      const title = step.title || "Untitled step";
      return step.description
        ? `- Step ${index + 1}: ${title}\n  ${step.description}`
        : `- Step ${index + 1}: ${title}`;
    })
    .join("\n");
}

function sortByCreateTime(activities: JulesActivity[]): JulesActivity[] {
  return activities
    .slice()
    .sort((a, b) => new Date(a.createTime || 0).getTime() - new Date(b.createTime || 0).getTime());
}

function readUsageProjection(activity: JulesActivity): JulesUsageActivityProjection | null {
  const value = activity.codeUxUsageProjection;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JulesUsageActivityProjection;
}

function changeSetSourceKey(artifact: JulesActivityArtifact): string {
  return artifact.changeSet?.source || "default";
}

/**
 * Jules commonly attaches the complete current patch snapshot to every later
 * progress activity. Only the newest snapshot per source represents the
 * delivered code state; older and byte-identical snapshots are not additional
 * model/tool output.
 */
export function selectLatestJulesChangeSetArtifacts(
  activities: JulesActivity[],
): Set<JulesActivityArtifact> {
  const latestBySource = new Map<string, JulesActivityArtifact>();
  for (const activity of activities) {
    for (const artifact of activity.artifacts || []) {
      if (typeof artifact.changeSet?.gitPatch?.unidiffPatch === "string") {
        latestBySource.set(changeSetSourceKey(artifact), artifact);
      }
    }
  }
  return new Set(
    [...latestBySource.values()].filter(
      (artifact) => Boolean(artifact.changeSet?.gitPatch?.unidiffPatch),
    ),
  );
}

/**
 * Estimates token usage for a Jules session. Pure and deterministic given the
 * same inputs and `countTokens` implementation.
 */
export function estimateJulesUsage(input: JulesUsageEstimateInput): JulesUsageEstimate {
  const { countTokens, gitMetrics } = input;
  const countBoundedTokens = (text: string) => countJulesTokensInChunks(text, countTokens);
  const activities = sortByCreateTime(input.activities || []);
  const latestChangeSetArtifacts = selectLatestJulesChangeSetArtifacts(activities);

  let inputTokens = 0;
  let outputTokens = 0;
  const reasoningOutputTokens = 0;
  let toolCallCount = 0;
  let transcriptChars = 0;
  let promptChars = 0;

  // Running non-code context plus the current patch snapshot per source.
  // Keeping these separate lets a cumulative patch snapshot replace its
  // predecessor instead of making context grow once per progress event.
  let nonPatchContext = JULES_SYSTEM_PROMPT_TOKENS;
  const patchContextBySource = new Map<string, number>();
  let patchContextTokens = 0;
  const prompt = input.prompt || "";
  if (prompt) {
    promptChars += prompt.length;
    nonPatchContext = Math.min(
      JULES_CONTEXT_TOKEN_CAP,
      nonPatchContext + countBoundedTokens(prompt),
    );
  }

  const addContext = (tokens: number) => {
    nonPatchContext = Math.min(JULES_CONTEXT_TOKEN_CAP, nonPatchContext + tokens);
  };
  const replacePatchContext = (source: string, tokens: number) => {
    const previous = patchContextBySource.get(source) ?? 0;
    patchContextTokens = Math.max(0, patchContextTokens - previous) + Math.max(0, tokens);
    patchContextBySource.set(source, Math.max(0, tokens));
  };
  const currentContext = () => Math.min(
    JULES_CONTEXT_TOKEN_CAP,
    nonPatchContext + patchContextTokens,
  );
  const approximatePatchTokens = (patchChars: number) => Math.ceil(
    Math.max(0, patchChars) / JULES_APPROXIMATE_PATCH_CHARS_PER_TOKEN,
  );

  const applyProjectedPatchContexts = (
    activity: JulesActivity,
    exactSources: Set<string>,
  ) => {
    for (const snapshot of readUsageProjection(activity)?.patchSnapshots || []) {
      if (!exactSources.has(snapshot.source)) {
        replacePatchContext(
          snapshot.source,
          approximatePatchTokens(snapshot.patchChars),
        );
      }
    }
  };

  // An agent turn: the model reads the whole context, then emits `genTokens`.
  const billAgentTurn = (genTokens: number) => {
    inputTokens += currentContext();
    outputTokens += genTokens;
    addContext(genTokens);
  };

  let sawUnidiffPatch = false;

  for (const activity of activities) {
    const usageProjection = readUsageProjection(activity);
    let activityHasToolOperation = Boolean(
      activity.progressUpdated
      || usageProjection?.patchSnapshots?.length,
    );
    let activityHasAgentTurn = false;

    // User-side / context-growing events: consumed by the next agent turn's input.
    if (activity.userMessaged?.userMessage) {
      const text = activity.userMessaged.userMessage;
      promptChars += text.length;
      addContext(countBoundedTokens(text));
    }
    if (activity.planApproved?.planId) {
      const text = `Approved plan (ID: ${activity.planApproved.planId})`;
      promptChars += text.length;
      addContext(countBoundedTokens(text));
    }

    // Agent-side model output turns.
    if (activity.agentMessaged?.agentMessage) {
      const text = activity.agentMessaged.agentMessage;
      transcriptChars += text.length;
      billAgentTurn(countBoundedTokens(text));
      activityHasAgentTurn = true;
    }
    if (activity.planGenerated?.plan?.steps) {
      const text = `Proposed plan:\n\n${planToMarkdown(activity)}`;
      transcriptChars += text.length;
      billAgentTurn(countBoundedTokens(text));
      activityHasAgentTurn = true;
    }
    if (activity.progressUpdated?.title || activity.progressUpdated?.description) {
      // Progress updates are short status lines the agent emits while driving
      // tools — count one tool-style operation plus the small generated text.
      const title = activity.progressUpdated.title || "";
      const desc = activity.progressUpdated.description || "";
      const text = `${title}\n${desc}`;
      transcriptChars += text.length;
      billAgentTurn(countBoundedTokens(text));
      activityHasAgentTurn = true;
    }
    if (activity.sessionCompleted !== undefined && activity.sessionCompleted !== null) {
      billAgentTurn(countBoundedTokens("Jules session completed successfully."));
      activityHasAgentTurn = true;
    }
    if (activity.sessionFailed?.reason) {
      billAgentTurn(countBoundedTokens(`Jules session failed: ${activity.sessionFailed.reason}`));
      activityHasAgentTurn = true;
    }
    if (
      !activityHasAgentTurn
      && activity.description
      && !activity.userMessaged
      && !activity.planApproved
    ) {
      const descriptionTokens = countBoundedTokens(activity.description);
      if (activity.originator === "agent") {
        transcriptChars += activity.description.length;
        billAgentTurn(descriptionTokens);
        activityHasAgentTurn = true;
      } else {
        addContext(descriptionTokens);
      }
    }

    // Code artifacts: the model produced a patch (a tool result). Count only the
    // added lines as generated output; the whole patch re-enters context.
    const exactPatchSources = new Set<string>();
    for (const art of activity.artifacts || []) {
      const unidiffPatch = art.changeSet?.gitPatch?.unidiffPatch;
      if (typeof unidiffPatch === "string") {
        activityHasToolOperation = true;
      }
      if (unidiffPatch && latestChangeSetArtifacts.has(art)) {
        sawUnidiffPatch = true;
        const addedCode = measureAddedDiffLines(unidiffPatch, countTokens);
        outputTokens += addedCode.tokens;
        transcriptChars += addedCode.chars;
        const source = changeSetSourceKey(art);
        exactPatchSources.add(source);
        replacePatchContext(source, countBoundedTokens(unidiffPatch));
      }
      const commitMessage = art.changeSet?.gitPatch?.suggestedCommitMessage;
      if (commitMessage && latestChangeSetArtifacts.has(art)) {
        const msgTokens = countBoundedTokens(commitMessage);
        outputTokens += msgTokens;
        transcriptChars += commitMessage.length;
        addContext(msgTokens);
      }
      if (art.media?.data) {
        activityHasToolOperation = true;
        // An attached image is model *input* (it is read into context), not output.
        // Use the standard ~258-token cost of a vision tile.
        addContext(258);
      }
      if (art.bashOutput) {
        activityHasToolOperation = true;
        const command = art.bashOutput.command || "";
        if (command) {
          const commandTokens = countBoundedTokens(command);
          transcriptChars += command.length;
          if (activityHasAgentTurn) {
            outputTokens += commandTokens;
            addContext(commandTokens);
          } else {
            billAgentTurn(commandTokens);
            activityHasAgentTurn = true;
          }
        }
        if (art.bashOutput.output) {
          addContext(countBoundedTokens(art.bashOutput.output));
        }
      }
    }
    applyProjectedPatchContexts(activity, exactPatchSources);
    if (activityHasToolOperation) {
      toolCallCount += 1;
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
