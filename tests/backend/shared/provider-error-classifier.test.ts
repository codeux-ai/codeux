import { describe, it, expect } from "vitest";
import {
  classifyProviderError,
  computeResetAfterFromClockTime,
  isTransientCodexTransportError,
  isClaudeConversationNotFoundError,
  extractProviderErrorCategory,
  extractRetryAfterIso,
  resultHasSilentQuotaSignal,
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

    it("detects OpenRouter key-limit exhaustion as quota", () => {
      const result = makeResult(
        "",
        "API Error: 403 Key limit exceeded (weekly limit). Manage it using https://openrouter.ai/workspaces/default/keys/a3a82d5bc13549c52b8ace84d8d0c08bdff407f730571d434b916d49bcf5d3fb",
      );
      const classification = classifyProviderError("gemini", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBeNull();
      expect(classification.resetAtIso).toBeNull();
      expect(classification.userMessage).toContain("Gemini quota exhausted");
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

    describe("auth variants", () => {
      it.each([
        "Session expired or is unauthorized.",
        "[API Error: API key not valid. Please pass a valid API key. (Status: INVALID_ARGUMENT)]",
        "[API Error: API Key not found. Please pass a valid API key. (Status: INVALID_ARGUMENT)]",
        "[API Error: API key expired. Please renew the API key. (Status: INVALID_ARGUMENT)]",
        "reason: API_KEY_INVALID",
      ])("classifies %s as AUTH_FAILURE", (stderr) => {
        const classification = classifyProviderError("gemini", makeResult("", stderr));
        expect(classification.category).toBe("AUTH_FAILURE");
      });
    });

    describe("quota / rate-limit variants", () => {
      it.each([
        "[API Error: You have exhausted your daily quota on this model.]",
        "Quota exceeded for quota metric 'Gemini 2.5 Pro Requests' and limit 'Gemini 2.5 Pro Requests per day per user per tier'",
        "Possible quota limitations in place or slow response times detected. Switching to the gemini-2.5-flash model for the rest of this session.",
        "Usage limit reached for gemini-3-flash-preview.",
      ])("classifies %s as QUOTA_EXHAUSTED", (stderr) => {
        const classification = classifyProviderError("gemini", makeResult("", stderr));
        expect(classification.category).toBe("QUOTA_EXHAUSTED");
      });

      it.each([
        "Rate Limit Exceeded",
        "got status: 429 Too Many Requests",
        "[API Error: Resource has been exhausted (e.g. check quota). (Status: RESOURCE_EXHAUSTED)]",
        "We are currently experiencing high demand.",
      ])("classifies %s as RATE_LIMITED", (stderr) => {
        const classification = classifyProviderError("gemini", makeResult("", stderr));
        expect(classification.category).toBe("RATE_LIMITED");
      });

      it("extracts the 'Suggested retry after 60s' duration on a quota error", () => {
        const classification = classifyProviderError(
          "gemini",
          makeResult("", "You have exhausted your daily quota on this model.\nSuggested retry after 60s."),
        );
        expect(classification.category).toBe("QUOTA_EXHAUSTED");
        expect(classification.resetAfter).toBe("60s");
        expect(classification.resetAtIso).toBeTruthy();
      });
    });
  });

  describe("claude-code", () => {
    it("detects auth failure via invalid API key", () => {
      const result = makeResult("", "Error: invalid api key provided");
      const classification = classifyProviderError("claude-code", result);
      expect(classification.category).toBe("AUTH_FAILURE");
      expect(classification.userMessage).toContain("Claude Code");
    });

    it("detects OpenRouter key-limit exhaustion as quota", () => {
      const result = makeResult(
        "",
        "API Error: 403 Key limit exceeded (weekly limit). Manage it using https://openrouter.ai/workspaces/default/keys/a3a82d5bc13549c52b8ace84d8d0c08bdff407f730571d434b916d49bcf5d3fb",
      );
      const classification = classifyProviderError("claude-code", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBeNull();
      expect(classification.resetAtIso).toBeNull();
      expect(classification.userMessage).toContain("Claude Code quota exhausted");
    });

    it("detects rate limiting", () => {
      const result = makeResult("", "Error: rate limit exceeded, please retry");
      const classification = classifyProviderError("claude-code", result);
      expect(classification.category).toBe("RATE_LIMITED");
    });

    describe("auth variants", () => {
      it.each([
        "Invalid API key · Please run /login",
        "Missing API key · Run /login",
        'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}',
        'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid bearer token"}}',
        'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired. Please obtain a new token or refresh your existing token."},"request_id":"req_1"} · Please run /login',
        "HTTP 401: authentication_error: OAuth token has expired. Please obtain a new token or refresh your existing token.",
        'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid OAuth token. The provided token was not found or is malformed."}} · Please run /login',
        "API Error: 400 invalid token: token has invalid claims: token is expired",
        'API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}} · Please run /login',
        "[Claude in Chrome] Bridge error: Invalid token or user mismatch",
      ])("classifies %s as AUTH_FAILURE", (stderr) => {
        const classification = classifyProviderError("claude-code", makeResult("", stderr));
        expect(classification.category).toBe("AUTH_FAILURE");
      });
    });

    describe("rate-limit / usage-limit variants", () => {
      it.each([
        "API Error: Rate limit reached",
        "⎿  API Error: Rate limit reached",
        'Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_1"}',
        "API Error: Request rejected (429) · Rate limited",
        "Error: Failed to load usage data: rate_limit_error",
      ])("classifies %s as RATE_LIMITED", (stderr) => {
        const classification = classifyProviderError("claude-code", makeResult("", stderr));
        expect(classification.category).toBe("RATE_LIMITED");
      });

      it.each([
        "You've hit your limit · resets 4pm (Asia/Kuala_Lumpur)",
        "Claude usage limit reached. Your limit will reset at 3pm (America/Santiago).",
        "You've hit your usage limit",
      ])("classifies %s as QUOTA_EXHAUSTED", (stderr) => {
        const classification = classifyProviderError("claude-code", makeResult("", stderr));
        expect(classification.category).toBe("QUOTA_EXHAUSTED");
      });
    });

    describe("extra-usage entitlement (must not be a retryable rate limit)", () => {
      it.each([
        'Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Extra usage is required for long context requests."},"request_id":"req_1"}',
        "API Error: Extra usage is required for 1M context · run /extra-usage to enable, or /model to switch to standard context",
        "API Error: Extra usage is required for 1M context · enable extra usage at claude.ai/settings/usage, or use --model to switch to standard context",
      ])("routes %s to terminal UNKNOWN with the actionable detail surfaced", (stderr) => {
        const classification = classifyProviderError("claude-code", makeResult("", stderr));
        expect(classification.category).toBe("UNKNOWN");
        expect(classification.userMessage).toContain("Extra usage is required");
      });
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

    it("detects OpenRouter key-limit exhaustion as quota", () => {
      const result = makeResult(
        "",
        "API Error: 403 Key limit exceeded (weekly limit). Manage it using https://openrouter.ai/workspaces/default/keys/a3a82d5bc13549c52b8ace84d8d0c08bdff407f730571d434b916d49bcf5d3fb",
      );
      const classification = classifyProviderError("codex", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBeNull();
      expect(classification.resetAtIso).toBeNull();
      expect(classification.userMessage).toContain("Codex quota exhausted");
    });

    it("does not misclassify websocket 500 transport failures as auth errors", () => {
      const result = makeResult(
        "",
        "2026-04-10T14:10:18.814616Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 500 Internal Server Error, url: wss://api.openai.com/v1/responses",
      );
      const classification = classifyProviderError("codex", result);
      expect(classification.category).toBe("UNKNOWN");
    });

    it("surfaces the real model-not-supported reason from `codex exec --json` events", () => {
      const stdout = [
        '{"type":"thread.started","thread_id":"019e8bbe-567d-7d52-8a09-2007b61b7ef9"}',
        '{"type":"turn.started"}',
        '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'gpt-5.3-codex\' model is not supported when using Codex with a ChatGPT account.\\"}}"}',
        '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'gpt-5.3-codex\' model is not supported when using Codex with a ChatGPT account.\\"}}"}}',
      ].join("\n");
      const classification = classifyProviderError("codex", makeResult(stdout, "Reading additional input from stdin..."));
      expect(classification.category).toBe("UNKNOWN");
      expect(classification.userMessage).toBe(
        "Codex failed: The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
      );
      expect(classification.userMessage).not.toContain("unexpected error");
      expect(classification.userMessage).not.toContain("stdin");
    });

    it("falls back to the generic unexpected-error text when codex produced no parseable detail", () => {
      const classification = classifyProviderError("codex", makeResult("", "Reading additional input from stdin..."));
      expect(classification.category).toBe("UNKNOWN");
      expect(classification.userMessage).toBe("Codex failed with an unexpected error.");
    });

    describe("auth variants", () => {
      it.each([
        "Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.",
        "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.",
        "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.",
        "Your access token could not be refreshed. Please log out and sign in again.",
        "Failed to refresh token: 401 Unauthorized: invalid_grant",
        "Missing bearer or basic authentication in header",
        "ERROR: unexpected status 401 Unauthorized: You have insufficient permissions for this operation. Missing scopes: api.responses.write.",
        "Invalid JWT form. A JWT consists of three parts separated by dots. (reason=token-invalid, token-carrier=header)",
      ])("classifies %s as AUTH_FAILURE", (stderr) => {
        const classification = classifyProviderError("codex", makeResult("", stderr));
        expect(classification.category).toBe("AUTH_FAILURE");
      });

      it("classifies a JSONL-wrapped refresh-token failure as AUTH_FAILURE", () => {
        const stdout = '{"type":"turn.failed","error":{"message":"Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again."}}';
        const classification = classifyProviderError("codex", makeResult(stdout, ""));
        expect(classification.category).toBe("AUTH_FAILURE");
      });
    });

    describe("quota variants", () => {
      it.each([
        "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again later.",
        "Your workspace is out of credits. Add credits to continue.",
        "You hit your spend cap set in your workspace. Increase your spend cap to continue.",
        "Quota exceeded. Check your plan and billing details.",
        "You've hit your usage limit. To get more access now, send a request to your admin or try again later.",
        "You've hit your usage limit for gpt-5-codex. Switch to another model now, or try again later.",
      ])("classifies %s as QUOTA_EXHAUSTED", (stderr) => {
        const classification = classifyProviderError("codex", makeResult("", stderr));
        expect(classification.category).toBe("QUOTA_EXHAUSTED");
      });

      it("classifies the TUI bullet-prefixed quota line", () => {
        const classification = classifyProviderError("codex", makeResult("", "■ Quota exceeded. Check your plan and billing details."));
        expect(classification.category).toBe("QUOTA_EXHAUSTED");
      });

      it("classifies a JSONL-wrapped usage-limit event and extracts the clock-time reset", () => {
        const stdout = '{"type":"error","message":"You\'ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:54 AM."}';
        const classification = classifyProviderError("codex", makeResult(stdout, ""));
        expect(classification.category).toBe("QUOTA_EXHAUSTED");
        expect(classification.resetAfter).toMatch(/^\d+h\d+m\d+s$/);
        expect(classification.resetAtIso).toBeTruthy();
      });
    });

    describe("rate-limit variants", () => {
      it("classifies the 429 retry-exhaustion line as RATE_LIMITED", () => {
        const classification = classifyProviderError(
          "codex",
          makeResult("", "ERROR: exceeded retry limit, last status: 429 Too Many Requests, request id: req_123"),
        );
        expect(classification.category).toBe("RATE_LIMITED");
      });

      it("keeps a non-429 retry-exhaustion as UNKNOWN", () => {
        const classification = classifyProviderError(
          "codex",
          makeResult("", "ERROR: exceeded retry limit, last status: 500 Internal Server Error, request id: req_123"),
        );
        expect(classification.category).toBe("UNKNOWN");
      });

      it("extracts the seconds reset from the backend slow-down body", () => {
        const classification = classifyProviderError(
          "codex",
          makeResult("", "You've exceeded the rate limit, please slow down and try again after 30 seconds."),
        );
        expect(classification.category).toBe("RATE_LIMITED");
        expect(classification.resetAfter).toBe("30s");
        expect(classification.resetAtIso).toBeTruthy();
      });

      it("extracts the seconds reset from the OpenAI TPM rate-limit body", () => {
        const classification = classifyProviderError(
          "codex",
          makeResult(
            "",
            "[Error]: Rate limit reached for o3 in organization org-abc on tokens per min (TPM): Limit 30000, Used 29000, Requested 2000. Please try again in 12s. Visit https://platform.openai.com/account/rate-limits to learn more.",
          ),
        );
        expect(classification.category).toBe("RATE_LIMITED");
        expect(classification.resetAfter).toBe("12s");
      });
    });
  });

  describe("UNKNOWN error detail surfacing", () => {
    it("surfaces a plain-text error line for non-codex providers instead of the opaque fallback", () => {
      const classification = classifyProviderError(
        "claude-code",
        makeResult("", "Something exploded: the frobnicator refused the request"),
      );
      expect(classification.category).toBe("UNKNOWN");
      expect(classification.userMessage).toBe(
        "Claude Code failed: Something exploded: the frobnicator refused the request",
      );
    });
  });

  describe("qwen-code", () => {
    it("detects OpenRouter key-limit exhaustion as quota", () => {
      const result = makeResult(
        "",
        "API Error: 403 Key limit exceeded (weekly limit). Manage it using https://openrouter.ai/workspaces/default/keys/a3a82d5bc13549c52b8ace84d8d0c08bdff407f730571d434b916d49bcf5d3fb",
      );
      const classification = classifyProviderError("qwen-code", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBeNull();
      expect(classification.resetAtIso).toBeNull();
      expect(classification.userMessage).toContain("Qwen Code quota exhausted");
    });

    it("preserves qwen usage-limit reset extraction", () => {
      const result = makeResult(
        "",
        "ERROR: You've hit your usage limit. Upgrade to Pro to purchase more credits or try again at 3:54 AM.",
      );
      const classification = classifyProviderError("qwen-code", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toMatch(/^\d+h\d+m\d+s$/);
      expect(classification.resetAtIso).toBeTruthy();
    });

    it("detects qwen custom provider auth failures", () => {
      const result = makeResult("", "Error: Incorrect API key provided for OPENAI_API_KEY");
      const classification = classifyProviderError("qwen-code", result);
      expect(classification.category).toBe("AUTH_FAILURE");
      expect(classification.userMessage).toContain("Qwen Code");
    });
  });

  describe("opencode", () => {
    it("detects OpenRouter key-limit exhaustion as quota", () => {
      const result = makeResult(
        "",
        "API Error: 403 Key limit exceeded (weekly limit). Manage it using https://openrouter.ai/workspaces/default/keys/a3a82d5bc13549c52b8ace84d8d0c08bdff407f730571d434b916d49bcf5d3fb",
      );
      const classification = classifyProviderError("opencode", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBeNull();
      expect(classification.resetAtIso).toBeNull();
      expect(classification.userMessage).toContain("OpenCode quota exhausted");
    });

    it("detects OpenCode custom provider auth failures", () => {
      const result = makeResult("", "Error: Incorrect API key provided for OPENCODE_API_KEY");
      const classification = classifyProviderError("opencode", result);
      expect(classification.category).toBe("AUTH_FAILURE");
      expect(classification.userMessage).toContain("OpenCode");
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

    it("detects OpenRouter key-limit exhaustion as quota", () => {
      const result = makeResult(
        "",
        "API Error: 403 Key limit exceeded (weekly limit). Manage it using https://openrouter.ai/workspaces/default/keys/a3a82d5bc13549c52b8ace84d8d0c08bdff407f730571d434b916d49bcf5d3fb",
      );
      const classification = classifyProviderError("antigravity", result);
      expect(classification.category).toBe("QUOTA_EXHAUSTED");
      expect(classification.resetAfter).toBeNull();
      expect(classification.resetAtIso).toBeNull();
      expect(classification.userMessage).toContain("Antigravity quota exhausted");
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

    describe("auth variants", () => {
      it.each([
        "Authentication required. Please visit the URL to log in:",
        "Authentication Required Please sign in.",
        "Invalid Token",
        "Login Expired",
        "Not Eligible",
        "No auth token found",
        "Failed to poll ListExperiments: error getting token source: You are not logged into Antigravity.",
        "keyringAuth: failed to load token: failed to unlock correct collection '/org/freedesktop/secrets/aliases/default'",
        "consumerOAuth: failed to persist token to keyring: The name org.freedesktop.secrets was not provided by any .service files",
        "failed to set auth token",
      ])("classifies %s as AUTH_FAILURE", (stderr) => {
        const classification = classifyProviderError("antigravity", makeResult("", stderr));
        expect(classification.category).toBe("AUTH_FAILURE");
      });
    });

    describe("quota variants", () => {
      it.each([
        "Baseline model quota reached",
        "Model quota reached",
        "Usage Limit Reached",
      ])("classifies %s as QUOTA_EXHAUSTED", (stderr) => {
        const classification = classifyProviderError("antigravity", makeResult("", stderr));
        expect(classification.category).toBe("QUOTA_EXHAUSTED");
      });

      it("converts a 'resets after N days' weekly window into an hours reset", () => {
        const classification = classifyProviderError(
          "antigravity",
          makeResult("", "Quota Limit reached and resets after 6 days"),
        );
        expect(classification.category).toBe("QUOTA_EXHAUSTED");
        expect(classification.resetAfter).toBe("144h");
        expect(classification.resetAtIso).toBeTruthy();
      });
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

describe("isTransientCodexTransportError", () => {
  it("returns true for stream disconnected before completion", () => {
    const result = makeResult("Stream disconnected before completion", "");
    expect(isTransientCodexTransportError(result)).toBe(true);
  });
  it("returns true for error sending request for url", () => {
    const result = makeResult("", "Error sending request for url");
    expect(isTransientCodexTransportError(result)).toBe(true);
  });
  it("returns true for channel closed", () => {
    const result = makeResult("Channel closed", "some other error");
    expect(isTransientCodexTransportError(result)).toBe(true);
  });
  it("returns false for unrelated errors", () => {
    const result = makeResult("Syntax error", "Missing semicolon");
    expect(isTransientCodexTransportError(result)).toBe(false);
  });
});

describe("isClaudeConversationNotFoundError", () => {
  it("returns true for no conversation found in stdout", () => {
    const result = makeResult("No conversation found for ID 123", "");
    expect(isClaudeConversationNotFoundError(result)).toBe(true);
  });
  it("returns true for no conversation found in stderr", () => {
    const result = makeResult("", "no conversation found");
    expect(isClaudeConversationNotFoundError(result)).toBe(true);
  });
  it("returns false for unrelated errors", () => {
    const result = makeResult("Usage limit exceeded", "");
    expect(isClaudeConversationNotFoundError(result)).toBe(false);
  });
});
