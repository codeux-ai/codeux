import { describe, it, expect } from "vitest";
import {
  normalizeProviderReply,
  stripDashboardOnlyWidgets,
  getCompactionSummary,
  getMessagesAfterCompaction,
  buildChatReplayPrompt,
  buildChatContinuationPrompt,
  buildChatCompactionPrompt,
} from "../../../src/services/chat-reply-prompt.js";
import { ConversationThreadRecord, ConversationMessageRecord, ConversationRuntimeState } from "../../../src/contracts/connection-chat-types.js";

describe("chat-reply-prompt", () => {
  describe("normalizeProviderReply", () => {
    it("trims raw text and returns it when not JSON", () => {
      expect(normalizeProviderReply("  Hello world  ")).toBe("Hello world");
    });

    it("extracts the response property from valid JSON", () => {
      expect(normalizeProviderReply('{"response": "Extracted answer"}')).toBe("Extracted answer");
    });

    it("extracts provider response envelopes from noisy CLI output", () => {
      const output = [
        "added 7 packages in 10s",
        JSON.stringify({
          session_id: "5d97e956-0b05-489b-8f4c-62ab8612558c",
          response: "Only the answer message.",
          stats: { models: {} },
        }),
        "npm notice New minor version of npm available!",
        "YOLO mode is enabled. All tool calls will be automatically approved.",
      ].join("\n");

      expect(normalizeProviderReply(output)).toBe("Only the answer message.");
    });

    it("handles empty strings", () => {
      expect(normalizeProviderReply("")).toBe("");
    });
  });

  describe("getCompactionSummary", () => {
    it("returns null if runtimeState is null", () => {
      expect(getCompactionSummary(null)).toBeNull();
    });

    it("returns null if compactionSummary is missing", () => {
      expect(getCompactionSummary({} as any)).toBeNull();
    });

    it("returns null if markdown is missing or empty", () => {
      expect(getCompactionSummary({ compactionSummary: { markdown: "   " } } as any)).toBeNull();
    });

    it("returns summary if valid", () => {
      const summary = { markdown: "valid" };
      expect(getCompactionSummary({ compactionSummary: summary } as any)).toBe(summary);
    });
  });

  describe("getMessagesAfterCompaction", () => {
    it("returns all messages if no sourceMessageId", () => {
      const messages = [{ id: "1" }] as any;
      expect(getMessagesAfterCompaction(messages, {} as any)).toBe(messages);
    });

    it("returns all messages if sourceMessageId not found", () => {
      const messages = [{ id: "1" }] as any;
      expect(getMessagesAfterCompaction(messages, { sourceMessageId: "2" } as any)).toBe(messages);
    });

    it("returns sliced messages", () => {
      const messages = [{ id: "1" }, { id: "2" }, { id: "3" }] as any;
      expect(getMessagesAfterCompaction(messages, { sourceMessageId: "2" } as any)).toEqual([{ id: "3" }]);
    });
  });

  describe("buildChatReplayPrompt", () => {
    const thread = { id: "t1", title: "Test", runtimeState: null } as any;

    it("builds correct prompt for dashboard reply", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [{ authorType: "dashboard_user", bodyMarkdown: "Hello" } as any],
        workerInstructions: "Work fast",
        isDashboardReply: true,
      });
      expect(prompt).toContain("## WORKER INSTRUCTIONS");
      expect(prompt).toContain("Work fast");
      expect(prompt).toContain("## ROLE");
      expect(prompt).toContain("Do not start implementation from this message. This is a reply-only interaction.");
      expect(prompt).toContain("### User\nHello");
    });

    it("builds correct prompt without messages but bodyMarkdown", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [],
        bodyMarkdown: "Hello",
        workerInstructions: "",
      });
      expect(prompt).not.toContain("## WORKER INSTRUCTIONS");
      expect(prompt).toContain("### User\nHello");
      expect(prompt).toContain("You must return STRICT JSON format containing `replyMarkdown`, `action`, and optional `suggestions` and `agentEffect`.");
      expect(prompt).toContain("Each item must be `{ \"label\": string, \"prompt\": string, \"icon\"?: string, \"id\"?: string }`.");
      expect(prompt).toContain("Use only stable string icon identifiers");
      expect(prompt).toContain("optional `suggestions` and `agentEffect`");
      expect(prompt).toContain("`durationMs` must be from 500 through 10000");
    });

    it("includes pending management action context if it exists in runtime state", () => {
      const threadWithPending = {
        id: "t1",
        title: "Test",
        runtimeState: {
          pendingManagementAction: {
            action: { domain: "projects", action: "delete_project", payload: {} },
            approvalMessage: "Are you sure you want to delete this project?",
            proposedAt: new Date().toISOString(),
          }
        }
      } as any;
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread: threadWithPending,
        messages: [{ authorType: "dashboard_user", bodyMarkdown: "yes" } as any],
        workerInstructions: "",
      });
      expect(prompt).toContain("## PENDING ACTION CONTEXT");
      expect(prompt).toContain("delete_project");
      expect(prompt).toContain("Are you sure you want to delete this project?");
    });

    it("builds correct prompt with compaction summary", () => {
      const compactedThread = { id: "t1", title: "Test", runtimeState: { compactionSummary: { markdown: "compacted" } } } as any;
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread: compactedThread,
        messages: [],
        workerInstructions: "",
      });
      expect(prompt).toContain("## COMPACTED HISTORY");
      expect(prompt).toContain("compacted");
      expect(prompt).toContain("_No new messages since the compaction summary was generated._");
    });

    it("uses JSON output instructions when mcpAvailable is false", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [{ authorType: "dashboard_user", bodyMarkdown: "Hello" } as any],
        workerInstructions: "",
        mcpAvailable: false,
      });
      expect(prompt).toContain("You must return STRICT JSON format");
      expect(prompt).toContain("optional `suggestions`");
      expect(prompt).toContain("`custom_dashboards`");
      expect(prompt).toContain("maps to the `manage_custom_dashboards` MCP surface");
      expect(prompt).not.toContain("manage_code_ux");
    });

    it("uses MCP-native output instructions when mcpAvailable is true", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [{ authorType: "dashboard_user", bodyMarkdown: "Hello" } as any],
        workerInstructions: "",
        mcpAvailable: true,
      });
      expect(prompt).toContain("manage_code_ux");
      expect(prompt).toContain("manage_custom_dashboards");
      expect(prompt).toContain("publish_revision");
      expect(prompt).toContain("Do NOT wrap your response in JSON");
      expect(prompt).toContain("`codeux:agent` fenced JSON block");
      expect(prompt).not.toContain("You must return STRICT JSON format");
    });

    it("instructs custom dashboard requests to create validated management revisions before publishing", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [{ authorType: "dashboard_user", bodyMarkdown: "Build me an ops dashboard and publish it" } as any],
        workerInstructions: "",
        mcpAvailable: true,
      });

      expect(prompt).toContain("Custom dashboard management");
      expect(prompt).toContain("purpose, data sources, styleguide constraints, layout expectations, and publication intent");
      expect(prompt).toContain("manifest metadata");
      expect(prompt).toContain("source node graph definitions");
      expect(prompt).toContain("dependency-free Preact/Tailwind-compatible");
      expect(prompt).toContain("Do not instruct agents to write user-created dashboards into `dashboard/src`");
      expect(prompt).toContain("start `validate_revision`");
      expect(prompt).toContain("Never call `publish_revision` until validation status is `passed`");
      expect(prompt).toContain("create a repair revision");
    });

    it("uses scheduler-only MCP instructions without advertising management tools", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [{ authorType: "dashboard_user", bodyMarkdown: "Remind yourself later" } as any],
        workerInstructions: "",
        mcpAvailable: true,
        mcpAccessMode: "scheduler_only",
      });
      expect(prompt).toContain("You have the `scheduler_code_ux` MCP tool available");
      expect(prompt).toContain("It supports `list`, `schedule_wakeup`, and `cancel`.");
      expect(prompt).not.toContain("schedule_task");
      expect(prompt).not.toContain("You have the `manage_code_ux` MCP tool available");
      expect(prompt).not.toContain("You must return STRICT JSON format");
    });

    it("defaults to JSON output instructions when mcpAvailable is omitted", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [{ authorType: "dashboard_user", bodyMarkdown: "Hello" } as any],
        workerInstructions: "",
      });
      expect(prompt).toContain("You must return STRICT JSON format");
      expect(prompt).not.toContain("manage_code_ux");
    });

    it("instructs the Project manager to persist and visibly confirm durable memory", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [{ authorType: "dashboard_user", bodyMarkdown: "Remember our service convention" } as any],
        workerInstructions: "Act as Project manager.",
        mcpAvailable: true,
      });

      expect(prompt).toContain("call `add_long_term_memory`; do not merely promise to remember");
      expect(prompt).toContain("re-emit the tool result's exact memory, category, claimId, and memoryId");
      expect(prompt).toContain("```codeux:memory");
      expect(prompt).toContain("Emit this after `add_long_term_memory` succeeds");
    });

    it("omits dashboard widget instructions for chat-provider-sourced replies", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [{ authorType: "dashboard_user", bodyMarkdown: "Hello" } as any],
        workerInstructions: "",
        suppressRichWidgets: true,
      });
      expect(prompt).not.toContain("## RICH WIDGETS");
      expect(prompt).not.toContain("codeux:status");
      expect(prompt).not.toContain("codeux:agent");
    });

    it("strips dashboard widget fences from replayed assistant replies for external chat threads", () => {
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread,
        messages: [
          { authorType: "dashboard_user", bodyMarkdown: "How is the build?" } as any,
          {
            authorType: "connection",
            bodyMarkdown: [
              "The build is green.",
              "",
              "```codeux:status",
              JSON.stringify({ title: "Build", items: [{ label: "Lint", state: "ok" }] }),
              "```",
            ].join("\n"),
          } as any,
        ],
        workerInstructions: "",
        suppressRichWidgets: true,
      });

      expect(prompt).toContain("The build is green.");
      expect(prompt).toContain("Build\n- Lint: ok");
      expect(prompt).not.toContain("```codeux:status");
      expect(prompt).not.toContain('"items"');
    });

    it("strips dashboard widget fences from compacted history for external chat threads", () => {
      const compactedThread = {
        id: "t1",
        title: "Test",
        runtimeState: {
          compactionSummary: {
            markdown: [
              "Earlier status was summarized.",
              "",
              "```codeux:status",
              JSON.stringify({ title: "Deploy", items: [{ label: "Ready", state: "ok" }] }),
              "```",
            ].join("\n"),
          },
        },
      } as any;
      const prompt = buildChatReplayPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread: compactedThread,
        messages: [],
        workerInstructions: "",
        suppressRichWidgets: true,
      });

      expect(prompt).toContain("Earlier status was summarized.");
      expect(prompt).toContain("Deploy\n- Ready: ok");
      expect(prompt).not.toContain("```codeux:status");
      expect(prompt).not.toContain('"items"');
    });
  });

  describe("buildChatContinuationPrompt", () => {
    it("builds prompt correctly", () => {
      const prompt = buildChatContinuationPrompt({ bodyMarkdown: "hello" } as any);
      expect(prompt).toContain("## DASHBOARD CHAT CONTINUATION");
      expect(prompt).toContain("### User\nhello");
      expect(prompt).toContain("ignore provider/system setup text");
    });

    it("tells external chat continuations not to emit dashboard widgets", () => {
      const prompt = buildChatContinuationPrompt({ bodyMarkdown: "hello" } as any, undefined, false, undefined, true);
      expect(prompt).toContain("Do not include dashboard-only `codeux:*` fenced widget blocks.");
      expect(prompt).not.toContain("codeux:status / codeux:tasks");
    });

    it("includes pending management action context if provided", () => {
      const prompt = buildChatContinuationPrompt(
        { bodyMarkdown: "hello" } as any,
        { action: { domain: "test", action: "test" }, approvalMessage: "approve?", proposedAt: "2023" } as any
      );
      expect(prompt).toContain("## PENDING ACTION CONTEXT");
      expect(prompt).toContain("approve?");
      expect(prompt).toContain("### User\nhello");
    });
  });

  describe("stripDashboardOnlyWidgets", () => {
    it("removes dashboard-only widget fences while preserving markdown prose", () => {
      const markdown = [
        "Here is the status.",
        "",
        "```codeux:status",
        JSON.stringify({
          title: "Build",
          items: [{ label: "Lint", state: "ok", value: "passed" }],
          note: "Ready for review.",
        }),
        "```",
        "",
        "Approval still required: please reply yes.",
      ].join("\n");

      expect(stripDashboardOnlyWidgets(markdown)).toBe([
        "Here is the status.",
        "",
        "Build",
        "- Lint: ok: passed",
        "Ready for review.",
        "",
        "Approval still required: please reply yes.",
      ].join("\n"));
    });

    it("downgrades suggested actions to readable markdown", () => {
      const markdown = [
        "Next options:",
        "```codeux:actions",
        JSON.stringify({ items: [{ label: "Start sprint", prompt: "Start the queued sprint" }] }),
        "```",
      ].join("\n");

      expect(stripDashboardOnlyWidgets(markdown)).toContain("Suggested next steps:\n- Start sprint: Start the queued sprint");
    });

    it("downgrades long-term-memory confirmation to readable prose", () => {
      const markdown = [
        "Saved.",
        "```codeux:memory",
        JSON.stringify({
          memory: "Use dependency-aware sprint tasks.",
          category: "patterns",
          claimId: "claim-1",
          memoryId: "memory-1",
          status: "stored",
        }),
        "```",
      ].join("\n");

      expect(stripDashboardOnlyWidgets(markdown)).toBe([
        "Saved.",
        "Remembered (patterns): Use dependency-aware sprint tasks.",
      ].join("\n"));
    });

    it("removes valid agent-effect fences from outbound markdown", () => {
      const markdown = [
        "Great news.",
        "```codeux:agent",
        JSON.stringify({ emotion: "excited", animation: "hyped", caption: "All green!", durationMs: 2500 }),
        "```",
      ].join("\n");

      expect(stripDashboardOnlyWidgets(markdown)).toBe("Great news.");
      expect(stripDashboardOnlyWidgets(markdown)).not.toContain("codeux:agent");
    });

    it("downgrades malformed agent-effect fences without leaking the dashboard fence tag", () => {
      const markdown = "Reply\n```codeux:agent\n{not json}\n```";
      expect(stripDashboardOnlyWidgets(markdown)).toBe("Reply\n```json\n{not json}\n```");
    });

    it("preserves unknown agent-effect payloads as readable JSON", () => {
      const markdown = [
        "Reply",
        "```codeux:agent",
        JSON.stringify({ emotion: "happy", animation: "teleport", durationMs: 1000 }),
        "```",
      ].join("\n");
      expect(stripDashboardOnlyWidgets(markdown)).toContain("```json");
      expect(stripDashboardOnlyWidgets(markdown)).toContain('"animation":"teleport"');
      expect(stripDashboardOnlyWidgets(markdown)).not.toContain("codeux:agent");
    });
  });

  describe("buildChatCompactionPrompt", () => {
    it("builds prompt correctly", () => {
      const prompt = buildChatCompactionPrompt({
        projectId: "p1",
        repoPath: "/repo",
        projectName: "Proj",
        thread: { id: "t1" } as any,
        messages: [{ authorType: "connection", bodyMarkdown: "worker says hi" } as any],
        workerInstructions: "worker inst",
      });
      expect(prompt).toContain("worker inst");
      expect(prompt).toContain("worker says hi");
      expect(prompt).toContain("## ROLE");
      expect(prompt).toContain("Structure the summary with these sections in order");
    });
  });
});

  describe("getCompactionSummary", () => {
    it("returns null if markdown is missing", () => {
      expect(getCompactionSummary({ compactionSummary: {} } as any)).toBeNull();
    });
  });

  describe("normalizeProviderReply", () => {
    it("safely handles invalid JSON in string", () => {
      expect(normalizeProviderReply('{"response": invalid}')).toBe('{"response": invalid}');
    });
  });

  describe("getMessagesAfterCompaction", () => {
    it("returns all messages if no index match", () => {
      const messages = [{ id: "1" }] as any;
      expect(getMessagesAfterCompaction(messages, { sourceMessageId: "not-found" } as any)).toBe(messages);
    });
  });
