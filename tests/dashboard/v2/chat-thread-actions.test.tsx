// @vitest-environment jsdom
/** @jsx h */
import { describe, it, expect, vi } from "vitest";
import { h } from "preact";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import * as matchers from '@testing-library/jest-dom/matchers';
import { ThreadListCard } from "../../../dashboard/src/v2/components/chat/ThreadListCard.js";
import { ChatThreadHeader } from "../../../dashboard/src/v2/components/chat/ChatThreadHeader.js";

expect.extend(matchers);

// Mock GSAP to execute immediately without animations
vi.mock("gsap", () => ({
  default: {
    to: (target: any, options: any) => {
      if (options && options.onComplete) {
        options.onComplete();
      }
      return {};
    },
    fromTo: () => ({})
  }
}));

describe("ThreadListCard - Delete Confirmation", () => {
  const baseThread = {
    id: "t1",
    projectId: "p1",
    connectionId: null,
    scope: "project",
    title: "Project Alpha Thread",
    status: "active",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
    messageCount: 5,
    pendingMessageCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
  } as any;

  it("should open confirmation dialog and trigger onDelete when confirmed", async () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();

    const { container } = render(
      <ThreadListCard
        threads={[baseThread]}
        selectedThreadId={null}
        onSelect={onSelect}
        onDelete={onDelete}
        deletingThreadId={null}
      />
    );

    // Find and click the trash button
    const deleteButton = screen.getByLabelText("Delete Project Alpha Thread");
    fireEvent.click(deleteButton);

    // Dialog should appear
    expect(screen.getByText("Confirm?")).toBeInTheDocument();

    // Click confirm
    const confirmButton = screen.getByRole("button", { name: "Confirm?" });
    fireEvent.click(confirmButton);

    // Verify deletion was triggered
    await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith("t1");
    });
  });
});

describe("ChatThreadHeader - Action Feedback", () => {
  const mockOptions = [
    { id: "conn-1", label: "Worker 1", status: "online", isPrimary: false, type: "connection", isSelectable: true },
  ];

  const baseThread = {
    id: "t1",
    projectId: "p1",
    title: "Test Thread",
    messageCount: 5,
  } as any;

  it("should render action feedback when provided", () => {
    const feedback = { status: "success" as const, message: "Route successfully assigned." };

    render(
      <ChatThreadHeader
        thread={baseThread}
        workerOptions={mockOptions as any}
        isAssigning={false}
        onAssignRoute={vi.fn()}
        onCompact={vi.fn()}
        isCompacting={false}
        actionFeedback={feedback}
        onDismissFeedback={vi.fn()}
      />
    );

    // Look for feedback text inside the component
    expect(screen.getByText("Route successfully assigned.")).toBeInTheDocument();

    // Status role should be present for success
    const regions = screen.getAllByRole("status");
    expect(regions.length).toBeGreaterThan(0);
  });
});
