import { describe, it, expect } from "vitest";
import {
  normalizeProviderReply,
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
      expect(prompt).toContain("You must return STRICT JSON format containing exactly two keys: `replyMarkdown` and `action`");
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
      expect(prompt).toContain("Do NOT wrap your response in JSON");
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
  });

  describe("buildChatContinuationPrompt", () => {
    it("builds prompt correctly", () => {
      expect(buildChatContinuationPrompt({ bodyMarkdown: "hello" } as any)).toBe("### User\nhello");
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
