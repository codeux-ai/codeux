/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";

import { parseBubbleSegments, StageWidgetRenderer } from "../../../dashboard/src/v2/components/chat/cinematic/StageWidgets.js";

expect.extend(matchers);

afterEach(cleanup);

describe("parseBubbleSegments", () => {
  it("splits markdown around a widget fence and parses the JSON", () => {
    const markdown = [
      "Here is the sprint:",
      "```codeux:sprint",
      '{ "key": "SPR-7", "name": "Checkout", "status": "executing", "done": 2, "total": 5 }',
      "```",
      "Anything else?",
    ].join("\n");

    const segments = parseBubbleSegments(markdown);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ kind: "markdown" });
    expect(segments[1]).toMatchObject({ kind: "widget", widget: { type: "sprint" } });
    expect(segments[2]).toMatchObject({ kind: "markdown" });
  });

  it("leaves malformed JSON and unknown types as plain markdown", () => {
    const bad = "```codeux:sprint\nnot json\n```";
    expect(parseBubbleSegments(bad)).toEqual([{ kind: "markdown", markdown: bad }]);

    const unknown = "```codeux:pie\n{}\n```";
    expect(parseBubbleSegments(unknown)).toEqual([{ kind: "markdown", markdown: unknown }]);
  });

  it("returns a single markdown segment for plain replies", () => {
    expect(parseBubbleSegments("just text")).toEqual([{ kind: "markdown", markdown: "just text" }]);
  });

  it("parses the memory fence as a rich widget", () => {
    const segments = parseBubbleSegments([
      "Stored for future work.",
      "```codeux:memory",
      JSON.stringify({
        title: "Added to long-term memory",
        memory: "Use dependency-aware sprint tasks.",
        category: "patterns",
        claimId: "claim-12345678",
        memoryId: "memory-1",
        status: "stored",
      }),
      "```",
    ].join("\n"));

    expect(segments).toHaveLength(2);
    expect(segments[1]).toMatchObject({
      kind: "widget",
      widget: { type: "memory", data: { claimId: "claim-12345678" } },
    });
  });
});

describe("StageWidgetRenderer", () => {
  it("renders tasks with progress and status labels for screen readers", () => {
    render(
      <StageWidgetRenderer
        widget={{
          type: "tasks",
          data: {
            title: "Sprint tasks",
            items: [
              { title: "Auth flow", status: "done" },
              { title: "Checkout page", status: "active", meta: "worker-2" },
              { title: "Docs", status: "todo" },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("Sprint tasks")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByText("Checkout page")).toBeInTheDocument();
    expect(screen.getByText("1/3 · 33%")).toBeInTheDocument();
  });

  it("renders action chips that surface their prompt through onAction", () => {
    const clicks: string[] = [];
    render(
      <StageWidgetRenderer
        widget={{ type: "actions", data: { items: [{ label: "Start sprint", prompt: "Start the sprint now" }] } }}
        onAction={(prompt) => clicks.push(prompt)}
      />,
    );
    screen.getByRole("button", { name: /Start sprint/ }).click();
    expect(clicks).toEqual(["Start the sprint now"]);
  });

  it("dispatches action widget suggestions from pointer and keyboard activation", async () => {
    const user = userEvent.setup();
    const prompts: string[] = [];

    render(
      <StageWidgetRenderer
        widget={{
          type: "actions",
          data: {
            items: [
              { label: "Summarize status", prompt: "Summarize project status now." },
              { label: "Plan follow-up", prompt: "Plan the next follow-up task." },
            ],
          },
        }}
        onAction={(prompt) => prompts.push(prompt)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Summarize status" }));
    screen.getByRole("button", { name: "Plan follow-up" }).focus();
    await user.keyboard("[Enter]");

    expect(prompts).toEqual([
      "Summarize project status now.",
      "Plan the next follow-up task.",
    ]);
  });

  it("does not expose action dispatch controls for non-action widgets", async () => {
    const user = userEvent.setup();
    const prompts: string[] = [];

    render(
      <StageWidgetRenderer
        widget={{
          type: "tasks",
          data: {
            title: "Sprint tasks",
            items: [
              { title: "Auth flow", status: "done" },
              { title: "Checkout page", status: "active" },
            ],
          },
        }}
        onAction={(prompt) => prompts.push(prompt)}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    await user.click(screen.getByText("Checkout page"));

    expect(prompts).toEqual([]);
  });

  it("renders status states with icon + label, never color alone", () => {
    render(
      <StageWidgetRenderer
        widget={{
          type: "status",
          data: {
            title: "CI Pipeline",
            state: "running",
            items: [
              { label: "Lint", state: "ok" },
              { label: "Backend", state: "failed" },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("CI Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders an accessible durable-memory confirmation", () => {
    render(<StageWidgetRenderer widget={{
      type: "memory",
      data: {
        memory: "Use dependency-aware sprint tasks.",
        category: "patterns",
        claimId: "claim-12345678",
        status: "stored",
      },
    }} />);

    expect(screen.getByText("Long-term memory")).toBeInTheDocument();
    expect(screen.getByText("Remembered")).toBeInTheDocument();
    expect(screen.getByText("Use dependency-aware sprint tasks.")).toBeInTheDocument();
    expect(screen.getByText("Claim claim-12")).toBeInTheDocument();
  });
});
