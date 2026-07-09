import type { CustomMcpServer, ProviderId, ThinkingMode } from "../../../contracts/app-types.js";
import { isUsableCustomMcpServer } from "../../../mcp/mcp-tool-availability.js";
import { normalizeProviderThinkingMode } from "../../../repositories/settings-defaults.js";
import { MOCKUP_CLI_NODE_SCRIPT } from "./mockup-cli-provider.js";

export type CliProviderId = Extract<ProviderId, "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity" | "mockup-cli">;
export type NativeSessionOperation = "compact";
export type NativeSessionOperationProvider = Exclude<CliProviderId, "mockup-cli">;

export type ProviderCommandSpec = (model: string, prompt: string, thinkingMode?: ThinkingMode) => { command: string; args: string[] };

export const E2E_PROVIDER_CLI_SHIM_ENV = "CODEUX_E2E_PROVIDER_CLI_SHIM";

const realProviderSpecs: Record<CliProviderId, ProviderCommandSpec> = {
  "gemini": (model: string, prompt: string) => ({
    command: "gemini",
    args: ["--yolo", "--output-format", "json", "--p", prompt]
  }),
  "claude-code": (model: string, prompt: string, thinkingMode?: ThinkingMode) => {
    const args = ["--dangerously-skip-permissions"];
    if (thinkingMode) args.push("--effort", normalizeProviderThinkingMode("claude-code", thinkingMode));
    if (model && model !== "default") args.push("--model", model);
    args.push("-p", prompt);
    return { command: "claude", args };
  },
  "codex": (model: string, prompt: string, thinkingMode?: ThinkingMode) => {
    const args = ["exec", "--yolo", "--json", "--output-last-message", "codex-last-message.txt"];
    if (thinkingMode) args.push("-c", `model_reasoning_effort="${normalizeProviderThinkingMode("codex", thinkingMode)}"`);
    if (model && model !== "default") args.push("--model", model);
    args.push(prompt);
    return { command: "codex", args };
  },
  "qwen-code": (model: string, prompt: string) => {
    const args = ["--yolo"];
    if (model && model !== "default") args.push("--model", model);
    args.push("-p", prompt);
    return { command: "qwen", args };
  },
  opencode: (model: string, prompt: string, thinkingMode?: ThinkingMode) => {
    const args = ["run", "--format", "json"];
    if (model && model !== "default") args.push("--model", model);
    if (thinkingMode) args.push("--variant", normalizeProviderThinkingMode("opencode", thinkingMode));
    args.push(prompt);
    return { command: "opencode", args };
  },
  antigravity: (model: string, prompt: string) => {
    const args = ["--dangerously-skip-permissions"];
    args.push("-p", prompt);
    return { command: "agy", args };
  },
  "mockup-cli": (_model: string, prompt: string) => ({
    command: "node",
    args: [
      "-e",
      MOCKUP_CLI_NODE_SCRIPT,
      prompt,
    ],
  }),
};

function resolveE2eProviderCliShim(): string | null {
  const shimPath = process.env[E2E_PROVIDER_CLI_SHIM_ENV]?.trim();
  return shimPath ? shimPath : null;
}

function withE2eProviderCliShim(provider: CliProviderId, spec: ProviderCommandSpec): ProviderCommandSpec {
  if (provider === "mockup-cli") {
    return spec;
  }

  return (model: string, prompt: string, thinkingMode?: ThinkingMode) => {
    const shimPath = resolveE2eProviderCliShim();
    if (!shimPath) {
      return spec(model, prompt, thinkingMode);
    }

    return {
      command: process.execPath,
      args: [
        shimPath,
        "--provider", provider,
        "--model", model || "default",
        "--prompt", prompt,
        ...(thinkingMode ? ["--thinking-mode", thinkingMode] : []),
      ],
    };
  };
}

export const providerSpecs: Record<CliProviderId, ProviderCommandSpec> = {
  "gemini": withE2eProviderCliShim("gemini", realProviderSpecs["gemini"]),
  "claude-code": withE2eProviderCliShim("claude-code", realProviderSpecs["claude-code"]),
  "codex": withE2eProviderCliShim("codex", realProviderSpecs["codex"]),
  "qwen-code": withE2eProviderCliShim("qwen-code", realProviderSpecs["qwen-code"]),
  opencode: withE2eProviderCliShim("opencode", realProviderSpecs.opencode),
  antigravity: withE2eProviderCliShim("antigravity", realProviderSpecs.antigravity),
  "mockup-cli": withE2eProviderCliShim("mockup-cli", realProviderSpecs["mockup-cli"]),
};

export const enabledCustomServersFor = (servers: CustomMcpServer[] | undefined, provider: ProviderId): CustomMcpServer[] =>
  (servers || []).filter((server) =>
    server.enabled
    && isUsableCustomMcpServer(server)
    && (!server.providers || server.providers.length === 0 || server.providers.includes(provider))
  );

export const isOpenCodeNativeSessionId = (value: string | null | undefined): boolean => (
  typeof value === "string" && /^ses_[A-Za-z0-9]+$/.test(value)
);

export const nativeSessionOperationPrompts: Record<NativeSessionOperationProvider, Record<NativeSessionOperation, string>> = {
  codex: { compact: "/compact" },
  "claude-code": { compact: "/compact" },
  gemini: { compact: "/compress" },
  "qwen-code": { compact: "/compress" },
  opencode: { compact: "/compact" },
  antigravity: { compact: "/compact" },
};

export function getNativeSessionOperationPrompt(
  provider: CliProviderId,
  operation: NativeSessionOperation,
): string | null {
  if (provider === "mockup-cli") {
    return null;
  }
  return nativeSessionOperationPrompts[provider][operation] ?? null;
}
