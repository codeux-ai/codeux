import { describe, it, expect } from "vitest";
import {
  classifyProviderError,
  computeResetAfterFromClockTime,
  extractProviderErrorCategory,
  extractRetryAfterIso,
  resultHasSilentQuotaSignal,
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
        "Failed to save project registry to /workspace/.code-ux-home/.gemini/projects.json: Error: ENOENT: no such file or directory, rename '/workspace/.code-ux-home/.gemini/projects.json.tmp' -> '/workspace/.code-ux-home/.gemini/projects.json'",
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

    it("detects the real `codex exec` usage-limit error and extracts the reset time", () => {
      const result = makeResult(
        "",
        "ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:54 AM.",
      );
      const classification = classifyProviderError("codex", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.userMessage).toContain("Codex quota exhausted");
      // "try again at 3:54 AM" resolves to a future reset timestamp.
      expect(classification.resetAfter).toMatch(/^\d+h\d+m\d+s$/);
      expect(classification.resetAtIso).toBeTruthy();
      expect(new Date(classification.resetAtIso!).getTime()).toBeGreaterThan(Date.now());
    });

    it("detects usage-limit exhaustion even without a parseable reset time", () => {
      const result = makeResult(
        "",
        "ERROR: You've hit your usage limit. Upgrade to Pro to continue.",
      );
      const classification = classifyProviderError("codex", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBeNull();
      expect(classification.resetAtIso).toBeNull();
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

  describe("antigravity", () => {
    it("detects quota exhaustion with reset time from the real agy log line", () => {
      // The exact line agy writes to its log file (RESOURCE_EXHAUSTED wrapper included).
      const result = makeResult(
        "",
        "RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact your administrator to enable overages. Resets in 3h4m52s.",
      );
      const classification = classifyProviderError("antigravity", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBe("3h4m52s");
      expect(classification.resetAtIso).toBeTruthy();
      expect(classification.userMessage).toContain("Antigravity quota exhausted");
      expect(classification.userMessage).toContain("3h4m52s");
    });

    it("classifies quota even without a parseable reset time", () => {
      const result = makeResult("Individual quota reached. Contact your administrator to enable overages.", "");
      const classification = classifyProviderError("antigravity", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBeNull();
    });

    it("detects auth failure", () => {
      const result = makeResult("", "Error: invalid api key provided");
      const classification = classifyProviderError("antigravity", result);
      expect(classification.category).toBe("AUTH_FAILURE");
      expect(classification.userMessage).toContain("Antigravity");
    });

    it("detects rate limiting via 429", () => {
      const result = makeResult("", "code: 429, message: 'too many requests'");
      const classification = classifyProviderError("antigravity", result);
      expect(classification.category).toBe("RATE_LIMITED");
    });
  });

  describe("resultHasSilentQuotaSignal", () => {
    it("flags an exit-0 antigravity run whose output carries the quota message", () => {
      const result: CommandResult = {
        ok: true,
        code: 0,
        stdout: "Individual quota reached. Contact your administrator to enable overages. Resets in 3h4m52s.",
        stderr: "",
      };
      expect(resultHasSilentQuotaSignal("antigravity", result)).toBe(true);
    });

    it("does not flag a normal antigravity completion", () => {
      const result: CommandResult = {
        ok: true,
        code: 0,
        stdout: "Implemented the feature and committed the changes.",
        stderr: "",
      };
      expect(resultHasSilentQuotaSignal("antigravity", result)).toBe(false);
    });

    it("never flags other providers even if their output mentions quota", () => {
      const result: CommandResult = {
        ok: true,
        code: 0,
        stdout: "Individual quota reached. Contact your administrator to enable overages.",
        stderr: "",
      };
      expect(resultHasSilentQuotaSignal("gemini", result)).toBe(false);
      expect(resultHasSilentQuotaSignal("claude-code", result)).toBe(false);
    });
  });

  describe("computeResetAfterFromClockTime", () => {
    it("resolves a clock time later today into a same-day duration", () => {
      // Now: 01:00, reset at 3:54 AM → 2h54m0s away, same day.
      const now = new Date(2026, 5, 2, 1, 0, 0, 0).getTime();
      expect(computeResetAfterFromClockTime("try again at 3:54 AM.", now)).toBe("2h54m0s");
    });

    it("rolls a clock time that already passed today to tomorrow", () => {
      // Now: 05:00, reset at 3:54 AM → already passed, so next 3:54 AM is ~21h57m away.
      const now = new Date(2026, 5, 2, 5, 0, 30, 0).getTime();
      expect(computeResetAfterFromClockTime("try again at 3:54 AM.", now)).toBe("22h53m30s");
    });

    it("handles 12-hour PM conversion", () => {
      // Now: 10:00, reset at 2:30 PM → 14:30 → 4h30m away.
      const now = new Date(2026, 5, 2, 10, 0, 0, 0).getTime();
      expect(computeResetAfterFromClockTime("try again at 2:30 PM.", now)).toBe("4h30m0s");
    });

    it("returns null when no clock time is present", () => {
      expect(computeResetAfterFromClockTime("You've hit your usage limit.")).toBeNull();
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

  describe("new expanded patterns", () => {
    it("detects gemini invalid api key", () => {
      const result = makeResult("", "Error: invalid api key provided");
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("AUTH_FAILURE");
    });

    it("detects claude out of funds", () => {
      const result = makeResult("", "Error: Out of funds");
      const classification = classifyProviderError("claude-code", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
    });
  });
