/** @vitest-environment jsdom */
/** @jsx h */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { h } from "preact";
import { useRef, useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithI18n } from "../render-with-i18n.js";
import type { ExecutionInvocationRecord, SprintPreviewSession } from "../../../dashboard/src/types.js";
import type { SystemSort } from "../../../dashboard/src/v2/pages/stats/hooks/use-system-view-data.js";
import type { TaskCardViewModel } from "../../../dashboard/src/v2/lib/tasks/task-card-view-model.js";
import {
  collectHorizontalOverflowWithoutBoundary,
  collectIconOnlyButtonsWithoutNames,
  expectLiveRegion,
} from "./a11y-test-helpers.js";

vi.mock("@monaco-editor/react", () => ({
  default: ({ loading }: { loading?: preact.ComponentChildren }) => <div data-testid="monaco-editor">{loading}</div>,
  DiffEditor: ({ loading }: { loading?: preact.ComponentChildren }) => <div data-testid="monaco-diff-editor">{loading}</div>,
}));

vi.mock("../../../dashboard/src/v2/lib/monaco-setup.js", () => ({
  ensureMonacoConfigured: vi.fn(),
  MONACO_DARK_THEME: "codeux-dark",
  MONACO_LIGHT_THEME: "codeux-light",
}));

vi.mock("gsap", () => {
  const applyStyles = (target: unknown, props: Record<string, unknown>) => {
    if (!(target instanceof HTMLElement)) return;
    for (const [key, value] of Object.entries(props)) {
      if (key === "onComplete" || key === "duration" || key === "ease" || key === "overwrite") continue;
      (target.style as CSSStyleDeclaration & Record<string, string>)[key] = String(value);
    }
  };

  const gsapMock = {
    context: vi.fn((callback?: () => void) => {
      callback?.();
      return { revert: vi.fn() };
    }),
    fromTo: vi.fn((target: unknown, _from: Record<string, unknown>, to: Record<string, unknown>) => {
      applyStyles(target, to);
      if (typeof to.onComplete === "function") to.onComplete();
    }),
    killTweensOf: vi.fn(),
    set: vi.fn((target: unknown, props: Record<string, unknown>) => applyStyles(target, props)),
    timeline: vi.fn(() => {
      const timeline = {
        fromTo: vi.fn().mockReturnThis(),
        to: vi.fn((_target: unknown, props: Record<string, unknown>) => {
          if (typeof props.onComplete === "function") props.onComplete();
          return timeline;
        }),
      };
      return timeline;
    }),
    to: vi.fn((target: unknown, props: Record<string, unknown>) => {
      applyStyles(target, props);
      if (typeof props.onComplete === "function") props.onComplete();
    }),
  };
  return { default: gsapMock, gsap: gsapMock, ...gsapMock };
});

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: vi.fn(() => false),
  useResolvedMotionDuration: vi.fn((duration: string | number) => (typeof duration === "number" ? duration : duration)),
}));

vi.mock("../../../dashboard/src/v2/lib/invocation-api.js", () => ({
  fetchInvocationMessages: vi.fn(() => Promise.resolve([])),
}));

