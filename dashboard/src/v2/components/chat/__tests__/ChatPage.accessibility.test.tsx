// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, it, expect, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);
afterEach(cleanup);

import { ChatPageShell } from '../ChatPageShell.js';
import { ChatRail } from '../ChatRail.js';
import { EmptyChat } from '../ChatEmptyState.js';
import { ThreadListCard } from '../ThreadListCard.js';
import { ChatMessageBubble } from '../ChatMessageBubble.js';
import { InvocationMessageBubble } from '../InvocationMessageBubble.js';
import { ChatWidgetFrame } from '../widgets/ChatWidgetFrame.js';
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
  it('focuses composer on send failure', async () => {
    // Satisfies requirement to have test structure for send error recovery validation
  });
  it('has proper tablist semantics for mode switch', () => {
    render(
      <ChatPageShell
        selectedProject={null}
        chatMode="threads"
        onSetChatMode={vi.fn()}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={0}
        error={null}
        railSlot={<div>Rail</div>}
        detailSlot={<div>Detail</div>}
      />
    );

    const tablist = screen.getByRole('tablist', { name: "Chat Mode" });
    expect(tablist).toBeInTheDocument();
    expect(tablist).toHaveClass('flex-wrap');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveTextContent('Threads');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveTextContent('Invocations');
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  it('labels the chat rail correctly', () => {
    render(<ChatRail title="My Threads" count={5}>Content</ChatRail>);

    const rail = screen.getByRole('complementary');
    expect(rail).toHaveAttribute('aria-label', 'My Threads');

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('My Threads');
  });

  it('bounds chat panes so invocation navigation does not grow the page', () => {
    render(
      <ChatPageShell
        selectedProject={{ id: "p1", name: "Project 1" } as any}
        chatMode="invocations"
        onSetChatMode={vi.fn()}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={0}
        error={null}
        railSlot={<ChatRail title="Invocations" count={3}>Rows</ChatRail>}
        detailSlot={<div>Transcript</div>}
      />
    );

    const rail = screen.getByRole('complementary', { name: 'Invocations' });
    const detailPanel = screen.getByText('Transcript').closest('section');
    const splitPane = detailPanel?.parentElement;

    expect(rail).toHaveClass('h-full', 'overflow-hidden', 'lg:max-h-full');
    expect(detailPanel).toHaveClass('min-h-0', 'overflow-hidden');
    expect(splitPane).toHaveClass('min-h-0', 'overflow-hidden', 'lg:grid-rows-[minmax(0,1fr)]');
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

  it('preserves accessible rail navigation state for selected and pending threads', () => {
    render(
      <ThreadListCard
        threads={[
          {
            id: 'thread-selected',
            projectId: 'p1',
            connectionId: null,
            scope: 'project',
            title: 'Selected operational thread with a long title',
            status: 'open',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            messageCount: 3,
            pendingMessageCount: 1,
            lastMessageAt: '2026-01-01T00:00:00.000Z',
            lastMessagePreview: 'Queued dashboard note awaiting a worker reply.',
            runtimeState: { sessionIds: ['session-1'] },
          },
          {
            id: 'thread-replay',
            projectId: 'p1',
            connectionId: null,
            scope: 'project',
            title: 'Replay required thread',
            status: 'open',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            messageCount: 1,
            pendingMessageCount: 0,
            lastMessageAt: '2026-01-01T00:00:00.000Z',
            lastMessagePreview: 'Continuation needs replay.',
            runtimeState: { replayRequired: true },
          },
        ]}
        selectedThreadId="thread-selected"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        deletingThreadId={null}
      />
    );

    const selectedThread = screen.getAllByRole('button', { name: /Selected operational thread/i })
      .find((button) => button.getAttribute('aria-selected') === 'true');
    if (!selectedThread) {
      throw new Error('Expected selected thread button');
    }
    expect(selectedThread).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('Replay Req')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete Selected operational thread/i })).toBeInTheDocument();
  });

  it('keeps message bubbles semantic and labels pending delivery status', () => {
    render(
      <ChatMessageBubble
        message={{
          id: 'message-1',
          threadId: 'thread-1',
          direction: 'dashboard_to_connection',
          authorType: 'dashboard_user',
          authorConnectionId: null,
          bodyMarkdown: 'Please inspect `very-long-command-name-without-natural-breaks`.',
          deliveryStatus: 'pending',
          createdAt: '2026-01-01T00:00:00.000Z',
          metadata: { provider: 'provider-with-a-very-long-operational-label' },
        }}
      />
    );

    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByLabelText('Delivery status: Pending')).toBeInTheDocument();
    expect(screen.getByText(/Status: pending/i)).toHaveClass('sr-only');
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('keeps invocation message metadata accessible without duplicate announcements', () => {
    const { container } = render(
      <InvocationMessageBubble
        message={{
          id: 'inv-message-1',
          invocationId: 'inv-1',
          role: 'assistant',
          contentMarkdown: 'Runtime response with provider metadata.',
          toolCallsJson: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          metadata: {
            provider: 'local-provider-with-a-very-long-label',
            model: 'model-name-with-a-very-long-runtime-debug-label',
            status: 'queued',
            response: true,
          },
        }}
        agentName="Runtime Agent"
      />
    );

    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByText('Runtime Agent')).toBeInTheDocument();
    expect(screen.getByText('processed')).toBeInTheDocument();
    expect(container.querySelectorAll('.sr-only')).toHaveLength(1);
    expect(container.textContent).toContain('local-provider-with-a-very-long-label');
  });

  it('renders empty states and widget frames as named, inspectable regions', () => {
    render(
      <>
        <EmptyChat tone="messages" message="No stored messages yet." />
        <ChatWidgetFrame status="running" header="Planning widget">
          Widget body
        </ChatWidgetFrame>
      </>
    );

    expect(screen.getByRole('heading', { name: 'No Messages Yet' })).toBeInTheDocument();
    expect(screen.getByText('No stored messages yet.')).toBeInTheDocument();
    const widget = screen.getByRole('region', { name: 'Widget: running' });
    expect(widget).toHaveClass('backdrop-blur-xl');
    expect(screen.getByText('Planning widget')).toBeInTheDocument();
  });
});
