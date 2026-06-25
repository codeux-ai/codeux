import type { CliProviderId } from "./provider-command-specs.js";
import { CommandResult } from "../../../services/cli-process-runner.js";
import { resultHasSilentQuotaSignal } from "../../../shared/providers/provider-error-classifier.js";

export interface ProviderExecutionLoopOptions {
  provider: CliProviderId;
  command: string;
  args: string[];
  continueSession: boolean;
  antigravityLogPath?: string | null;
  runCmd: (command: string, args: string[]) => Promise<CommandResult>;
  trackingOnActivity: (desc: string, originator?: string) => void;
  isTransientCodexTransportError: (result: CommandResult) => boolean;
  isClaudeConversationNotFoundError: (result: CommandResult) => boolean;
  buildFreshClaudeSpec: () => { command: string; args: string[] };
  readAntigravityDiagnostics: () => Promise<string | null>;
}

export async function runProviderExecutionLoop(options: ProviderExecutionLoopOptions): Promise<CommandResult> {
  const {
    provider,
    continueSession,
    antigravityLogPath,
    runCmd,
    trackingOnActivity,
    isTransientCodexTransportError,
    isClaudeConversationNotFoundError,
    buildFreshClaudeSpec,
    readAntigravityDiagnostics,
  } = options;

  let command = options.command;
  let args = options.args;

  let result = await runCmd(command, args);

  if (!result.ok && provider === "codex" && isTransientCodexTransportError(result)) {
    trackingOnActivity("Codex transport disconnected. Retrying once automatically...");
    await new Promise(r => setTimeout(r, 1500));
    result = await runCmd(command, args);
  }

  // `claude --resume <id>` fails with "No conversation found" when the prior
  // conversation is gone. Retry once with a fresh session instead.
  if (!result.ok && provider === "claude-code" && continueSession && isClaudeConversationNotFoundError(result)) {
    trackingOnActivity("Claude Code could not resume the previous conversation (no conversation found). Retrying once with a fresh session...", "provider");
    const freshSpec = buildFreshClaudeSpec();
    command = freshSpec.command;
    args = freshSpec.args;
    result = await runCmd(command, args);
  }

  // Antigravity's `agy` CLI writes quota/auth/executor failures only to its log file
  // and exits 0. Demote to a failure so the shared classification/quota path puts the task on hold.
  if (provider === "antigravity" && antigravityLogPath) {
    const diagnostics = await readAntigravityDiagnostics();
    if (diagnostics) {
      result = {
        ...result,
        stderr: [result.stderr, diagnostics].filter(Boolean).join("\n"),
      };
      if (result.ok) {
        const reason = resultHasSilentQuotaSignal(provider, result)
          ? "Quota limit reached"
          : "Provider reported an error";
        trackingOnActivity(`[${provider}] ${reason}; provider stopped before completing the task.`, "provider");
        result = { ...result, ok: false };
      }
    }
  }

  return result;
}
