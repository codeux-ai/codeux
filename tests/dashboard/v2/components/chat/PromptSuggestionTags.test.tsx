/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { cleanup, render, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptSuggestionTags } from "../../../../../dashboard/src/v2/components/chat/PromptSuggestionTags.js";
import type { PromptSuggestionViewModel } from "../../../../../dashboard/src/v2/lib/chat-suggestion-view-models.js";

expect.extend(matchers);

const suggestions: PromptSuggestionViewModel[] = [
  {
    key: "prompt-suggestion:tests",
    id: "tests",
    label: "Run focused tests",
    prompt: "Run the relevant Vitest files.",
    icon: "play",
  },
  {
    key: "prompt-suggestion:docs",
    id: "docs",
    label: "Open architecture notes",
    prompt: "Show the architecture notes.",
    icon: "book-open",
  },
];

describe("PromptSuggestionTags", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders accessible compact buttons when onSelect is provided", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<PromptSuggestionTags suggestions={suggestions} onSelect={onSelect} />);

    const first = screen.getByRole("button", { name: "Use suggestion: Run focused tests" });
    expect(first).toHaveTextContent("Run focused tests");
    expect(first).toHaveClass("max-w-full");
    expect(first.querySelector("[aria-hidden=\"true\"]")).toBeInTheDocument();

    await user.click(first);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(suggestions[0]);
  });

  it("uses native button keyboard behavior for interactive suggestions", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<PromptSuggestionTags suggestions={suggestions} onSelect={onSelect} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Use suggestion: Run focused tests" })).toHaveFocus();

    await user.keyboard("[Enter]");

    expect(onSelect).toHaveBeenCalledWith(suggestions[0]);
  });

  it("renders read-only tags without interactive controls when onSelect is omitted", () => {
    const { container } = render(<PromptSuggestionTags suggestions={suggestions} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Run focused tests")).toBeInTheDocument();
    expect(screen.getByText("Open architecture notes")).toBeInTheDocument();

    const tags = container.querySelectorAll("span[title]");
    expect(tags).toHaveLength(2);
    expect(tags[0]).toHaveClass("max-w-full");
  });

  it("keeps long labels constrained inside the wrapping row", () => {
    const longSuggestion: PromptSuggestionViewModel = {
      key: "prompt-suggestion:long",
      label: "A very long suggestion label that should not force horizontal overflow in narrow chat surfaces",
      prompt: "Use this long suggestion.",
      icon: "message-circle",
    };

    const { container } = render(<PromptSuggestionTags suggestions={[longSuggestion]} onSelect={vi.fn()} />);
    const button = screen.getByRole("button", { name: `Use suggestion: ${longSuggestion.label}` });
    const label = within(button).getByText(longSuggestion.label);

    expect(container.firstElementChild).toHaveClass("flex-wrap");
    expect(button).toHaveClass("max-w-full", "min-w-0");
    expect(label).toHaveClass("overflow-hidden", "text-ellipsis", "whitespace-nowrap");
  });

  it("falls back to the default icon for unknown icon names", () => {
    const unknownIconSuggestion: PromptSuggestionViewModel = {
      key: "prompt-suggestion:unknown-icon",
      label: "Try fallback",
      prompt: "Use the fallback icon.",
      icon: "missing-icon" as PromptSuggestionViewModel["icon"],
    };

    render(<PromptSuggestionTags suggestions={[unknownIconSuggestion]} onSelect={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Use suggestion: Try fallback" });
    const iconSlot = button.querySelector("[data-prompt-suggestion-icon]");

    expect(iconSlot).toHaveAttribute("data-prompt-suggestion-icon", "sparkles");
    expect(iconSlot).toHaveAttribute("aria-hidden", "true");
  });

  it("renders nothing for an empty suggestion list", () => {
    const { container } = render(<PromptSuggestionTags suggestions={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
