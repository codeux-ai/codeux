/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Source } from "../../../types.js";
import { AddProjectCard } from "../AddProjectCard.js";
import { ProjectCard, type ProjectCardProps } from "../ProjectCard.js";
import { DashboardI18nProvider } from "../../../i18n/context.js";
import type { DashboardLocale } from "../../../i18n/locales.js";

expect.extend(matchers);

function createSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project One",
    baseDir: "/workspace/project-one",
    repoUrl: null,
    sourceType: "local",
    sourceRef: "/workspace/project-one",
    gitProvider: "local",
    gitHostDomain: null,
    defaultBranch: "dev",
    featureBranchPrefix: "feature/",
    status: "idle",
    sprintsCount: 3,
    openTasks: 2,
    completedTasks: 6,
    isRunning: false,
    settingsOverrides: {},
    agentBindings: [],
    lastRunAt: "2026-01-04T05:06:07.000Z",
    lastRunStatus: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function createProps(overrides: Partial<ProjectCardProps> = {}): ProjectCardProps {
  return {
    source: createSource(),
    isSelected: false,
    isSettingUp: false,
    setupInvocationId: null,
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onSetup: vi.fn(),
    onOpenInvocation: vi.fn(),
    onSettings: vi.fn(),
    ...overrides,
  };
}

const withLocale = (children: ComponentChildren, locale: DashboardLocale = "en") => (
  <DashboardI18nProvider initialLocale={locale} storage={null}>
    {children}
  </DashboardI18nProvider>
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectCard", () => {
  it("selects the project from the card selection surface", () => {
    const props = createProps();
    render(withLocale(<ProjectCard {...props} />));

    fireEvent.click(screen.getByRole("button", { name: "Select project: Project One" }));

    expect(props.onSelect).toHaveBeenCalledTimes(1);
  });

  it("supports native keyboard activation", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(withLocale(<ProjectCard {...props} />));

    const selectSurface = screen.getByRole("button", { name: "Select project: Project One" });
    selectSurface.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(props.onSelect).toHaveBeenCalledTimes(2);
  });

  it("isolates setup, settings, and delete actions from selection", () => {
    const props = createProps();
    render(withLocale(<ProjectCard {...props} />));

    fireEvent.click(screen.getByRole("button", { name: "Setup project" }));
    fireEvent.click(screen.getByRole("button", { name: "Project settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));

    expect(props.onSetup).toHaveBeenCalledTimes(1);
    expect(props.onSettings).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("opens an available setup invocation without selecting the project", () => {
    const props = createProps({ isSettingUp: true, setupInvocationId: "invocation-123" });
    render(withLocale(<ProjectCard {...props} />));

    fireEvent.click(screen.getByRole("button", { name: "Open setup invocation" }));

    expect(props.onOpenInvocation).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Project setup is already running" })).toBeDisabled();
  });

  it("keeps long names, repositories, branches, and paths safely truncated", () => {
    const longName = "A project name long enough to overflow a narrow mobile project card surface";
    const longRepository = "https://example.com/organization/with-a-very-long-name/repository-with-a-very-long-name.git";
    const longBranch = "feature/a-branch-name-that-must-never-force-horizontal-page-overflow";
    const { rerender } = render(withLocale(
      <ProjectCard
        {...createProps({
          source: createSource({ name: longName, sourceType: "git", repoUrl: longRepository, sourceRef: longRepository, defaultBranch: longBranch }),
        })}
      />,
    ));

    expect(screen.getByTestId("project-name")).toHaveClass("truncate");
    expect(screen.getByTestId("project-name")).toHaveAttribute("title", longName);
    expect(screen.getByTestId("project-location")).toHaveClass("truncate");
    expect(screen.getByTestId("project-location")).toHaveAttribute("title", longRepository);
    expect(screen.getByTestId("project-branch")).toHaveClass("truncate");
    expect(screen.getByTestId("project-branch")).toHaveAttribute("title", longBranch);

    const longPath = "/workspace/a/local/path/with/many/nested/directories/that-must-remain-inside-the-card";
    rerender(withLocale(<ProjectCard {...createProps({ source: createSource({ name: longName, baseDir: longPath, sourceRef: longPath }) })} />));
    expect(screen.getByTestId("project-location")).toHaveAttribute("title", longPath);
  });

  it("exposes stable selected and running states with static visual cues", () => {
    render(withLocale(<ProjectCard {...createProps({ source: createSource({ status: "running", isRunning: true }), isSelected: true })} />));

    const card = screen.getByRole("article", { name: "Project: Project One" });
    expect(card).toHaveAttribute("data-selected", "true");
    expect(card).toHaveAttribute("data-running", "true");
    expect(card).toHaveClass("border-signal-500/55");
    expect(screen.getByRole("button", { name: "Selected project: Project One" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status", { name: "Project One is selected" })).toBeInTheDocument();
    expect(screen.getByLabelText("Status: Running")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("renders view-model task counts and completion", () => {
    render(withLocale(<ProjectCard {...createProps()} />));

    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Project One task completion" })).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByText("Open").previousElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Done").previousElementSibling).toHaveTextContent("6");
  });

  it("localizes card chrome and metadata while preserving project values", () => {
    render(withLocale(<ProjectCard {...createProps()} />, "de"));

    expect(screen.getByRole("article", { name: "Projekt: Project One" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Projekt auswählen: Project One" })).toBeInTheDocument();
    expect(screen.getByText("Inaktiv")).toBeInTheDocument();
    expect(screen.getByText("4. Jan. 2026, 5:06")).toBeInTheDocument();
    expect(screen.getByText("/workspace/project-one")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });
});

describe("AddProjectCard", () => {
  it("provides a full-height keyboard-reachable Add Project entry point", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(withLocale(<AddProjectCard onClick={onClick} />));

    const addProject = screen.getByRole("button", { name: "Add Project" });
    expect(addProject).toHaveClass("h-full", "min-h-[390px]");
    addProject.focus();
    await user.keyboard("{Enter}");

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
