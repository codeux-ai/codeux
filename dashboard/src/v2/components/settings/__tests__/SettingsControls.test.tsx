/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { BranchNameSchemeEditor } from "../BranchNameSchemeEditor";
import { SprintKeyEditor } from "../SprintKeyEditor";
import { TextInput, SecretInput, NumberInput, TextAreaInput, PillChoiceGroup } from "../SettingsFormFields";


import { SettingsCategoryRail } from "../SettingsCategoryRail";
import { ActionButton, NoticePanel } from "../SettingsSurface";
import { OverrideBadge } from "../panels/SharedPanelComponents";
import { SlidersHorizontal } from "lucide-preact";
import type { SettingsSearchMatches } from "../../../lib/settings-search-index";
import userEvent from "@testing-library/user-event";

  it("SettingsCategoryRail renders categories with proper aria-current semantics", () => {
    const mockCategories = [
      { id: "general" as const, num: "01", label: "General", icon: SlidersHorizontal, description: "Test" }
    ];
    render(
      <SettingsCategoryRail
        filteredCategories={mockCategories}
        activeCategory="general"
        settingsSearch=""
        settingsSearchMatches={{}}
        onSwitchCategory={() => {}}
      />
    );
    const btn = screen.getByRole("button", { name: /General/ });
    expect(btn).toHaveAttribute("aria-current", "page");
  });

  it("SettingsCategoryRail explains provider search matches", () => {
    const mockCategories = [
      { id: "integrations" as const, num: "08", label: "Integrations", icon: SlidersHorizontal, description: "Connections" }
    ];
    const settingsSearchMatches: SettingsSearchMatches = {
      integrations: {
        categoryId: "integrations",
        matchedLabels: ["Claude Code"],
        matchedDescriptions: [],
        matchedTerms: [],
      },
    };

    render(
      <SettingsCategoryRail
        filteredCategories={mockCategories}
        activeCategory="integrations"
        settingsSearch="claude"
        settingsSearchMatches={settingsSearchMatches}
        onSwitchCategory={() => {}}
      />
    );

    expect(screen.getByText("Showing 1 categories for \"claude\".")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("PillChoiceGroup exposes radio semantics for the selected option", () => {
    render(
      <PillChoiceGroup
        value="system"
        onChange={() => {}}
        aria-label="Scope choice"
        options={[
          { value: "system", label: "System" },
          { value: "project", label: "Project" },
        ]}
      />
    );

    expect(screen.getByRole("radiogroup", { name: "Scope choice" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Project" })).toHaveAttribute("aria-checked", "false");
  });

  it("ActionButton provides busy state feedback", () => {
    render(
      <ActionButton label="Save" onClick={() => {}} busy={true} />
    );
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("OverrideBadge handles reset click", async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(
      <OverrideBadge label="Project override" onReset={() => { clicked = true; }} contextLabel="My Setting" />
    );
    const btn = screen.getByRole("button", { name: /Delete project override for My Setting/ });
    await user.click(btn);
    expect(clicked).toBe(true);
  });



  it("ActionButton renders danger tone", () => {
    render(<ActionButton label="Wipe" onClick={() => {}} tone="danger" />);
    const btn = screen.getByRole("button", { name: "Wipe" });
    expect(btn.className).toContain("status-red");
  });


describe("SettingsControls Accessibility", () => {
  afterEach(() => {
    cleanup();
  });

  it("BranchNameSchemeEditor passes aria-label and aria-description", () => {
    render(
      <BranchNameSchemeEditor
        value="test"
        onChange={() => {}}
      />
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-label", "Sprint branch scheme");
    expect(input).toHaveAttribute("aria-description", "Template used when naming sprint branches.");
  });

  it("SprintKeyEditor passes aria-label and aria-description", () => {
    render(
      <SprintKeyEditor
        value="SPR"
        onChange={() => {}}
      />
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-label", "Sprint key prefix");
    expect(input).toHaveAttribute("aria-description", "Prefix used when generating sprint keys (e.g. SPR-1).");
  });

  it("TextInput passes aria-label and aria-description", () => {
    render(
      <TextInput
        value="test"
        onChange={() => {}}
        aria-label="Test Label"
        aria-description="Test Description"
      />
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-label", "Test Label");
    expect(input).toHaveAttribute("aria-description", "Test Description");
  });

  it("SecretInput masks values by default and reveals only on request", async () => {
    const user = userEvent.setup();
    render(
      <SecretInput
        value="sk-test-secret"
        onChange={() => {}}
        aria-label="API key"
        aria-description="Secret token"
      />
    );

    const input = screen.getByLabelText("API key");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("aria-description", "Secret token");

    await user.click(screen.getByRole("button", { name: "Show secret" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide secret" })).toHaveAttribute("aria-pressed", "true");
  });

  it("NumberInput passes aria-label and aria-description", () => {
    render(
      <NumberInput
        value={10}
        onChange={() => {}}
        aria-label="Num Label"
        aria-description="Num Description"
      />
    );
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("aria-label", "Num Label");
    expect(input).toHaveAttribute("aria-description", "Num Description");
  });

  it("TextAreaInput passes aria-label and aria-description", () => {
    render(
      <TextAreaInput
        value="test"
        onChange={() => {}}
        aria-label="Textarea Label"
        aria-description="Textarea Description"
      />
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-label", "Textarea Label");
    expect(input).toHaveAttribute("aria-description", "Textarea Description");
  });
});
