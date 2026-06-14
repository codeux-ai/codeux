import { describe, expect, it } from "vitest";
import {
  providerSpecs,
  enabledCustomServersFor,
  isOpenCodeNativeSessionId
} from "../../../../../src/infrastructure/providers/cli/provider-command-specs.js";
import type { CustomMcpServer } from "../../../../../src/contracts/app-types.js";

describe("Provider Command Specs", () => {
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
});
