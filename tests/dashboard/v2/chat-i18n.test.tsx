/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import type { ComponentChildren } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageBubble } from "../../../dashboard/src/v2/components/chat/ChatMessageBubble.js";
import { SpeechInputButton } from "../../../dashboard/src/v2/components/speech/SpeechInputButton.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";
import { buildCinematicQuickActions } from "../../../dashboard/src/v2/lib/cinematic-quick-actions.js";
import { formatRelativeChatTime } from "../../../dashboard/src/v2/lib/chat-time.js";
import { formatInvocationRetryAt } from "../../../dashboard/src/v2/lib/invocation-retry-time.js";
import { getNoProjectAssistantPrompts } from "../../../dashboard/src/v2/lib/no-project-chat-assistant.js";
import { formatTokenCount } from "../../../dashboard/src/v2/lib/token-estimate.js";
import { getChatWidgetData, getWorkingBubbleData } from "../../../dashboard/src/v2/lib/chat-widget-view-models.js";
import type { ChatLiveTaskWidget } from "../../../dashboard/src/v2/lib/chat-live-entities.js";
import type { ChatMessageRecord } from "../../../dashboard/src/v2/types.js";

vi.mock("gsap", () => ({ default: { fromTo: vi.fn(), set: vi.fn(), to: vi.fn() } }));

const message: ChatMessageRecord = {
  id: "message-1",
  threadId: "thread-1",
  direction: "connection_to_dashboard",
  authorType: "connection",
  authorConnectionId: "connection-1",
  bodyMarkdown: "Provider output: **DO NOT ÜBERSETZEN**.",
  deliveryStatus: "delivered",
  createdAt: "2026-07-14T12:30:00.000Z",
  metadata: null,
};

const task: ChatLiveTaskWidget = {
  kind: "task",
  recordId: "task-1",
  displayKey: "TASK-1",
  name: "Runtime entity name — unverändert",
  status: "completed",
  href: "/tasks?taskId=task-1",
  sprintId: "sprint-1",
  sprintKey: "SPR-1",
  sprintName: "Provider sprint name",
  priority: "critical",
  executorType: "docker_cli",
  isMerged: false,
  mergeIndicator: "Provider merge status",
};

const renderGerman = (children: ComponentChildren) => render(
  <DashboardI18nProvider initialLocale="de" storage={null}>{children}</DashboardI18nProvider>,
);

describe("German Chat localization boundary", () => {
  afterEach(() => cleanup());

  it("translates message and live-entity chrome while preserving authored content", () => {
    renderGerman(<ChatMessageBubble message={message} agentName="Planner Runtime" liveEntities={[task]} onReplay={vi.fn()} />);

    expect(screen.getByText("Live-Sprint-Kontext")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nachricht von Planner Runtime wiedergeben" })).toBeInTheDocument();
    expect(screen.getByText("Runtime entity name — unverändert")).toBeInTheDocument();
    expect(screen.getByText("Provider merge status")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Provider output: DO NOT ÜBERSETZEN.");
    const link = screen.getByRole("link", { name: /Task TASK-1 öffnen/ });
    expect(within(link).getByText("Kritisch")).toBeInTheDocument();
  });

  it("keeps quick-action request prompts stable while localizing their labels", () => {
    const options = { hasProject: true, initialEligibilityLoaded: true, canCreateInitialAppQuickactions: true };
    const english = buildCinematicQuickActions(options, "en");
    const german = buildCinematicQuickActions(options, "de");

    expect(german.map((action) => action.prompt)).toEqual(english.map((action) => action.prompt));
    expect(german[0]?.label).toBe("Web-App erstellen");
    expect(german[5]?.label).toBe("Statusbericht");

    const englishPrompts = getNoProjectAssistantPrompts("en");
    const germanPrompts = getNoProjectAssistantPrompts("de");
    expect(germanPrompts.map((item) => item.prompt)).toEqual(englishPrompts.map((item) => item.prompt));
    expect(germanPrompts[0]?.label).toBe("Mein erstes Projekt hinzufügen");
  });

  it("localizes pure widget defaults without changing provider metadata", () => {
    const localized = getChatWidgetData({
      ...message,
      metadata: {
        widget_metadata: {
          type: "app_progress",
          status: "running",
          appKind: "web_app",
          sprintName: "Server sprint title",
          stackSummary: { framework: "ProviderFramework" },
        },
      },
    }, undefined, "de");

    expect(localized.appCreationProgress?.statusLabel).toBe("Der Sprint für Web-App wird geplant.");
    expect(localized.appCreationProgress?.stages[0]?.label).toBe("Planung");
    expect(localized.appCreationProgress?.stages[0]?.statusLabel).toBe("Wird ausgeführt");
    expect(localized.appCreationProgress?.stackSummary.fields[0]).toEqual({
      key: "framework",
      label: "Framework",
      value: "ProviderFramework",
    });
    expect(localized.appCreationProgress?.sprintLabel).toBe("Server sprint title");

    expect(getWorkingBubbleData({
      routeKind: "worker",
      providerLabel: "Provider Brand",
    }, "de").planName).toBe("Task über Provider Brand");
  });

  it("preserves tool status, arguments, and output while translating the tool frame", () => {
    renderGerman(<ChatMessageBubble
      message={{
        ...message,
        id: "message-tool",
        metadata: {
          kind: "tool_call",
          toolName: "provider_tool_name",
          toolStatus: "PROVIDER_STATUS_VERBATIM",
          toolCallsJson: {
            arguments: "{\"instruction\":\"NICHT ÜBERSETZEN\"}",
            output: "Provider-Ausgabe bleibt unverändert.",
          },
        },
      }}
    />);

    expect(screen.getByText("PROVIDER_STATUS_VERBATIM")).toBeInTheDocument();
    expect(screen.getByText("Eingabe")).toBeInTheDocument();
    expect(screen.getByText("Ausgabe")).toBeInTheDocument();
    expect(screen.getByText("{\"instruction\":\"NICHT ÜBERSETZEN\"}")).toBeInTheDocument();
    expect(screen.getByText("Provider-Ausgabe bleibt unverändert.")).toBeInTheDocument();
  });

  it("announces unavailable speech input in German", () => {
    renderGerman(<SpeechInputButton onTranscript={vi.fn()} mediaDevices={null} />);

    expect(screen.getByRole("button", { name: "Sprachaufnahme starten" })).toHaveTextContent("Nicht verfügbar");
    expect(screen.getByRole("status")).toHaveTextContent("Spracheingabe ist nicht verfügbar.");
  });

  it("formats Chat time, token, and retry values with German Intl conventions", () => {
    expect(formatRelativeChatTime("2026-07-14T11:00:00.000Z", "de", Date.parse("2026-07-14T12:00:00.000Z"))).toBe("vor 1 Std.");
    expect(formatTokenCount(1_500, "de")).toBe("1,5k");
    expect(formatInvocationRetryAt("2026-07-14T12:30:00.000Z", "UTC", "de")).toContain("12:30");
  });
});