import { useReducedMotion } from "../../../dashboard/src/v2/hooks/use-reduced-motion.js";
import { useDropdownKeyboard } from "../../../dashboard/src/v2/components/TopNav.js";
import { ConfirmDialog } from "../../../dashboard/src/v2/components/ui/ConfirmDialog.js";
import { FilterStrip } from "../../../dashboard/src/v2/components/ui/FilterStrip.js";
import { Popover } from "../../../dashboard/src/v2/components/ui/Popover.js";
import { ProviderInstanceCard } from "../../../dashboard/src/v2/components/settings/ProviderInstanceCard.js";
import { KanbanTaskCard } from "../../../dashboard/src/v2/components/tasks/KanbanTaskCard.js";
import { createMockTask } from "../../../dashboard/src/v2/components/tasks/__tests__/fixtures/tasks.fixture.js";
import { PreviewSessionSlider } from "../../../dashboard/src/v2/components/browser/PreviewSessionSlider.js";
import { PreviewWindowChrome } from "../../../dashboard/src/v2/components/browser/PreviewWindowChrome.js";
import { LiveTransportBanner } from "../../../dashboard/src/v2/components/live-session/LiveTransportBanner.js";
import { ActionFeedbackRegion } from "../../../dashboard/src/v2/components/ui/ActionFeedbackRegion.js";
import { FileViewer } from "../../../dashboard/src/v2/components/file-browser/FileViewer.js";
import { DiffViewer } from "../../../dashboard/src/v2/components/file-browser/DiffViewer.js";
import { InvocationsTable } from "../../../dashboard/src/v2/pages/stats/components/system/InvocationsTable.js";
import { WaveFluid } from "../../../dashboard/src/v2/components/ui/WaveFluid.js";
const mockedUseReducedMotion = vi.mocked(useReducedMotion);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const previewSession: SprintPreviewSession = {
  id: "preview-session-alpha",
  projectId: "project-1",
  sprintId: "sprint-1",
  sprintName: "Very long preview sprint name that must wrap inside the rail card",
  status: "running",
  healthStatus: "healthy",
  containerAppPort: 3000,
  hostPort: 4445,
  lastKnownPath: "/",
  createdAt: "2026-07-03T10:00:00.000Z",
  updatedAt: "2026-07-03T10:00:00.000Z",
};

function createInvocation(overrides: Partial<ExecutionInvocationRecord> = {}): ExecutionInvocationRecord {
  return {
    id: "invocation-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    sprintRunId: null,
    dispatchId: null,
    taskRunId: null,
    attentionItemId: null,
    providerInvocationId: null,
    type: "task_run",
    status: "completed",
    provider: "codex",
    model: "gpt-5-codex-with-a-long-routing-name",
    systemPrompt: null,
    startedAt: "2026-07-03T10:00:00.000Z",
    finishedAt: "2026-07-03T10:01:00.000Z",
    errorMessage: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    lastRetryAfterIso: null,
    messageCount: 1,
    lastMessageAt: "2026-07-03T10:00:30.000Z",
    invocationSource: "internal",
    agentPresetId: null,
    inputTokens: 100,
    cachedInputTokens: 10,
    outputTokens: 50,
    totalTokens: 160,
    sprintNumber: 1,
    sprintName: "Sprint One",
    sprintSlug: "sprint-one",
    taskKey: "TASK-1",
    taskTitle: "Accessible table regression",
    createdAt: "2026-07-03T10:00:00.000Z",
    updatedAt: "2026-07-03T10:01:00.000Z",
    ...overrides,
  };
}

