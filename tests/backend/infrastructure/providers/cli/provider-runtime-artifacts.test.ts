import { describe, expect, it, vi } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import {
  resolveCodexOutputPath,
  cleanupCodexOutputPath,
  resolveQwenHostLogDir,
  resetQwenOpenAiLogDir,
  resolveAntigravityHostLogPath,
  resolveAntigravityContainerLogPath,
  CONTAINER_QWEN_OPENAI_LOG_DIR,
  CONTAINER_RUNTIME_HOME,
  cleanupProviderRuntimeArtifacts,
} from "../../../../../src/infrastructure/providers/cli/provider-runtime-artifacts.js";

const pathPosix = path.posix;

vi.mock("fs/promises", () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe("Provider Runtime Artifacts", () => {
  describe("resolveCodexOutputPath", () => {
    it("returns null for non-codex providers", () => {
      expect(resolveCodexOutputPath({ provider: "gemini", workflowSettings: { executionMode: "HOST" } as any, sessionId: "s1" })).toBeNull();
    });

    it("returns docker path for DOCKER execution", () => {
      expect(resolveCodexOutputPath({ provider: "codex", workflowSettings: { executionMode: "DOCKER" } as any, sessionId: "s1" }))
        .toBe(pathPosix.join("/workspace", `provider-last-message-s1.txt`));
    });

    it("returns host path for HOST execution", () => {
      expect(resolveCodexOutputPath({ provider: "codex", workflowSettings: { executionMode: "HOST" } as any, sessionId: "s1" }))
        .toBe(path.join(os.tmpdir(), `provider-last-message-s1.txt`));
    });
  });

  describe("cleanupCodexOutputPath", () => {
    it("does nothing if outputPath is null", async () => {
      const removeWorkspaceDir = vi.fn();
      await cleanupCodexOutputPath(null, "DOCKER", "/repo", removeWorkspaceDir);
      expect(removeWorkspaceDir).not.toHaveBeenCalled();
      expect(fs.rm).not.toHaveBeenCalled();
    });

    it("calls removeWorkspaceDir in DOCKER mode", async () => {
      const removeWorkspaceDir = vi.fn().mockResolvedValue(undefined);
      await cleanupCodexOutputPath("/path", "DOCKER", "/repo", removeWorkspaceDir);
      expect(removeWorkspaceDir).toHaveBeenCalledWith("/repo", "/path");
    });

    it("calls fs.rm in non-DOCKER mode", async () => {
      await cleanupCodexOutputPath("/path", "HOST", "/repo");
      expect(fs.rm).toHaveBeenCalledWith("/path", { force: true });
    });
  });

  describe("resolveQwenHostLogDir", () => {
    it("sanitizes session ids", () => {
      const dir = resolveQwenHostLogDir("invalid@session/id!");
      expect(dir).toBe(path.join(os.tmpdir(), "code-ux-qwen-openai-logs", "invalid_session_id_"));
    });
  });

  describe("resetQwenOpenAiLogDir", () => {
    it("calls removeWorkspaceDir in DOCKER mode", async () => {
      const removeWorkspaceDir = vi.fn().mockResolvedValue(undefined);
      await resetQwenOpenAiLogDir("/repo", "DOCKER", "s1", removeWorkspaceDir);
      expect(removeWorkspaceDir).toHaveBeenCalledWith("/repo", CONTAINER_QWEN_OPENAI_LOG_DIR);
    });

    it("calls fs.rm and fs.mkdir in non-DOCKER mode", async () => {
      await resetQwenOpenAiLogDir("/repo", "HOST", "s1");
      const expectedDir = resolveQwenHostLogDir("s1");
      expect(fs.rm).toHaveBeenCalledWith(expectedDir, { recursive: true, force: true });
      expect(fs.mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
    });
  });

  describe("resolveAntigravityHostLogPath", () => {
    it("sanitizes session ids", () => {
      const dir = resolveAntigravityHostLogPath("invalid@session/id!");
      expect(dir).toBe(path.join(os.tmpdir(), "code-ux-antigravity-logs", "invalid_session_id_.log"));
    });
  });

  describe("resolveAntigravityContainerLogPath", () => {
    it("sanitizes session ids", () => {
      const dir = resolveAntigravityContainerLogPath("invalid@session/id!");
      expect(dir).toBe(pathPosix.join(CONTAINER_RUNTIME_HOME, "antigravity-logs", "invalid_session_id_.log"));
    });
  });

  describe("cleanupProviderRuntimeArtifacts", () => {
    it("cleans up qwen host log dir in non-DOCKER mode", async () => {
      vi.mocked(fs.rm).mockClear();
      await cleanupProviderRuntimeArtifacts("qwen-code", "HOST", "s1", "/repo", null);
      const expectedDir = resolveQwenHostLogDir("s1");
      expect(fs.rm).toHaveBeenCalledWith(expectedDir, { recursive: true, force: true });
    });

    it("does not clean up qwen host log dir in DOCKER mode", async () => {
      vi.mocked(fs.rm).mockClear();
      await cleanupProviderRuntimeArtifacts("qwen-code", "DOCKER", "s1", "/repo", null);
      expect(fs.rm).not.toHaveBeenCalledWith(resolveQwenHostLogDir("s1"), expect.anything());
    });

    it("cleans up antigravity log via removeWorkspaceDir in DOCKER mode", async () => {
      const removeWorkspaceDir = vi.fn().mockResolvedValue(undefined);
      await cleanupProviderRuntimeArtifacts("antigravity", "DOCKER", "s1", "/repo", "/log.txt", removeWorkspaceDir);
      expect(removeWorkspaceDir).toHaveBeenCalledWith("/repo", "/log.txt");
    });

    it("cleans up antigravity log via fs.rm in non-DOCKER mode", async () => {
      await cleanupProviderRuntimeArtifacts("antigravity", "HOST", "s1", "/repo", "/log.txt");
      expect(fs.rm).toHaveBeenCalledWith("/log.txt", { force: true });
    });
  });
});
