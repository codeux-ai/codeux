import { describe, expect, it } from "vitest";
import {
  CHAT_DRAFT_QUERY_PARAM,
  createNoProjectAssistantReply,
  NO_PROJECT_ASSISTANT_PROMPTS,
  readChatDraftFromLocation,
} from "../../../dashboard/src/v2/lib/no-project-chat-assistant.js";

describe("no-project chat assistant model", () => {
  it("defines exactly five polished quick prompts", () => {
    expect(NO_PROJECT_ASSISTANT_PROMPTS).toHaveLength(5);
    expect(NO_PROJECT_ASSISTANT_PROMPTS.map((prompt) => prompt.id)).toEqual([
      "add-first-project",
      "add-desktop-app-project",
      "add-web-app-project",
      "explain-code-ux",
      "change-settings",
    ]);

    for (const prompt of NO_PROJECT_ASSISTANT_PROMPTS) {
      expect(prompt.label.trim().length).toBeGreaterThan(0);
      expect(prompt.prompt.trim().length).toBeGreaterThan(0);
      expect(prompt.reply.trim().length).toBeGreaterThan(0);
      expect(prompt.actions.length).toBeGreaterThan(0);
    }
  });

  it("returns the matched local reply and explicit actions for a quick prompt", () => {
    const reply = createNoProjectAssistantReply("Add a project and set it up as a web app.");

    expect(reply.matchedPromptId).toBe("add-web-app-project");
    expect(reply.body).toContain("web app setup path");
    expect(reply.actions.map((action) => action.id)).toContain("open-add-project");
  });

  it("falls back to safe setup actions for arbitrary widget drafts", () => {
    const reply = createNoProjectAssistantReply("Can you help me get started?");

    expect(reply.matchedPromptId).toBeNull();
    expect(reply.body).toContain("once a project exists");
    expect(reply.actions.map((action) => action.id)).toEqual([
      "open-add-project",
      "open-settings",
      "read-docs",
    ]);
  });

  it("reads only non-empty URL drafts", () => {
    const url = new URL(`http://localhost/chat?${CHAT_DRAFT_QUERY_PARAM}=Plan%20setup`);
    expect(readChatDraftFromLocation(url as unknown as Location)).toBe("Plan setup");

    const emptyUrl = new URL(`http://localhost/chat?${CHAT_DRAFT_QUERY_PARAM}=`);
    expect(readChatDraftFromLocation(emptyUrl as unknown as Location)).toBeNull();
  });
});
