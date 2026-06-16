/** @vitest-environment jsdom */
/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/preact";
import { SettingsIntegrationsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsIntegrationsPanel.js";

vi.mock("gsap", () => {
  const applyStyles = (target: unknown, props: Record<string, unknown>) => {
    if (!(target instanceof HTMLElement)) return;
    for (const [key, value] of Object.entries(props)) {
      (target.style as CSSStyleDeclaration & Record<string, string>)[key] = String(value);
    }
  };

  return {
    default: {
      set: vi.fn((target: unknown, props: Record<string, unknown>) => applyStyles(target, props)),
      to: vi.fn((target: unknown, props: Record<string, unknown>) => applyStyles(target, props)),
      timeline: vi.fn(() => {
        const timeline = {
          to: (target: unknown, props: Record<string, unknown>) => {
            applyStyles(target, props);
            if (typeof props.onComplete === "function") {
              props.onComplete();
            }
            return timeline;
          },
        };
        return timeline;
      }),
    },
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
          gitlabToken: "",
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
          gitlabToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as any;

    const { container } = render(<SettingsIntegrationsPanel state={state} />);

    await waitFor(() => {
      expect(container.textContent).toContain("GitHub Configuration");
    });

    const panelRoot = container.querySelector(".flex.flex-col.gap-5") as HTMLElement;
    const slideContainer = panelRoot.querySelector(".relative.overflow-hidden.w-full") as HTMLElement;
    const [listPane, detailPane] = Array.from(slideContainer.children) as HTMLElement[];

    expect(listPane.style.display).toBe("none");
    expect(detailPane.style.display).toBe("block");
    expect(detailPane.style.position).toBe("relative");
  });

  it("renders integration purpose groups without the old catalog infobox", async () => {
    const state = {
      activeScope: "system",
      selectedProject: null,
      editableSettings: {
        cliWorkflow: {
          executionMode: "DOCKER",
          containerMountGithubAuth: false,
          containerGithubAuthPath: "~/.config/gh",
          containerMountGitConfig: false,
          containerGitUserName: "Code UX",
          containerGitUserEmail: "agents@codeux.ai",
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
          providers: {},
          githubToken: "",
          gitlabToken: "",
        },
      },
      projectSources: {},
      selectedIntegration: null,
      setSelectedIntegration: vi.fn(),
      integrations: [
        { id: "codex", label: "Codex", description: "CLI provider" },
        { id: "github", label: "GitHub", description: "Git provider" },
        { id: "jira", label: "Jira", description: "Issue tracker" },
      ],
      importingHints: false,
      externalHints: {
        resolved: {
          julesApiKey: "",
          geminiApiKey: "",
          codexApiKey: "",
          claudeCodeApiKey: "",
          githubToken: "",
          gitlabToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as any;

    const { container } = render(<SettingsIntegrationsPanel state={state} />);

    await waitFor(() => {
      expect(container.textContent).toContain("CLI");
    });
    expect(container.textContent).toContain("GIT");
    expect(container.textContent).toContain("PM");
    expect(container.textContent).toContain("Import host hints");
    expect(container.textContent).not.toContain("Integration catalog");
    expect(container.textContent).not.toContain("Provider credentials and source-control auth in one place");
  });

  it("renders system-owned Jira configuration controls", async () => {
    const state = {
      activeScope: "system",
      selectedProject: null,
      editableSettings: {
        cliWorkflow: {
          executionMode: "DOCKER",
          containerMountGithubAuth: false,
          containerGithubAuthPath: "~/.config/gh",
          containerMountGitConfig: true,
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
          providers: {},
          githubToken: "",
          gitlabToken: "",
          jira: {
            host: "https://acme.atlassian.net",
            email: "ops@acme.test",
            apiToken: "jira-token",
            autoCloseLinkedIssues: true,
            defaultProject: "OPS",
            closeTransitionName: "Done",
          },
        },
      },
      projectSources: {},
      selectedIntegration: "jira",
      setSelectedIntegration: vi.fn(),
      integrations: [
        { id: "jira", label: "Jira", description: "Issue tracker" },
      ],
      importingHints: false,
      externalHints: {
        resolved: {
          julesApiKey: "",
          geminiApiKey: "",
          codexApiKey: "",
          claudeCodeApiKey: "",
          githubToken: "",
          gitlabToken: "",
          jiraToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as any;

    const { container } = render(<SettingsIntegrationsPanel state={state} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Jira Configuration");
    });

    expect(container.textContent).toContain("Jira site URL");
    expect(container.textContent).toContain("Default project");
    expect(container.textContent).toContain("Auto-close Jira issues");
    const inputValues = Array.from(container.querySelectorAll("input")).map((input) => input.value);
    expect(inputValues).toContain("https://acme.atlassian.net");
    expect(inputValues).toContain("OPS");
  });

  it("shows editable git identity only when local git config copying is disabled", async () => {
    const baseState = {
      activeScope: "project",
      selectedProject: null,
      editableSettings: {
        cliWorkflow: {
          executionMode: "DOCKER",
          containerMountGithubAuth: false,
          containerGithubAuthPath: "~/.config/gh",
          containerMountGitConfig: false,
          containerGitUserName: "Code UX",
          containerGitUserEmail: "agents@codeux.ai",
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
          providers: {},
          githubToken: "",
          gitlabToken: "",
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
          gitlabToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as any;

    const { container, rerender } = render(<SettingsIntegrationsPanel state={baseState} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Git user name");
    });
    expect(container.textContent).toContain("Git email");

    rerender(
      <SettingsIntegrationsPanel
        state={{
          ...baseState,
          editableSettings: {
            ...baseState.editableSettings,
            cliWorkflow: {
              ...baseState.editableSettings.cliWorkflow,
              containerMountGitConfig: true,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(container.textContent).not.toContain("Git user name");
    });
    expect(container.textContent).not.toContain("Git email");
  });
});
