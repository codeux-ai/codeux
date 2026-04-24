/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/preact";
import { SettingsIntegrationsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsIntegrationsPanel.js";

vi.mock("gsap", () => {
  const applyStyles = (targets: any, vars: any) => {
    const elements = Array.isArray(targets) ? targets : [targets];
    elements.forEach((el) => {
      if (el && el.style) {
        Object.entries(vars).forEach(([key, value]) => {
          if (key !== "onComplete" && key !== "duration" && key !== "ease" && key !== "overwrite" && key !== "delay" && key !== "stagger") {
            el.style[key] = value;
          }
        });
      }
    });
    if (vars.onComplete) vars.onComplete();
  };

  const gsapMock = {
    to: vi.fn((targets, vars) => applyStyles(targets, vars)),
    fromTo: vi.fn((targets, fromVars, toVars) => applyStyles(targets, toVars)),
    set: vi.fn((targets, vars) => applyStyles(targets, vars)),
    killTweensOf: vi.fn(),
    context: vi.fn((cb) => {
      if (typeof cb === "function") cb();
      return { revert: vi.fn(), add: vi.fn() };
    }),
    registerPlugin: vi.fn(),
    timeline: vi.fn(() => {
      const tl = {
        to: vi.fn((targets, vars) => {
          applyStyles(targets, vars);
          return tl;
        }),
        fromTo: vi.fn((targets, fromVars, toVars) => {
          applyStyles(targets, toVars);
          return tl;
        }),
        set: vi.fn((targets, vars) => {
          applyStyles(targets, vars);
          return tl;
        }),
        add: vi.fn(() => tl),
        kill: vi.fn(() => tl),
        clear: vi.fn(() => tl),
      };
      return tl;
    }),
  };
  return {
    gsap: gsapMock,
    default: gsapMock,
  };
});

describe("SettingsIntegrationsPanel", () => {
  it("keeps the selected integration detail in flow so long forms are not clipped", async () => {
    const state = {
      activeScope: "system",
      selectedProject: null,
      editableSettings: {
        cliWorkflow: {
          executionMode: "DOCKER",
          containerMountGithubAuth: false,
          containerMountGeminiAuth: false,
          containerMountCodexAuth: false,
          containerMountClaudeCodeAuth: false,
          containerGithubAuthPath: "~/.config/gh",
          containerGeminiAuthPath: "~/.gemini",
          containerCodexAuthPath: "~/.codex",
          containerClaudeCodeAuthPath: "~/.claude",
        },
        git: {
          githubMode: "REMOTE",
          defaultBranch: "main",
          featureBranchPrefix: "feature/",
          sprintBranchScheme: "feature/sprint{sprint}",
          autoCreatePr: true,
        },
      },
      systemSettings: {
        integrations: {
          providers: {
            jules: { provider: "jules", name: "Jules Primary", apiKey: "", mountAuth: false, authPath: "" },
            gemini: { provider: "gemini", name: "Gemini Primary", apiKey: "", mountAuth: false, authPath: "~/.gemini" },
            codex: { provider: "codex", name: "Codex Primary", apiKey: "", mountAuth: false, authPath: "~/.codex" },
            "claude-code": { provider: "claude-code", name: "Claude Primary", apiKey: "", mountAuth: false, authPath: "~/.claude" },
          },
          githubToken: "",
        },
      },
      projectSources: {},
      selectedIntegration: "github",
      setSelectedIntegration: vi.fn(),
      integrations: [
        { id: "github", label: "GitHub", description: "Git provider" },
      ],
      importingHints: false,
      externalHints: {
        resolved: {
          julesApiKey: "",
          geminiApiKey: "",
          codexApiKey: "",
          claudeCodeApiKey: "",
          githubToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as any;

    const { container } = render(<SettingsIntegrationsPanel state={state} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Git Host Configuration");
    });

    const panelRoot = container.querySelector(".flex.flex-col.gap-5") as HTMLElement;
    const slideContainer = panelRoot.querySelector(".relative.overflow-hidden.w-full") as HTMLElement;
    const [listPane, detailPane] = Array.from(slideContainer.children) as HTMLElement[];

    expect(listPane.style.display).toBe("none");
    expect(detailPane.style.display).toBe("block");
    expect(detailPane.style.position).toBe("relative");
  });
});
