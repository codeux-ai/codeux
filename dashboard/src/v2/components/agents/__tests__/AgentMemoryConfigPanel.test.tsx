/** @vitest-environment jsdom */
import { h } from "preact";
import { useState } from "preact/hooks";
import { fireEvent, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { AgentMemoryConfigPanel } from "../AgentMemoryConfigPanel.js";
import { renderWithI18n, renderWithI18n as render } from "./render-with-i18n.js";
import { DEFAULT_AGENT_MEMORY_CONFIG, type AgentMemoryConfig } from "../../../memory-types.js";

function renderHarness(initialValue: AgentMemoryConfig = DEFAULT_AGENT_MEMORY_CONFIG) {
  const onClose = vi.fn();

  const Harness = () => {
    const [config, setConfig] = useState<AgentMemoryConfig>(initialValue);

    return (
      <div>
        <AgentMemoryConfigPanel onClose={onClose} value={config} onChange={setConfig} />
        <output data-testid="config">{JSON.stringify(config)}</output>
      </div>
    );
  };

  return {
    onClose,
    ...render(<Harness />),
  };
}

describe("AgentMemoryConfigPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("provides disabled attributes for clean reset/disable state", async () => {
    render(
      <AgentMemoryConfigPanel
        value={DEFAULT_AGENT_MEMORY_CONFIG}
        onChange={vi.fn()}
        onClose={vi.fn()}
        disabled={true}
      />
    );
    const closeBtn = screen.getByLabelText("Close");
    expect(closeBtn).toBeDisabled();
    expect(screen.getByText("Memory filters are locked while the agent is saving.")).toBeInTheDocument();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("renders the expected controls and shows all categories when the filter is empty", () => {
    renderHarness();

    expect(screen.getByRole("button", { name: "Short Term" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Both/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Long Term" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select all" })).toBeInTheDocument();

    for (const label of ["Architecture", "Codebase", "Context", "Preferences", "Patterns", "Decision", "Error", "Learning"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-pressed", "true");
    }

    expect(screen.getAllByText("Selected").length).toBeGreaterThanOrEqual(8);
    expect(screen.getByText("Memory filter changes are pending until the agent is saved.")).toBeInTheDocument();

    expect(screen.getByLabelText("Minimum Strength")).toBeInTheDocument();
    expect(screen.getByLabelText("Max Short Term")).toHaveAttribute("placeholder", "Unlimited");
    expect(screen.getByLabelText("Max Long Term")).toHaveAttribute("placeholder", "Unlimited");
  });

  test("localizes German memory controls while retaining the configured tier value", () => {
    const onChange = vi.fn();
    renderWithI18n(
      <AgentMemoryConfigPanel
        value={{ ...DEFAULT_AGENT_MEMORY_CONFIG, tier: "long_term" }}
        onChange={onChange}
        onClose={vi.fn()}
      />,
      "de",
    );

    expect(screen.getByText("Speichereinbindung")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Langzeit/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Änderungen an Speicherfiltern bleiben ausstehend, bis der Agent gespeichert wird.")).toBeInTheDocument();
  });

  test("collapses back to an empty category filter when all categories are enabled", () => {
    renderHarness({
      ...DEFAULT_AGENT_MEMORY_CONFIG,
      categories: ["architecture"],
    });

    fireEvent.click(screen.getByRole("button", { name: /Codebase/ }));
    fireEvent.click(screen.getByRole("button", { name: /Context/ }));
    fireEvent.click(screen.getByRole("button", { name: /Preferences/ }));
    fireEvent.click(screen.getByRole("button", { name: /Patterns/ }));
    fireEvent.click(screen.getByRole("button", { name: /Decision/ }));
    fireEvent.click(screen.getByRole("button", { name: /Error/ }));
    fireEvent.click(screen.getByRole("button", { name: /Learning/ }));

    const config = JSON.parse(screen.getByTestId("config").textContent ?? "{}") as AgentMemoryConfig;
    expect(config.categories).toEqual([]);
    expect(screen.getByRole("button", { name: /Architecture/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Learning/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("removes a per-category override when it matches the global minimum", () => {
    renderHarness({
      ...DEFAULT_AGENT_MEMORY_CONFIG,
      categories: ["architecture"],
      minStrength: 0.2,
      minStrengthPerCategory: { architecture: 0.75 },
    });

    fireEvent.click(screen.getByRole("button", { name: "Per-category overrides" }));

    const slider = screen.getByLabelText("Architecture minimum strength");
    fireEvent.input(slider, { target: { value: "0.2" } });

    const config = JSON.parse(screen.getByTestId("config").textContent ?? "{}") as AgentMemoryConfig;
    expect(config.minStrength).toBe(0.2);
    expect(config.minStrengthPerCategory).toEqual({});
  });
});
