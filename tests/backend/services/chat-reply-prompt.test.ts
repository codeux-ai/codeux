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
  });

  describe("buildChatContinuationPrompt", () => {
    it("builds prompt correctly", () => {
      expect(buildChatContinuationPrompt({ bodyMarkdown: "hello" } as any)).toBe("### User\nhello");
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
