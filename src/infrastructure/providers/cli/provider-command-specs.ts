import type { CustomMcpServer, ProviderId } from "../../../contracts/app-types.js";
import { isUsableCustomMcpServer } from "../../../mcp/mcp-tool-availability.js";

export type CliProviderId = Extract<ProviderId, "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity">;

export type ProviderCommandSpec = (model: string, prompt: string) => { command: string; args: string[] };

export const providerSpecs: Record<CliProviderId, ProviderCommandSpec> = {
  "gemini": (model: string, prompt: string) => ({
    command: "gemini",
    args: ["--yolo", "--output-format", "json", "--p", prompt]
  }),
  "claude-code": (model: string, prompt: string) => {
    const args = ["--dangerously-skip-permissions"];
    if (model && model !== "default") args.push("--model", model);
    args.push("-p", prompt);
    return { command: "claude", args };
  },
  "codex": (model: string, prompt: string) => {
    const args = ["exec", "--yolo", "--json", "--output-last-message", "codex-last-message.txt"];
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
  opencode: (model: string, prompt: string) => {
    const args = ["run", "--format", "json"];
    if (model && model !== "default") args.push("--model", model);
    args.push(prompt);
    return { command: "opencode", args };
  },
  antigravity: (model: string, prompt: string) => {
    const args = ["--dangerously-skip-permissions"];
    args.push("-p", prompt);
    return { command: "agy", args };
  },
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
