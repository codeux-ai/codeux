/** @vitest-environment jsdom */
import * as React from "preact/compat";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import { HumanInterventionBadge } from "../../../../../dashboard/src/v2/components/ui/HumanInterventionBadge.js";
import type { ExecutionHumanInterventionSummary } from "../../../../../src/contracts/app-types.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("HumanInterventionBadge", () => {
  beforeEach(() => {
    cleanup();
  });

  const humanSummary: ExecutionHumanInterventionSummary = {
    title: "Review needed",
    reason: "A human needs to check the code.",
    instructions: "Please look at the PR and approve.",
    attentionType: "review",
    severity: "medium",
    ownerType: "human"
  };

  const systemSummary: ExecutionHumanInterventionSummary = {
    title: "Timeout occurred",
    reason: "The worker took too long.",
    instructions: "Internal system message.",
    attentionType: "error",
    severity: "high",
    ownerType: "system"
  };

  it("renders the default 'Needs you' badge for human owners", () => {
    render(<HumanInterventionBadge summary={humanSummary} />);
    
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    const badge = screen.getByText("Needs you").parentElement;
    expect(badge?.className).toContain("border-status-amber");
  });

  it("renders the 'System stopped' badge for system owners", () => {
    render(<HumanInterventionBadge summary={systemSummary} />);
    
    expect(screen.getByText("System stopped")).toBeInTheDocument();
    const badge = screen.getByText("System stopped").parentElement;
    expect(badge?.className).toContain("border-slate-400");
  });

  it("overrides label for system owners even if label prop is passed", () => {
    render(<HumanInterventionBadge summary={systemSummary} label="Details" />);
    
    expect(screen.getByText("System stopped")).toBeInTheDocument();
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
  });

  it("shows 'Human Intervention' header in tooltip for human owners", () => {
    render(<HumanInterventionBadge summary={humanSummary} />);
    
    expect(screen.getByText("Human Intervention")).toBeInTheDocument();
    expect(screen.getByText("What to do")).toBeInTheDocument();
    expect(screen.getByText(humanSummary.instructions)).toBeInTheDocument();
  });

  it("shows 'Stopped automatically' header and hides instructions for system owners", () => {
    render(<HumanInterventionBadge summary={systemSummary} />);
    
    expect(screen.getByText("Stopped automatically")).toBeInTheDocument();
    expect(screen.queryByText("What to do")).not.toBeInTheDocument();
    expect(screen.queryByText(systemSummary.instructions)).not.toBeInTheDocument();
  });
});
