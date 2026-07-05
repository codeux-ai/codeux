import { describe, expect, it } from "vitest";
import { buildQwenRuntimeConfig, buildOpenCodeRuntimeConfig } from "../../../../../src/infrastructure/providers/cli/provider-runtime-config.js";
import { redactMetadata } from "../../../../../src/shared/security/redaction.js";

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

    it("keeps Qwen MCP auth tokens in protected config content but redacts log metadata", () => {
      const mcpToken = "fixture-qwen-runtime-mcp-token";
      const agentId = "agent-qwen-runtime-session";
      const configContent = buildQwenRuntimeConfig(
        "qwen3-coder-plus",
        { qwenAuthMode: "MODEL_PROVIDER", qwenProtocol: "openai", qwenEnvKey: "QWEN_API_KEY" },
        { url: "http://127.0.0.1:3000", authToken: mcpToken, agentId },
        true,
        rewriteUrl
      );
      const result = JSON.parse(configContent);

      expect(result.mcpServers.code_ux.headers.Authorization).toBe(`Bearer ${mcpToken}`);
      expect(result.mcpServers.code_ux.headers["X-Code-Ux-Agent"]).toBe(agentId);

      const metadata = redactMetadata({
        provider: "qwen-code",
        invocationId: "invocation-qwen-1",
        sessionId: "session-qwen-1",
        configContent,
      }) as any;
      expect(JSON.stringify(metadata)).not.toContain(mcpToken);
      expect(metadata.provider).toBe("qwen-code");
      expect(metadata.invocationId).toBe("invocation-qwen-1");
      expect(metadata.sessionId).toBe("session-qwen-1");
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

    it("keeps OpenCode MCP auth tokens in protected config content but redacts log metadata", () => {
      const mcpToken = "fixture-opencode-runtime-mcp-token";
      const agentId = "agent-opencode-runtime-session";
      const configContent = buildOpenCodeRuntimeConfig(
        "openai/gpt-5.3-codex",
        { openCodeAuthMode: "ENV_KEY", openCodeProviderId: "openai", openCodeModelId: "gpt-5.3-codex" },
        { url: "http://127.0.0.1:3000", authToken: mcpToken, agentId },
        true,
        rewriteUrl
      );
      const result = JSON.parse(configContent);

      expect(result.provider.openai.options.apiKey).toBe("{env:OPENCODE_API_KEY}");
      expect(result.mcp.code_ux.headers.Authorization).toBe(`Bearer ${mcpToken}`);
      expect(result.mcp.code_ux.headers["X-Code-Ux-Agent"]).toBe(agentId);

      const metadata = redactMetadata({
        provider: "opencode",
        invocationId: "invocation-opencode-1",
        sessionId: "session-opencode-1",
        configContent,
      }) as any;
      expect(JSON.stringify(metadata)).not.toContain(mcpToken);
      expect(metadata.provider).toBe("opencode");
      expect(metadata.invocationId).toBe("invocation-opencode-1");
      expect(metadata.sessionId).toBe("session-opencode-1");
    });
  });
});
