import { describe, expect, it } from "vitest";
import { buildQwenRuntimeConfig, buildOpenCodeRuntimeConfig } from "../../../../../src/infrastructure/providers/cli/provider-runtime-config.js";

describe("provider-runtime-config", () => {
  const rewriteUrl = (url: string, enabled: boolean) => enabled ? url.replace("127.0.0.1", "host.docker.internal") : url;

  describe("buildQwenRuntimeConfig", () => {
    it("generates local auth config", () => {
      const result = JSON.parse(buildQwenRuntimeConfig("qwen3-coder-plus", { qwenAuthMode: "LOCAL_AUTH" }, null, false, rewriteUrl));
      expect(result.security.auth.selectedType).toBe("qwen-oauth");
    });

    it("generates model provider config", () => {
      const result = JSON.parse(buildQwenRuntimeConfig(
        "qwen3-coder-plus",
        { qwenAuthMode: "MODEL_PROVIDER", qwenProtocol: "openai", qwenModelId: "glm-4.7-flash", qwenBaseUrl: "http://127.0.0.1:11434/v1", qwenEnvKey: "OLLAMA_API_KEY" },
        null,
        true,
        rewriteUrl
      ));
      expect(result.security.auth.selectedType).toBe("openai");
      expect(result.modelProviders.openai[0].baseUrl).toBe("http://host.docker.internal:11434/v1");
    });
  });

  describe("buildOpenCodeRuntimeConfig", () => {
    it("generates custom provider config", () => {
      const result = JSON.parse(buildOpenCodeRuntimeConfig(
        "custom/model",
        { openCodeAuthMode: "CUSTOM_PROVIDER", openCodeBaseUrl: "http://127.0.0.1:11434/v1" },
        null,
        true,
        rewriteUrl
      ));
      expect(result.provider.custom.options.baseURL).toBe("http://host.docker.internal:11434/v1");
    });

    it("generates mcp connection config", () => {
        const result = JSON.parse(buildOpenCodeRuntimeConfig(
            "custom/model",
            { openCodeAuthMode: "LOCAL_AUTH" },
            { url: "http://127.0.0.1:3000", authToken: "token", agentId: "agent" },
            true,
            rewriteUrl
        ));
        expect(result.mcp.code_ux.url).toBe("http://host.docker.internal:3000");
    });
  });
});
