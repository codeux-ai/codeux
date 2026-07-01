import { writeFileSync, readFileSync } from 'fs';

let content = readFileSync('src/services/provider-settings-override.ts', 'utf8');

// We need to pass through the parameters rather than zeroing them out based on isApiKeyMode.
// wait, the prompt did say "Do not remove provider-specific options that are currently passed through."
// Let's rewrite the builder to match exactly the properties.

const newContent = `import type {
  ThinkingMode,
  QwenModelProviderSettings,
  ProviderSettings,
  ProviderId
} from "../contracts/app-types.js";

export interface ProviderSettingsOverride {
  model: string;
  thinkingMode: ThinkingMode;
  apiKey: string;
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
  providerMountAuth?: boolean;
  providerAuthPath?: string;
  customBaseUrl?: string;
  customModel?: string;
}

export function buildProviderSettingsOverride(
  resolvedModel: string,
  providerSettings: ProviderSettings
): ProviderSettingsOverride {
  return {
    model: resolvedModel,
    thinkingMode: providerSettings.thinkingMode,
    apiKey: providerSettings.apiKey,
    qwenAuthMode: providerSettings.qwenAuthMode,
    qwenRegion: providerSettings.qwenRegion,
    qwenBaseUrl: providerSettings.qwenBaseUrl,
    qwenEnvKey: providerSettings.qwenEnvKey,
    qwenModelId: providerSettings.qwenModelId,
    qwenProtocol: providerSettings.qwenProtocol,
    qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
    openCodeAuthMode: providerSettings.openCodeAuthMode,
    openCodeProviderId: providerSettings.openCodeProviderId,
    openCodeModelId: providerSettings.openCodeModelId,
    openCodeBaseUrl: providerSettings.openCodeBaseUrl,
    openCodeEnvKey: providerSettings.openCodeEnvKey,
    openCodePackage: providerSettings.openCodePackage,
    providerMountAuth: providerSettings.mountAuth,
    providerAuthPath: providerSettings.authPath,
    customBaseUrl: providerSettings.customBaseUrl,
    customModel: providerSettings.customModel,
  };
}
`;

writeFileSync('src/services/provider-settings-override.ts', newContent);
