import type { ProviderId } from "../../types.js";

export interface ProviderLifecycleMetadata {
  lifecycle: "active" | "deprecated";
  replacementProvider?: ProviderId;
  message?: string;
}

export const providerLifecycle: Record<ProviderId, ProviderLifecycleMetadata> = {
  jules: { lifecycle: "active" },
  gemini: {
    lifecycle: "deprecated",
    replacementProvider: "antigravity",
    message: "Gemini CLI is deprecated in Code UX. Existing configurations remain supported; use Antigravity for new Google-powered setups.",
  },
  codex: { lifecycle: "active" },
  "claude-code": { lifecycle: "active" },
  "qwen-code": { lifecycle: "active" },
  opencode: { lifecycle: "active" },
  antigravity: { lifecycle: "active" },
  "mockup-cli": { lifecycle: "active" },
};

export const isDeprecatedProvider = (provider: ProviderId): boolean => (
  providerLifecycle[provider].lifecycle === "deprecated"
);

