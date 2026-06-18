// @vitest-environment jsdom
import { render, screen } from '@testing-library/preact';
import { describe, it, expect, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

import { ChatPageShell } from '../ChatPageShell.js';
import { ChatRail } from '../ChatRail.js';
import { ChatPage } from '../../../ChatPage.js';
import { ProjectDataContext } from '../../../context/project-data.js';

// Mock router
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: any) => <div>{children}</div>
}));

// Mock page data hook
vi.mock('../../../hooks/use-chat-page-data.js', () => ({
  useChatPageData: () => ({
    chatMode: "threads",
    setChatMode: vi.fn(),
    threads: [{ scope: "project", id: "thread1", title: "Thread 1", createdAt: new Date() }],
    invocations: [],
    selectedThreadId: "1",
    selectedInvocationId: null,
    messages: [],
    invocationMessages: [],
    input: "",
    setInput: vi.fn(),
    manualRefreshing: false,
    sending: true,
    error: "Test error",
    selectedProject: { id: "p1", name: "Project 1" },
    activeConnection: null,
    agentPresets: [],
    connections: [],
    feedback: { status: "idle", message: "" },
    clearFeedback: vi.fn(),
    isConfirmOpen: false,
    confirmOptions: null,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn()
  })
}));

// Mock effective settings
vi.mock('../../../hooks/use-project-effective-settings.js', () => ({
  useProjectEffectiveSettings: () => ({ data: { settings: {} } })
}));

describe('ChatPage Accessibility', () => {
  it('has proper tablist semantics for mode switch', () => {
    render(
      <ChatPageShell
        selectedProject={null}
        chatMode="threads"
        onSetChatMode={vi.fn()}
        onRefresh={vi.fn()}
        manualRefreshing={false}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={0}
        error={null}
        railSlot={<div>Rail</div>}
        detailSlot={<div>Detail</div>}
      />
    );

    const tablist = screen.getByRole('tablist', { name: "Chat Mode" });
    expect(tablist).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveTextContent('Threads');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveTextContent('Invocations');
  });

  it('labels the chat rail correctly', () => {
    render(<ChatRail title="My Threads" count={5}>Content</ChatRail>);

    const rail = screen.getByRole('complementary');
    expect(rail).toHaveAttribute('aria-label', 'My Threads');

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('My Threads');
  });

  it('has accessible message composer and regions', () => {
    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    const regions = screen.getAllByRole('log', { name: "Message history" });
    expect(regions.length).toBeGreaterThan(0);

    const textbox = screen.getByRole('textbox', { name: "Message" });
    expect(textbox).toBeInTheDocument();
    expect(textbox).toHaveAttribute('aria-describedby', 'composer-help');

    const helpText = screen.getByText(/Enter sends/i);
    expect(helpText).toHaveAttribute('id', 'composer-help');

    const sendBtn = screen.getByRole('button', { name: "Send message" });
    expect(sendBtn).toBeInTheDocument();

    // We mocked sending: true, so the "Sending message..." text should exist
    const liveRegion = screen.getByText(/Sending message\.\.\./);
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');

    // Check if error is correctly displayed as well
    const liveError = screen.getByText(/Failed: Test error/);
    expect(liveError).toHaveAttribute('aria-live', 'polite');
  });
});