function ShellListboxHarness(): h.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toggleRef, onToggleKeyDown, onContainerKeyDown, activeDescendantId } = useDropdownKeyboard(
    open,
    setOpen,
    containerRef,
  );

  return (
    <div>
      <button
        ref={toggleRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "project-listbox" : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => onToggleKeyDown(event as unknown as KeyboardEvent)}
      >
        Project selector
      </button>
      {open ? (
        <div ref={containerRef} onKeyDown={(event) => onContainerKeyDown(event as unknown as KeyboardEvent)}>
          <div
            id="project-listbox"
            role="listbox"
            aria-label="Project list"
            aria-activedescendant={activeDescendantId}
          >
            <button id="project-alpha" type="button" role="option" aria-selected="true">Alpha</button>
            <button id="project-beta" type="button" role="option" aria-selected="false">Beta</button>
            <button id="project-gamma" type="button" role="option" aria-selected="false">Gamma</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TableHarness(): h.JSX.Element {
  const [sort, setSort] = useState<SystemSort>({ key: "startedAt", dir: "desc" });
  return (
    <InvocationsTable
      invocations={[createInvocation()]}
      sort={sort}
      onSortChange={setSort}
      expandedId={null}
      onRowExpand={vi.fn()}
    />
  );
}

function PopoverHarness(): h.JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      ariaLabel="Runtime actions"
      triggerRef={triggerRef}
      content={<button type="button">Popover action</button>}
    >
      <button ref={triggerRef} type="button">Open popover</button>
    </Popover>
  );
}

describe("dashboard accessibility quality regressions", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockedUseReducedMotion.mockReturnValue(false);
    global.ResizeObserver = ResizeObserverMock;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("provides reusable DOM checks for unnamed icon controls and unbounded horizontal overflow", () => {
    const { container } = renderWithI18n(
      <div>
        <button type="button" aria-label="Named icon"><span aria-hidden="true">x</span></button>
        <button type="button"><svg aria-hidden="true" /></button>
        <div className="overflow-x-auto">
          <div className="w-[200vw]">Bounded rail</div>
        </div>
        <div className="w-screen">Unbounded viewport item</div>
      </div>,
    );

    expect(collectIconOnlyButtonsWithoutNames(container)).toHaveLength(1);
    expect(collectHorizontalOverflowWithoutBoundary(container)).toHaveLength(1);
  });

  it("supports shell listbox keyboard navigation and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ShellListboxHarness />);

    const trigger = screen.getByRole("button", { name: "Project selector" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    const listbox = screen.getByRole("listbox", { name: "Project list" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("option", { name: "Alpha" })).toHaveFocus();
    expect(listbox).toHaveAttribute("aria-activedescendant", "project-alpha");

    await user.keyboard("{End}");
    expect(screen.getByRole("option", { name: "Gamma" })).toHaveFocus();
    expect(listbox).toHaveAttribute("aria-activedescendant", "project-gamma");

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps dialogs named, focus-trapped, viewport bounded, and destructive confirmation explicit", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    renderWithI18n(
      <div>
        <button type="button">Before dialog</button>
        <ConfirmDialog
          isOpen
          options={{
            title: "Delete Sprints?",
            body: "Delete selected sprints and their tasks.",
            confirmLabel: "Delete Sprints",
            cancelLabel: "Cancel",
            destructive: true,
          }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </div>,
    );

    const dialog = screen.getByRole("dialog", { name: "Delete Sprints?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]");
    expect(dialog).toHaveClass("max-w-[calc(100vw-2rem)]");

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Hold to Delete Sprints" });
    cancel.focus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(confirm, { key: " " });
    expect(confirm).toHaveAccessibleDescription(/Release before completion to cancel/i);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels destructive hold without confirming and describes recovery without live-region noise", async () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();

    renderWithI18n(
      <ConfirmDialog
        isOpen
        options={{
          title: "Delete Runtime Data?",
          body: "Delete cached runtime data.",
          confirmLabel: "Delete Data",
          destructive: true,
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Hold to Delete Data" });
    fireEvent.pointerDown(confirm, { button: 0 });
    expect(confirm).toHaveAccessibleDescription("Keep holding until progress completes. Release before completion to cancel.");

    fireEvent.pointerUp(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(confirm).toHaveTextContent("Release canceled");
    expect(confirm).toHaveAccessibleDescription("Confirmation canceled. Hold again to confirm.");
    expect(confirm.closest('[aria-live="polite"], [aria-live="assertive"]')).toBeNull();

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(confirm).toHaveAccessibleDescription("Hold until complete. Release before completion to cancel.");
  });

  it("keeps non-destructive confirmation controls stable while confirm is pending", async () => {
    let resolveConfirm: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => {
      resolveConfirm = resolve;
    }));
    const onCancel = vi.fn();

    renderWithI18n(
      <ConfirmDialog
        isOpen
        options={{
          title: "Refresh Settings?",
          body: "Reload settings from disk.",
          confirmLabel: "Refresh Settings",
          cancelLabel: "Keep Editing",
          tone: "warning",
        }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Refresh Settings?" });
    const confirm = screen.getByRole("button", { name: "Refresh Settings" });
    const cancel = screen.getByRole("button", { name: "Keep Editing" });

    await userEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(screen.getByText("Processing, please wait")).toHaveClass("sr-only");

    resolveConfirm();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Refresh Settings?" })).not.toBeInTheDocument();
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("closes Popover on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderWithI18n(<PopoverHarness />);

    const trigger = screen.getByRole("button", { name: "Open popover" });
    trigger.focus();
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Runtime actions" })).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "Popover action" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("supports tablist roving focus and sortable invocation headers", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithI18n(
      <div>
        <FilterStrip
          ariaLabel="Task stream filters"
          options={[
            { value: "all", label: "All Tasks" },
            { value: "active", label: "Active" },
            { value: "done", label: "Done" },
          ]}
          active="all"
          onChange={onChange}
        />
        <TableHarness />
      </div>,
    );

    const firstTab = screen.getByRole("tab", { name: "All Tasks" });
    firstTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Active" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Done" })).toHaveFocus();

    const timeHeader = screen.getByRole("columnheader", { name: /Time/i });
    expect(timeHeader).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: /Sort invocations by time, currently sorted descending/i }));
    expect(timeHeader).toHaveAttribute("aria-sort", "ascending");
  });

  it("announces async states across live, feedback, file, diff, and stats surfaces", () => {
    const { rerender } = renderWithI18n(
      <LiveTransportBanner
        transportState="reconnecting"
        isRecovering={false}
        snapshotUpdatedAt={null}
        error={null}
      />,
    );
    expectLiveRegion(screen.getByRole("status"), { role: "status", live: "polite" });
    expect(screen.getByText("Reconnecting")).toBeInTheDocument();

    rerender(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt={null}
        error="Socket closed"
      />,
    );
    expectLiveRegion(screen.getByRole("alert"), { role: "alert", live: "assertive" });
    cleanup();

    const feedback = renderWithI18n(<ActionFeedbackRegion status="pending" message="Saving settings" progress={35} />);
    const pending = screen.getByRole("status");
    expectLiveRegion(pending, { role: "status", live: "polite" });
    expect(pending).toHaveAttribute("aria-busy", "true");
    feedback.rerender(<ActionFeedbackRegion status="success" message="Settings saved" />);
    expect(screen.getByRole("status")).toHaveTextContent("Settings saved");
    feedback.rerender(<ActionFeedbackRegion status="error" message="Settings failed" />);
    expectLiveRegion(screen.getByRole("alert"), { role: "alert", live: "assertive" });
    cleanup();

    const file = renderWithI18n(<FileViewer file={null} loading error={null} isDark={false} />);
    expectLiveRegion(screen.getByRole("status"), { role: "status", live: "polite" });
    file.rerender(<FileViewer file={null} loading={false} error={null} isDark={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("No file selected");
    file.rerender(<FileViewer file={null} loading={false} error="read failed" isDark={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("read failed");
    cleanup();

    const diff = renderWithI18n(<DiffViewer diff={null} loading error={null} isDark={false} sideBySide={false} />);
    expectLiveRegion(screen.getByRole("status"), { role: "status", live: "polite" });
    diff.rerender(<DiffViewer diff={null} loading={false} error={null} isDark={false} sideBySide={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("No change selected");
    diff.rerender(<DiffViewer diff={null} loading={false} error="diff failed" isDark={false} sideBySide={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("diff failed");
    cleanup();

    const table = renderWithI18n(
      <InvocationsTable invocations={[]} sort={{ key: "startedAt", dir: "desc" }} onSortChange={vi.fn()} expandedId={null} onRowExpand={vi.fn()} loading />,
    );
    expect(screen.getByRole("status", { name: "Loading invocation records" })).toHaveTextContent("Loading invocation records");
    table.rerender(
      <InvocationsTable invocations={[]} sort={{ key: "startedAt", dir: "desc" }} onSortChange={vi.fn()} expandedId={null} onRowExpand={vi.fn()} />,
    );
    expect(screen.getByRole("status", { name: "No invocation records" })).toHaveTextContent("No invocation records to show");
    table.rerender(
      <InvocationsTable invocations={[]} sort={{ key: "startedAt", dir: "desc" }} onSortChange={vi.fn()} expandedId={null} onRowExpand={vi.fn()} error="network down" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("network down");
  });

  it("keeps provider, task, preview, and stats responsive accessibility contracts stable", () => {
    const onUpdate = vi.fn();
    const provider = {
      provider: "opencode",
      name: "Very Long OpenCode Provider Name That Should Wrap Across Lines",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
      openCodeAuthMode: "CUSTOM_PROVIDER",
      openCodeProviderId: "ollama",
    } as const;

    const task = createMockTask({
      recordId: "task-long",
      id: "TASK-LONG",
      title: "Very long task title that must wrap without hiding actions or forcing page width",
      status: "in_progress",
      priority: "high",
      source: "very-long/repository/path/that/should/not/overflow",
      assignee: "Long Assignee Name",
    });
    const taskViewModel: TaskCardViewModel = {
      task,
      humanizedCreatedAt: "1m ago",
      executorLabel: "Codex Gateway",
      dependencyIndicators: [],
      sessionId: "session-with-a-long-runtime-identifier",
    };

    const { container } = renderWithI18n(
      <div>
        <ProviderInstanceCard
          providerConfigId="opencode-long"
          provider={provider}
          providerModel="ollama/glm-4.7-flash"
          dockerExecutionEnabled={false}
          onUpdate={onUpdate}
          onRemove={vi.fn()}
          enabled
          onToggleEnabled={vi.fn()}
        />
        <KanbanTaskCard viewModel={taskViewModel} onEdit={vi.fn()} onDelete={vi.fn()} />
        <PreviewSessionSlider
          sessions={[previewSession]}
          selectedSessionId={previewSession.id}
          onSelectSession={vi.fn()}
          onRemoveSession={vi.fn()}
        />
        <PreviewWindowChrome
          session={previewSession}
          onNavigateBack={vi.fn()}
          onNavigateForward={vi.fn()}
          onReload={vi.fn()}
          onAddressSubmit={vi.fn()}
          addressValue="/deep/path"
          onAddressChange={vi.fn()}
        >
          <div data-testid="preview-frame" />
        </PreviewWindowChrome>
        <InvocationsTable
          invocations={[createInvocation()]}
          sort={{ key: "startedAt", dir: "desc" }}
          onSortChange={vi.fn()}
          expandedId={null}
          onRowExpand={vi.fn()}
        />
      </div>,
      {},
      "de",
    );

    expect(screen.getByRole("region", { name: provider.name })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: `${provider.name} Authentifizierungsmodus` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${provider.name} Anbieter-ID` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Entfernen: ${provider.name}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete task TASK-LONG:/ })).toHaveAccessibleName(/Very long task title/);
    expect(container.querySelector(".kanban-card h4")).toHaveClass("break-words");
    expect(screen.getByRole("list", { name: "1 Vorschau-Sitzung" })).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("button", { name: `Vorschau-Sitzung ${previewSession.sprintName} auswählen` })).toHaveAccessibleName(
      new RegExp(previewSession.sprintName),
    );
    expect(screen.getByLabelText("Vorschaufenster schließen")).toBeInTheDocument();
    expect(screen.getByLabelText(`Vorschau-Adresse für ${previewSession.sprintName}`)).toBeInTheDocument();

    const caption = screen.getByText(/Invocation ledger with sortable time/i);
    expect(caption.tagName.toLowerCase()).toBe("caption");
    expect(caption).toHaveClass("sr-only");
    const row = screen.getByRole("row", { name: /gpt-5-codex-with-a-long-routing-name/i });
    expect(within(row).getByText("Model")).toHaveClass("lg:hidden");
    expect(within(row).getByText("Messages")).toHaveClass("lg:hidden");
    expect(collectIconOnlyButtonsWithoutNames(container)).toHaveLength(0);
    expect(collectHorizontalOverflowWithoutBoundary(container)).toHaveLength(0);
  });

  it("uses static reduced-motion primitives instead of animated-only state", () => {
    mockedUseReducedMotion.mockReturnValue(true);

    const { container } = renderWithI18n(<WaveFluid accentHex="#00e0a0" isActive />);
    const waveRoot = container.firstElementChild as HTMLElement;
    expect(waveRoot).toHaveAttribute("data-active", "true");
    expect(waveRoot).toHaveClass("opacity-[0.65]");
    expect(container.querySelector("svg")).toHaveStyle({ animation: "none" });

    const task = createMockTask({ recordId: "task-reduced", id: "TASK-REDUCED" });
    const viewModel: TaskCardViewModel = {
      task,
      humanizedCreatedAt: "1m ago",
      executorLabel: "Codex",
      dependencyIndicators: [],
    };
    renderWithI18n(<KanbanTaskCard viewModel={viewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const card = screen.getByLabelText(/Task TASK-REDUCED:/);
    expect(card).toHaveClass("kanban-card-reduced-motion");
    expect(card).not.toHaveAttribute("draggable", "true");
    expect(screen.getByText("Draggable reordering is disabled in reduced motion mode.")).toHaveClass("sr-only");

    const rootStyles = readSource("dashboard/src/styles.css");
    expect(rootStyles).toMatch(/:root\[data-reduced-motion="true"\]/);
    expect(rootStyles).toMatch(/:root\[data-reduced-motion="REDUCE"\]/);
    expect(rootStyles).toMatch(/\.animate-spin, \.animate-ping, \.animate-pulse, \.animate-bounce, \.animate-skeleton-shimmer/);
    expect(rootStyles).toMatch(/\.live-duration-badge[\s\S]*var\(--status-static-running-ring\)/);

    const tokenStyles = readSource("dashboard/src/v2/styles/tokens.css");
    expect(tokenStyles).toMatch(/:root\[data-reduced-motion="true"\]/);
    expect(tokenStyles).toMatch(/:root\[data-reduced-motion="REDUCE"\]/);
  });

  it("guards refined interaction surfaces against hardcoded motion timing", () => {
    const refinedSources = [
      "dashboard/src/v2/components/ui/ActionFeedbackRegion.tsx",
      "dashboard/src/v2/components/ui/ConfirmDialog.tsx",
      "dashboard/src/v2/components/sprints/SprintLedger.tsx",
      "dashboard/src/v2/components/sprints/SprintLedgerBulkActions.tsx",
      "dashboard/src/v2/components/sprints/SprintLedgerRow.tsx",
      "dashboard/src/v2/components/quicksprint/QuicksprintPanel.tsx",
      "dashboard/src/v2/components/settings/SettingsContentPanels.tsx",
      "dashboard/src/v2/components/settings/SettingsCategoryRail.tsx",
      "dashboard/src/v2/components/live-session/LiveTransportBanner.tsx",
      "dashboard/src/v2/components/search/SearchOverlay.tsx",
      "dashboard/src/v2/components/search/SearchResultRow.tsx",
    ];

    for (const relativePath of refinedSources) {
      const source = readSource(relativePath);
      expect(source, `${relativePath} must resolve motion through interaction tokens`).toMatch(
        /useInteractionTokens|useGsapInteractionTokens|INTERACTION_TOKENS/,
      );
      expect(source, `${relativePath} must not use fixed Tailwind duration utilities on refined interactions`).not.toMatch(
        /\bduration-(?:75|100|150|200|300|500|700|1000|\[(?!var\()[^\]]+\])/,
      );
    }

    expect(readSource("dashboard/src/v2/components/sprints/SprintLedger.tsx")).toMatch(/listReorder/);
    expect(readSource("dashboard/src/v2/components/sprints/SprintLedgerRow.tsx")).toMatch(/selectionMovement/);
    expect(readSource("dashboard/src/v2/components/ui/ActionFeedbackRegion.tsx")).toMatch(/asyncFeedback/);
    expect(readSource("dashboard/src/v2/components/quicksprint/QuicksprintExecutionView.tsx")).toMatch(
      /var\(--interaction-expansion-collapse-duration\)/,
    );
  });

  it("guards async feedback surfaces with busy, live, and stale-data semantics", () => {
    const actionFeedback = readSource("dashboard/src/v2/components/ui/ActionFeedbackRegion.tsx");
    expect(actionFeedback).toMatch(/role=\{isError \? "alert" : "status"\}/);
    expect(actionFeedback).toMatch(/aria-live=\{isError \? "assertive" : isPending \|\| displayedStatus === "warning" \? "polite" : "off"\}/);
    expect(actionFeedback).toMatch(/aria-busy=\{isPending \? "true" : undefined\}/);
    expect(actionFeedback).toMatch(/<span className="sr-only">\{statusLabel\}\. <\/span>/);

    const quicksprint = readSource("dashboard/src/v2/components/quicksprint/QuicksprintExecutionView.tsx");
    expect(quicksprint).toMatch(/aria-busy=\{isBusy \|\| pendingExecuteMode !== null \|\| isCancelPending \? "true" : "false"\}/);
    expect(quicksprint).toMatch(/aria-describedby=\{isSubmitBlocked \? duplicateSubmitDescriptionId : undefined\}/);

    const quicksprintPanel = readSource("dashboard/src/v2/components/quicksprint/QuicksprintPanel.tsx");
    expect(quicksprintPanel).toMatch(/role="status"/);

    const settingsContentPanels = readSource("dashboard/src/v2/components/settings/SettingsContentPanels.tsx");
    expect(settingsContentPanels).toMatch(/aria-busy=\{activeSaving \|\| loading \|\| resettingProject \? "true" : undefined\}/);
    expect(settingsContentPanels).toMatch(/<SettingsActivePanelStatus state=\{state\} stickyTop=\{stickyTop\} \/>/);
    expect(settingsContentPanels).toMatch(/Current values remain visible/);

    const settingsActivePanelStatus = readSource("dashboard/src/v2/components/settings/SettingsActivePanelStatus.tsx");
    expect(settingsActivePanelStatus).toMatch(/role=\{error \? "alert" : "status"\}/);
    expect(settingsActivePanelStatus).toMatch(/aria-live=\{error \? "assertive" : "polite"\}/);
    expect(settingsActivePanelStatus).toMatch(/data-settings-sticky=\{sticky \? "active-panel" : undefined\}/);

    const liveSessionViewModel = readSource("dashboard/src/v2/lib/live-session-view-model.ts");
    expect(liveSessionViewModel).toMatch(/Stale Data/);
    expect(liveSessionViewModel).toMatch(/role: "status"/);
    expect(liveSessionViewModel).toMatch(/ariaLive: "polite"/);
    expect(liveSessionViewModel).toMatch(/ariaBusy: true/);

    const searchOverlay = readSource("dashboard/src/v2/components/search/SearchOverlay.tsx");
    expect(searchOverlay).toMatch(/current results remain available/);
    expect(searchOverlay).toMatch(/aria-busy=\{isLoading \? "true" : undefined\}/);
    expect(searchOverlay).toMatch(/aria-activedescendant=\{activeDescendantId\}/);

    const runtimeEventFeed = readSource("dashboard/src/v2/components/RuntimeEventFeed.tsx");
    expect(runtimeEventFeed).toMatch(/aria-busy="true"/);
    expect(runtimeEventFeed).toMatch(/Loading runtime events/);
    expect(runtimeEventFeed).toMatch(/aria-busy="false"/);

    const liveDurationBadge = readSource("dashboard/src/v2/components/ui/LiveDurationBadge.tsx");
    expect(liveDurationBadge).toMatch(/aria-label=\{`Live duration:/);
    expect(liveDurationBadge).toMatch(/live-duration-badge/);
  });

  it("guards disabled reasons and non-hover action access on refined controls", () => {
    const sprintRow = readSource("dashboard/src/v2/components/sprints/SprintLedgerRow.tsx");
    expect(sprintRow).toMatch(/title=\{selectionDisabledTitle\}/);
    expect(sprintRow).toMatch(/title=\{pinDisabledTitle\}/);
    expect(sprintRow).toMatch(/controlsDisabledBulk/);
    expect(sprintRow).not.toMatch(/group-hover:opacity-100/);

    const bulkActions = readSource("dashboard/src/v2/components/sprints/SprintLedgerBulkActions.tsx");
    expect(bulkActions).toMatch(/title=\{disabledTitle\}/);
    expect(bulkActions).toMatch(/aria-disabled=\{isAnyPending\}/);
    expect(bulkActions).toMatch(/aria-live="polite"/);

    const settingsRail = readSource("dashboard/src/v2/components/settings/SettingsCategoryRail.tsx");
    expect(settingsRail).toMatch(/title=\{disabled && disabledCategoryReason \? disabledCategoryReason : undefined\}/);
    expect(settingsRail).toMatch(/aria-disabled=\{disabled\}/);
    expect(settingsRail).toMatch(/Disabled/);

    const taskCard = readSource("dashboard/src/v2/components/tasks/KanbanTaskCard.tsx");
    expect(taskCard).toMatch(/Edit task \$\{task\.id\}/);
    expect(taskCard).toMatch(/Delete task \$\{task\.id\}/);
    expect(taskCard).not.toMatch(/group-hover:opacity-100/);
  });
});
