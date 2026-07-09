import { afterEach, describe, expect, it } from "vitest";
import {
  E2E_PROVIDER_CLI_SHIM_ENV,
  providerSpecs,
  enabledCustomServersFor,
  getNativeSessionOperationPrompt,
  isOpenCodeNativeSessionId
} from "../../../../../src/infrastructure/providers/cli/provider-command-specs.js";
import type { CustomMcpServer } from "../../../../../src/contracts/app-types.js";

describe("Provider Command Specs", () => {
  afterEach(() => {
    delete process.env[E2E_PROVIDER_CLI_SHIM_ENV];
    delete process.env.CODEUX_E2E_NODE_EXECUTABLE;
  });

  describe("providerSpecs", () => {
    it("generates correct command for gemini", () => {
      const spec = providerSpecs["gemini"]("default", "hello");
      expect(spec).toEqual({
        command: "gemini",
        args: ["--yolo", "--output-format", "json", "--p", "hello"]
      });

      const explicitModel = providerSpecs["gemini"]("gemini-2.5-pro", "hello");
      expect(explicitModel).toEqual({
        command: "gemini",
        args: ["--yolo", "--output-format", "json", "--p", "hello"]
      }); // Gemini does not use --model flag in this spec
    });

    it("generates correct command for claude-code", () => {
      const defaultSpec = providerSpecs["claude-code"]("default", "hello");
      expect(defaultSpec).toEqual({
        command: "claude",
        args: ["--dangerously-skip-permissions", "-p", "hello"]
      });

      const explicitSpec = providerSpecs["claude-code"]("claude-3-7-sonnet", "hello");
      expect(explicitSpec).toEqual({
        command: "claude",
        args: ["--dangerously-skip-permissions", "--model", "claude-3-7-sonnet", "-p", "hello"]
      });

      const thinkingSpec = providerSpecs["claude-code"]("default", "hello", "max");
      expect(thinkingSpec).toEqual({
        command: "claude",
        args: ["--dangerously-skip-permissions", "--effort", "max", "-p", "hello"]
      });
    });

    it("generates correct command for codex", () => {
      const defaultSpec = providerSpecs["codex"]("default", "hello");
      expect(defaultSpec).toEqual({
        command: "codex",
        args: ["exec", "--yolo", "--json", "--output-last-message", "codex-last-message.txt", "hello"]
      });

      const explicitSpec = providerSpecs["codex"]("gpt-4o", "hello");
      expect(explicitSpec).toEqual({
        command: "codex",
        args: ["exec", "--yolo", "--json", "--output-last-message", "codex-last-message.txt", "--model", "gpt-4o", "hello"]
      });

      const thinkingSpec = providerSpecs["codex"]("gpt-4o", "hello", "xhigh");
      expect(thinkingSpec).toEqual({
        command: "codex",
        args: ["exec", "--yolo", "--json", "--output-last-message", "codex-last-message.txt", "-c", "model_reasoning_effort=\"xhigh\"", "--model", "gpt-4o", "hello"]
      });
    });

    it("generates correct command for qwen-code", () => {
      const defaultSpec = providerSpecs["qwen-code"]("default", "hello");
      expect(defaultSpec).toEqual({
        command: "qwen",
        args: ["--yolo", "-p", "hello"]
      });

      const explicitSpec = providerSpecs["qwen-code"]("qwen-max", "hello");
      expect(explicitSpec).toEqual({
        command: "qwen",
        args: ["--yolo", "--model", "qwen-max", "-p", "hello"]
      });
    });

    it("generates correct command for opencode", () => {
      const defaultSpec = providerSpecs["opencode"]("default", "hello");
      expect(defaultSpec).toEqual({
        command: "opencode",
        args: ["run", "--format", "json", "hello"]
      });

      const explicitSpec = providerSpecs["opencode"]("deepseek-coder", "hello");
      expect(explicitSpec).toEqual({
        command: "opencode",
        args: ["run", "--format", "json", "--model", "deepseek-coder", "hello"]
      });

      const thinkingSpec = providerSpecs["opencode"]("deepseek-coder", "hello", "minimal");
      expect(thinkingSpec).toEqual({
        command: "opencode",
        args: ["run", "--format", "json", "--model", "deepseek-coder", "--variant", "minimal", "hello"]
      });
    });

    it("generates correct command for antigravity", () => {
      const defaultSpec = providerSpecs["antigravity"]("default", "hello");
      expect(defaultSpec).toEqual({
        command: "agy",
        args: ["--dangerously-skip-permissions", "-p", "hello"]
      });

      const explicitSpec = providerSpecs["antigravity"]("agy-pro", "hello");
      expect(explicitSpec).toEqual({
        command: "agy",
        args: ["--dangerously-skip-permissions", "-p", "hello"]
      }); // Antigravity does not append --model according to spec
    });

    it("generates a self-contained Node command for mockup-cli", () => {
      const spec = providerSpecs["mockup-cli"]("default", "mockup-cli:write fixture.txt :: hello");
      expect(spec.command).toBe("node");
      expect(spec.args[0]).toBe("-e");
      expect(spec.args[1]).toContain("provider: \"mockup-cli\"");
      expect(spec.args[1]).toContain("resolveWorkspacePath");
      expect(spec.args[2]).toBe("mockup-cli:write fixture.txt :: hello");
    });

    it("preserves real provider commands when the E2E provider shim is absent", () => {
      delete process.env[E2E_PROVIDER_CLI_SHIM_ENV];

      expect(providerSpecs["gemini"]("default", "hello")).toEqual({
        command: "gemini",
        args: ["--yolo", "--output-format", "json", "--p", "hello"]
      });
      expect(providerSpecs["codex"]("gpt-4o", "hello")).toEqual({
        command: "codex",
        args: ["exec", "--yolo", "--json", "--output-last-message", "codex-last-message.txt", "--model", "gpt-4o", "hello"]
      });
      expect(providerSpecs["claude-code"]("default", "hello")).toEqual({
        command: "claude",
        args: ["--dangerously-skip-permissions", "-p", "hello"]
      });
      expect(providerSpecs["qwen-code"]("qwen-max", "hello")).toEqual({
        command: "qwen",
        args: ["--yolo", "--model", "qwen-max", "-p", "hello"]
      });
      expect(providerSpecs.opencode("default", "hello")).toEqual({
        command: "opencode",
        args: ["run", "--format", "json", "hello"]
      });
      expect(providerSpecs.antigravity("default", "hello")).toEqual({
        command: "agy",
        args: ["--dangerously-skip-permissions", "-p", "hello"]
      });
    });

    it("uses the guarded E2E provider shim for external CLI providers only when explicitly configured", () => {
      process.env[E2E_PROVIDER_CLI_SHIM_ENV] = "/tmp/codeux/mock-provider-cli.mjs";
      process.env.CODEUX_E2E_NODE_EXECUTABLE = "/usr/local/bin/node";

      expect(providerSpecs["codex"]("gpt-4o", "hello")).toEqual({
        command: "/usr/local/bin/node",
        args: [
          "/tmp/codeux/mock-provider-cli.mjs",
          "--provider", "codex",
          "--model", "gpt-4o",
          "--prompt", "hello",
        ],
      });
      expect(providerSpecs["gemini"]("default", "hello")).toEqual({
        command: "/usr/local/bin/node",
        args: [
          "/tmp/codeux/mock-provider-cli.mjs",
          "--provider", "gemini",
          "--model", "default",
          "--prompt", "hello",
        ],
      });

      expect(providerSpecs["claude-code"]("default", "hello", "xhigh")).toEqual({
        command: "/usr/local/bin/node",
        args: [
          "/tmp/codeux/mock-provider-cli.mjs",
          "--provider", "claude-code",
          "--model", "default",
          "--prompt", "hello",
          "--thinking-mode", "xhigh",
        ],
      });

      const mockupSpec = providerSpecs["mockup-cli"]("default", "mockup-cli:write fixture.txt :: hello");
      expect(mockupSpec.command).toBe("node");
      expect(mockupSpec.args[0]).toBe("-e");
    });
  });

  describe("enabledCustomServersFor", () => {
    it("returns empty array if input is undefined or empty", () => {
      expect(enabledCustomServersFor(undefined, "opencode")).toEqual([]);
      expect(enabledCustomServersFor([], "opencode")).toEqual([]);
    });

    it("filters out disabled servers", () => {
      const servers: CustomMcpServer[] = [
        { name: "test", enabled: false, command: "node", args: ["script.js"], transport: "stdio" }
      ];
      expect(enabledCustomServersFor(servers, "opencode")).toEqual([]);
    });

    it("filters out servers unusable by MCP rules", () => {
      // transport is stdio but missing command
      const servers: CustomMcpServer[] = [
        { name: "test", enabled: true, transport: "stdio" } as CustomMcpServer
      ];
      expect(enabledCustomServersFor(servers, "opencode")).toEqual([]);
    });

    it("includes valid servers when no providers are restricted", () => {
      const servers: CustomMcpServer[] = [
        { name: "test1", enabled: true, command: "node", args: ["test.js"], transport: "stdio" }
      ];
      expect(enabledCustomServersFor(servers, "opencode")).toEqual(servers);
    });

    it("includes valid servers when target provider is in providers list", () => {
      const servers: CustomMcpServer[] = [
        { name: "test2", enabled: true, url: "http://localhost", transport: "sse", providers: ["opencode"] }
      ];
      expect(enabledCustomServersFor(servers, "opencode")).toEqual(servers);
    });

    it("excludes valid servers when target provider is not in providers list", () => {
      const servers: CustomMcpServer[] = [
        { name: "test3", enabled: true, command: "node", args: ["test.js"], transport: "stdio", providers: ["claude-code"] }
      ];
      expect(enabledCustomServersFor(servers, "opencode")).toEqual([]);
    });
  });

  describe("isOpenCodeNativeSessionId", () => {
    it("returns true for valid session ids", () => {
      expect(isOpenCodeNativeSessionId("ses_abc123")).toBe(true);
      expect(isOpenCodeNativeSessionId("ses_xyz890")).toBe(true);
    });

    it("returns false for invalid session ids", () => {
      expect(isOpenCodeNativeSessionId("session_123")).toBe(false);
      expect(isOpenCodeNativeSessionId("abc123_ses")).toBe(false);
      expect(isOpenCodeNativeSessionId("")).toBe(false);
      expect(isOpenCodeNativeSessionId("ses_")).toBe(false);
      expect(isOpenCodeNativeSessionId(null)).toBe(false);
      expect(isOpenCodeNativeSessionId(undefined)).toBe(false);
    });
  });

  describe("getNativeSessionOperationPrompt", () => {
    it("maps compact to provider-native session commands", () => {
      expect(getNativeSessionOperationPrompt("codex", "compact")).toBe("/compact");
      expect(getNativeSessionOperationPrompt("claude-code", "compact")).toBe("/compact");
      expect(getNativeSessionOperationPrompt("gemini", "compact")).toBe("/compress");
      expect(getNativeSessionOperationPrompt("qwen-code", "compact")).toBe("/compress");
      expect(getNativeSessionOperationPrompt("opencode", "compact")).toBe("/compact");
      expect(getNativeSessionOperationPrompt("antigravity", "compact")).toBe("/compact");
    });

    it("does not expose native compaction for mockup-cli", () => {
      expect(getNativeSessionOperationPrompt("mockup-cli", "compact")).toBeNull();
    });
  });
});
