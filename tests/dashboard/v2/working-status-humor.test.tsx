// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkingBubble } from "../../../dashboard/src/v2/components/chat/WorkingBubble.js";
import { InvocationContainerWidget } from "../../../dashboard/src/v2/components/chat/widgets/InvocationContainerWidget.js";
import {
  STATUS_MESSAGE_MIN_INTERVAL_MS,
  selectAgentHumorMessage,
} from "../../../dashboard/src/v2/lib/agent-humor-messages.js";
import type { ConversationRuntimeState } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
});

describe("working status humor", () => {
  it("keeps WorkingBubble copy stable inside one five-second cycle", () => {
    const runtimeState: ConversationRuntimeState = {
      routeKind: "manual",
      providerLabel: "Codex",
      modelLabel: "gpt-5",
    };
    const seed = ["working-bubble", "Ada", "Codex", "gpt-5", "working"].join("|");
    const expected = selectAgentHumorMessage({
      category: "working",
      seed,
      nowMs: 10_000,
    });

    const view = render(
      <WorkingBubble
        displayName="Ada"
        runtimeState={runtimeState}
        phase="working"
        nowMs={10_000}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(expected);
    expect(screen.getByRole("status")).toHaveTextContent("Working");

    view.rerender(
      <WorkingBubble
        displayName="Ada"
        runtimeState={runtimeState}
        phase="working"
        nowMs={10_000 + STATUS_MESSAGE_MIN_INTERVAL_MS - 1}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(expected);
  });

  it("changes WorkingBubble copy when the five-second cycle advances", () => {
    const runtimeState: ConversationRuntimeState = {
      routeKind: "manual",
      providerLabel: "Codex",
      modelLabel: "gpt-5",
    };
    const seedWithCycleChange = Array.from({ length: 200 }, (_, index) => `Agent ${index}`)
      .find((agentName) => {
        const seed = ["working-bubble", agentName, "Codex", "gpt-5", "working"].join("|");
        return selectAgentHumorMessage({ category: "working", seed, nowMs: 10_000 })
          !== selectAgentHumorMessage({ category: "working", seed, nowMs: 10_000 + STATUS_MESSAGE_MIN_INTERVAL_MS });
      });

    expect(seedWithCycleChange).toBeDefined();

    const agentName = seedWithCycleChange ?? "Agent";
    const seed = ["working-bubble", agentName, "Codex", "gpt-5", "working"].join("|");
    const firstMessage = selectAgentHumorMessage({ category: "working", seed, nowMs: 10_000 });
    const secondMessage = selectAgentHumorMessage({ category: "working", seed, nowMs: 10_000 + STATUS_MESSAGE_MIN_INTERVAL_MS });
    const view = render(
      <WorkingBubble
        displayName={agentName}
        runtimeState={runtimeState}
        phase="working"
        nowMs={10_000}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(firstMessage);

    view.rerender(
      <WorkingBubble
        displayName={agentName}
        runtimeState={runtimeState}
        phase="working"
        nowMs={10_000 + STATUS_MESSAGE_MIN_INTERVAL_MS}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(secondMessage);
    expect(secondMessage).not.toBe(firstMessage);
  });

  it("uses starting humor for initializing invocation containers without changing completed or failed semantics", () => {
    const seed = ["invocation-container", "Ada", "Codex", "gpt-5", "starting"].join("|");
    const expected = selectAgentHumorMessage({
      category: "starting",
      seed,
      nowMs: 20_000,
    });
    const view = render(
      <InvocationContainerWidget
        containerPhase="starting"
        agentName="Ada"
        providerName="Codex"
        modelName="gpt-5"
        nowMs={20_000}
      />,
    );

    expect(screen.getByRole("status", { name: "Initializing container" })).toHaveTextContent(expected);
    expect(screen.queryByText("Initializing...")).not.toBeInTheDocument();

    view.rerender(
      <InvocationContainerWidget
        containerPhase="completed"
        agentName="Ada"
        providerName="Codex"
        modelName="gpt-5"
        nowMs={20_000}
      />,
    );
    expect(screen.getByRole("status", { name: "Container completed" })).toHaveTextContent("Completed");
    expect(screen.getByText("by Ada")).toBeInTheDocument();

    view.rerender(
      <InvocationContainerWidget
        containerPhase="failed"
        agentName="Ada"
        providerName="Codex"
        modelName="gpt-5"
        nowMs={20_000}
      />,
    );
    expect(screen.getByRole("status", { name: "Container failed" })).toHaveTextContent("Failed");
  });

  it("keeps invocation working copy stable until the five-second cycle advances", () => {
    const seedWithCycleChange = Array.from({ length: 200 }, (_, index) => `Worker ${index}`)
      .find((agentName) => {
        const seed = ["invocation-container", agentName, "Gemini", "pro", "working"].join("|");
        return selectAgentHumorMessage({ category: "working", seed, nowMs: 30_000 })
          !== selectAgentHumorMessage({ category: "working", seed, nowMs: 30_000 + STATUS_MESSAGE_MIN_INTERVAL_MS });
      });

    expect(seedWithCycleChange).toBeDefined();

    const agentName = seedWithCycleChange ?? "Worker";
    const seed = ["invocation-container", agentName, "Gemini", "pro", "working"].join("|");
    const firstMessage = selectAgentHumorMessage({ category: "working", seed, nowMs: 30_000 });
    const secondMessage = selectAgentHumorMessage({ category: "working", seed, nowMs: 30_000 + STATUS_MESSAGE_MIN_INTERVAL_MS });
    const view = render(
      <InvocationContainerWidget
        containerPhase="working"
        agentName={agentName}
        providerName="Gemini"
        modelName="pro"
        nowMs={30_000}
      />,
    );

    expect(screen.getByRole("status", { name: "Container working" })).toHaveTextContent(firstMessage);
    expect(screen.queryByText("Working")).not.toBeInTheDocument();

    view.rerender(
      <InvocationContainerWidget
        containerPhase="working"
        agentName={agentName}
        providerName="Gemini"
        modelName="pro"
        nowMs={30_000 + STATUS_MESSAGE_MIN_INTERVAL_MS - 1}
      />,
    );
    expect(screen.getByRole("status", { name: "Container working" })).toHaveTextContent(firstMessage);

    view.rerender(
      <InvocationContainerWidget
        containerPhase="working"
        agentName={agentName}
        providerName="Gemini"
        modelName="pro"
        nowMs={30_000 + STATUS_MESSAGE_MIN_INTERVAL_MS}
      />,
    );

    expect(screen.getByRole("status", { name: "Container working" })).toHaveTextContent(secondMessage);
    expect(secondMessage).not.toBe(firstMessage);
  });
});
