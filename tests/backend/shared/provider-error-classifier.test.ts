import { describe, it, expect } from "vitest";
import {
  classifyProviderError,
  extractProviderErrorCategory,
  extractRetryAfterIso,
  type ProviderErrorClassification,
} from "../../../src/shared/providers/provider-error-classifier.js";
import type { CommandResult } from "../../../src/shared/subprocess/command-runner.js";

const makeResult = (stdout: string, stderr: string): CommandResult => ({
  ok: false,
  code: 1,
  stdout,
  stderr,
});

describe("classifyProviderError", () => {
  describe("gemini", () => {
    it("detects quota exhaustion with reset time", () => {
      const result = makeResult(
        "",
        "TerminalQuotaError: You have exhausted your capacity on this model. Your quota will reset after 5h20m24s.",
      );
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBe("5h20m24s");
      expect(classification.resetAtIso).toBeTruthy();
      expect(classification.userMessage).toContain("Gemini quota exhausted");
      expect(classification.userMessage).toContain("5h20m24s");
    });

    it("detects quota exhaustion via QUOTA_EXHAUSTED reason", () => {
      const result = makeResult(
        "",
        "reason: 'QUOTA_EXHAUSTED'",
      );
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
    });

    it("detects auth failure via HybridTokenStorage", () => {
      const result = makeResult(
        "",
        "at HybridTokenStorage.initializeStorage (file:///some/path/hybrid-token-storage.js:37:24)",
      );
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("AUTH_FAILURE");
      expect(classification.userMessage).toContain("authentication failed");
    });

    it("detects auth failure via uv_os_get_passwd", () => {
      const result = makeResult(
        "",
        "syscall: 'uv_os_get_passwd'",
      );
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("AUTH_FAILURE");
    });

    it("does not misclassify Gemini runtime-home ENOENT as auth failure", () => {
      const result = makeResult(
        "",
        "Failed to save project registry to /workspace/.sprint-os-home/.gemini/projects.json: Error: ENOENT: no such file or directory, rename '/workspace/.sprint-os-home/.gemini/projects.json.tmp' -> '/workspace/.sprint-os-home/.gemini/projects.json'",
      );
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("UNKNOWN");
    });

    it("detects rate limiting via 429", () => {
      const result = makeResult("", "code: 429, message: 'too many requests'");
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("RATE_LIMITED");
    });

    it("detects no-capacity Gemini 429s as rate limits", () => {
      const result = makeResult("", "code: 429, message: 'No capacity available for model gemini-3.1-pro-preview on the server'");
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("RATE_LIMITED");
    });

    it("prioritizes quota over auth when both present", () => {
      const result = makeResult(
        "MCP issues detected.",
        [
          "at HybridTokenStorage.initializeStorage",
          "TerminalQuotaError: You have exhausted your capacity on this model. Your quota will reset after 2h10m5s.",
        ].join("\n"),
      );
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBe("2h10m5s");
    });
  });

  describe("claude-code", () => {
    it("detects auth failure via invalid API key", () => {
      const result = makeResult("", "Error: invalid api key provided");
      const classification = classifyProviderError("claude-code", result);
      expect(classification.category).toBe("AUTH_FAILURE");
      expect(classification.userMessage).toContain("Claude Code");
    });

    it("detects rate limiting", () => {
      const result = makeResult("", "Error: rate limit exceeded, please retry");
      const classification = classifyProviderError("claude-code", result);
      expect(classification.category).toBe("RATE_LIMITED");
    });
  });

  describe("codex", () => {
    it("detects auth failure", () => {
      const result = makeResult("", "Incorrect API key provided");
      const classification = classifyProviderError("codex", result);
      expect(classification.category).toBe("AUTH_FAILURE");
      expect(classification.userMessage).toContain("Codex");
    });

    it("detects quota exhaustion", () => {
      const result = makeResult("", "Error: insufficient quota remaining");
      const classification = classifyProviderError("codex", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
    });

    it("does not misclassify websocket 500 transport failures as auth errors", () => {
      const result = makeResult(
        "",
        "2026-04-10T14:10:18.814616Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 500 Internal Server Error, url: wss://api.openai.com/v1/responses",
      );
      const classification = classifyProviderError("codex", result);
      expect(classification.category).toBe("UNKNOWN");
    });
  });

  describe("generic", () => {
    it("detects provider not found via ENOENT", () => {
      const result = makeResult("", "Error: ENOENT: no such file or directory, spawn gemini");
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("PROVIDER_NOT_FOUND");
      expect(classification.userMessage).toContain("not found");
    });

    it("returns UNKNOWN for unrecognized errors", () => {
      const result = makeResult("some output", "something went wrong");
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("UNKNOWN");
    });

    it("computes resetAtIso from resetAfter", () => {
      const result = makeResult("", "quota will reset after 1h0m0s");
      const classification = classifyProviderError("gemini", result);
      expect(classification.resetAtIso).toBeTruthy();
      const resetAt = new Date(classification.resetAtIso!);
      const now = new Date();
      const diffMinutes = (resetAt.getTime() - now.getTime()) / 60000;
      expect(diffMinutes).toBeGreaterThan(55);
      expect(diffMinutes).toBeLessThan(65);
    });

    it("embeds retry/category tags into classified errors", () => {
      const result = makeResult("", "quota will reset after 1h0m0s");
      const classification = classifyProviderError("gemini", result);
      const message = new Error(`${classification.userMessage} [ERROR_CATEGORY:${classification.category}] [RETRY_AFTER:${classification.resetAtIso}]`).message;
      expect(extractProviderErrorCategory(message)).toBe("QUOTA_EXHAUSTED");
      expect(extractRetryAfterIso(message)).toBe(classification.resetAtIso);
    });
  });
});
