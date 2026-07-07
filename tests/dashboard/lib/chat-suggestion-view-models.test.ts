import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_SUGGESTION_ICON,
  getPromptSuggestionViewModels,
  MAX_PROMPT_SUGGESTIONS,
  PROMPT_SUGGESTION_ICON_REGISTRY,
  resolvePromptSuggestionIconName,
} from "../../../dashboard/src/v2/lib/chat-suggestion-view-models.js";
import type { ConversationMessageMetadata } from "../../../src/contracts/connection-chat-types.js";

const registeredIconNames = [
  "sparkles",
  "search",
  "edit",
  "code",
  "terminal",
  "bug",
  "check",
  "play",
  "refresh",
  "settings",
  "file",
  "folder",
  "git-branch",
  "git-pull-request",
  "database",
  "shield",
  "book-open",
  "message-circle",
  "list-checks",
  "rocket",
  "zap",
  "lightbulb",
  "clipboard",
  "download",
  "upload",
  "eye",
  "package",
  "server",
  "clock",
  "help-circle",
] as const;

describe("chat suggestion view models", () => {
  it("registers exactly the supported generic icon identifiers", () => {
    expect(Object.keys(PROMPT_SUGGESTION_ICON_REGISTRY)).toEqual(registeredIconNames);
    expect(Object.keys(PROMPT_SUGGESTION_ICON_REGISTRY)).toHaveLength(30);
  });

  it("normalizes promptSuggestions metadata into renderable view models", () => {
    const metadata: ConversationMessageMetadata = {
      promptSuggestions: [
        {
          id: "  next-step  ",
          label: "  Run   the validation  ",
          prompt: "  Please run pnpm test.  ",
          icon: "Git_Branch",
        },
      ],
    };

    expect(getPromptSuggestionViewModels(metadata)).toEqual([
      {
        key: "prompt-suggestion:next-step",
        id: "next-step",
        label: "Run the validation",
        prompt: "Please run pnpm test.",
        icon: "git-branch",
      },
    ]);
  });

  it("reads compatibility suggestions metadata alongside promptSuggestions", () => {
    const metadata: ConversationMessageMetadata = {
      promptSuggestions: [
        {
          label: "Run checks",
          prompt: "Run the focused checks.",
          icon: "check",
        },
      ],
      suggestions: [
        {
          label: "Open docs",
          prompt: "Show me the relevant docs.",
          icon: "book-open",
        },
      ],
    };

    const suggestions = getPromptSuggestionViewModels(metadata);

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({
      label: "Run checks",
      prompt: "Run the focused checks.",
      icon: "check",
    });
    expect(suggestions[1]).toMatchObject({
      label: "Open docs",
      prompt: "Show me the relevant docs.",
      icon: "book-open",
    });
    expect(suggestions[1].key).toMatch(/^prompt-suggestion:/);
  });

  it("drops malformed suggestions and falls back to the default icon safely", () => {
    const metadata: ConversationMessageMetadata = {
      promptSuggestions: [
        null,
        "invalid",
        { label: "Missing prompt", prompt: "" },
        { label: "   ", prompt: "Try this" },
        { label: 42, prompt: "Try this" },
        {
          label: "Investigate failure",
          prompt: "Look at the latest logs.",
          icon: "not-a-real-icon",
        },
      ],
    };

    expect(getPromptSuggestionViewModels(metadata)).toEqual([
      {
        key: expect.stringMatching(/^prompt-suggestion:/),
        label: "Investigate failure",
        prompt: "Look at the latest logs.",
        icon: DEFAULT_PROMPT_SUGGESTION_ICON,
      },
    ]);
  });

  it("limits rendered suggestions to six valid entries", () => {
    const metadata: ConversationMessageMetadata = {
      promptSuggestions: Array.from({ length: 8 }, (_, index) => ({
        id: `suggestion-${index}`,
        label: `Suggestion ${index}`,
        prompt: `Use suggestion ${index}`,
      })),
    };

    const suggestions = getPromptSuggestionViewModels(metadata);

    expect(suggestions).toHaveLength(MAX_PROMPT_SUGGESTIONS);
    expect(suggestions.map((suggestion) => suggestion.id)).toEqual([
      "suggestion-0",
      "suggestion-1",
      "suggestion-2",
      "suggestion-3",
      "suggestion-4",
      "suggestion-5",
    ]);
  });

  it("returns deterministic unique keys for suggestions without valid ids", () => {
    const metadata: ConversationMessageMetadata = {
      promptSuggestions: [
        { label: "Repeat", prompt: "Try the same prompt" },
        { label: "Repeat", prompt: "Try the same prompt" },
      ],
    };

    const firstPass = getPromptSuggestionViewModels(metadata).map((suggestion) => suggestion.key);
    const secondPass = getPromptSuggestionViewModels(metadata).map((suggestion) => suggestion.key);

    expect(firstPass).toEqual(secondPass);
    expect(firstPass[0]).not.toBe(firstPass[1]);
    expect(firstPass[1]).toBe(`${firstPass[0]}:2`);
  });

  it("normalizes known icons and resolves unknown icons to the fallback", () => {
    expect(resolvePromptSuggestionIconName("Help Circle")).toBe("help-circle");
    expect(resolvePromptSuggestionIconName("not-real")).toBe(DEFAULT_PROMPT_SUGGESTION_ICON);
    expect(resolvePromptSuggestionIconName(null)).toBe(DEFAULT_PROMPT_SUGGESTION_ICON);
  });
});
