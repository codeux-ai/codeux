/** @vitest-environment jsdom */
import { h } from "preact";
import { cleanup, render, fireEvent, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentAvatarCustomizer } from "../AgentAvatarCustomizer.js";
import type { AgentAvatarConfig } from "../../../types.js";

const config: AgentAvatarConfig = {
  chassis: "classic",
  eyes: "smile",
  antenna: "jewel",
  headphones: "bumper",
  wings: "none",
  baseColor: "pearl",
  accent: "jade",
  visorColor: "jade",
};

describe("AgentAvatarCustomizer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("labels selected avatar options without relying on color or animation", () => {
    render(<AgentAvatarCustomizer config={config} onChange={vi.fn()} />);

    expect(screen.getAllByText("Selected").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("Selected parts are labeled and update the live portrait immediately.")).toBeInTheDocument();
  });

  test("shows a disabled action reason and randomize success feedback", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AgentAvatarCustomizer config={config} onChange={onChange} disabled={true} />);

    expect(screen.getByRole("button", { name: "Randomize" })).toBeDisabled();
    expect(screen.getByText("Avatar controls are disabled while this agent is saving.")).toBeInTheDocument();

    rerender(<AgentAvatarCustomizer config={config} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Randomize" }));

    expect(screen.getByText("Avatar randomized. Save Agent to keep it.")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
