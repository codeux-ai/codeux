// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

import { QuicksprintBrowseView } from "../QuicksprintBrowseView.js";
import type { QuicksprintTemplateRecord } from "../../../../../../src/contracts/quicksprint-types.js";
import type { BuiltinPurposeOption } from "../../../lib/quicksprint-panel-state.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    fromTo: vi.fn(),
    to: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const purpose: BuiltinPurposeOption = {
  value: "fullstack-js",
  label: "Fullstack JS App",
  description: "Default templates for fullstack JavaScript projects.",
};

const makeTemplate = (overrides: Partial<QuicksprintTemplateRecord>): QuicksprintTemplateRecord => ({
  id: "qs-default",
  projectId: null,
  name: "Code Quality Audit",
  description: "Review quality, runtime behavior, and follow-up tasks.",
  icon: "Sparkles",
  category: "engineering",
  categoryColor: "signal",
  agentInstructionMarkdown: "Inspect the repository.",
  defaultTaskCount: 5,
  isBuiltIn: true,
  purpose: purpose.value,
  purposeLabel: purpose.label,
  purposeDescription: purpose.description,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const renderBrowse = (overrides: Partial<Parameters<typeof QuicksprintBrowseView>[0]> = {}) => {
  const builtin = makeTemplate({
    id: "qs-long",
    name: "Very Long Template Name That Should Wrap Predictably Across The Card Without Overflow",
    description: "A reusable prompt with enough detail to verify that browse metadata wraps instead of truncating unexpectedly.",
    category: "architecture-and-runtime-quality",
  });
  const custom = makeTemplate({
    id: "qs-custom",
    projectId: "project-1",
    name: "Custom Import Cleanup",
    isBuiltIn: false,
    category: "custom-workflow",
  });
  const props: Parameters<typeof QuicksprintBrowseView>[0] = {
    templates: [builtin, custom],
    builtinTemplates: [builtin],
    customTemplates: [custom],
    visibleBuiltinTemplates: [builtin],
    builtinPurposeOptions: [purpose],
    selectedBuiltinPurpose: purpose.value,
    setSelectedBuiltinPurpose: vi.fn(),
    handleSelectTemplate: vi.fn(),
    openEditor: vi.fn(),
    activeBuiltinPurpose: purpose,
    loading: false,
    onClose: vi.fn(),
    ...overrides,
  };

  return { ...render(<QuicksprintBrowseView {...props} />), props, builtin, custom };
};

describe("QuicksprintBrowseView", () => {
  it("announces loading state while templates are loading", () => {
    renderBrowse({ loading: true });

    expect(screen.getByRole("status", { name: "Loading quicksprint templates" })).toBeInTheDocument();
  });

  it("renders accessible default and custom template actions", async () => {
    const user = userEvent.setup();
    const { props, builtin, custom } = renderBrowse();

    await user.click(screen.getByRole("button", { name: `Use quicksprint template ${builtin.name}` }));
    expect(props.handleSelectTemplate).toHaveBeenCalledWith(builtin);

    await user.click(screen.getByRole("button", { name: `Use quicksprint template ${custom.name}` }));
    expect(props.handleSelectTemplate).toHaveBeenCalledWith(custom);

    await user.click(screen.getByRole("button", { name: `Edit ${custom.name}` }));
    expect(props.openEditor).toHaveBeenCalledWith(custom);
  });

  it("shows purpose metadata and wraps long template metadata", () => {
    const { builtin } = renderBrowse();

    expect(screen.getByText(purpose.description!)).toHaveClass("[overflow-wrap:anywhere]");
    expect(screen.getByText(builtin.name)).toHaveClass("[overflow-wrap:anywhere]");
    expect(screen.getByText(builtin.category)).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("uses an empty custom template state with an accessible create action", async () => {
    const user = userEvent.setup();
    const { props } = renderBrowse({ customTemplates: [] });

    const create = screen.getByRole("button", { name: "Create your first custom quicksprint template" });
    expect(create).toBeInTheDocument();

    await user.click(create);
    expect(props.openEditor).toHaveBeenCalledWith(null);
  });

  it("shows an empty default purpose state when no templates match", () => {
    renderBrowse({ visibleBuiltinTemplates: [] });

    expect(screen.getByRole("status")).toHaveTextContent("No default templates in this purpose.");
  });
});
