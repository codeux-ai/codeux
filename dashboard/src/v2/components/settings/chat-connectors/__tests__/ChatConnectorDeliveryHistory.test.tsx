/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatProviderPublicDeliveryRecord } from "../../../../../types.js";
import { ChatConnectorDeliveryHistory } from "../ChatConnectorDeliveryHistory.js";

const delivery: ChatProviderPublicDeliveryRecord = {
  id: "delivery-1", providerConnectionId: "connection-1", providerKind: "discord", channelBindingId: "binding-1",
  externalChannelId: "123", externalMessageId: null, direction: "outbound", status: "retryable_failure", attemptCount: 3,
  lastError: "token=private-token https://provider.test/send?signature=private", conversationThreadId: "thread-1",
  conversationMessageId: "message-1", nextAttemptAt: "2026-07-14T12:00:00.000Z",
  createdAt: "2026-07-14T11:00:00.000Z", updatedAt: "2026-07-14T11:30:00.000Z",
};

describe("ChatConnectorDeliveryHistory", () => {
  afterEach(cleanup);

  it("shows retry state and redacted diagnostics without payload data", () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    render(<ChatConnectorDeliveryHistory connectionName="Discord" deliveries={[delivery]} pendingDeliveries={{}} onInspect={vi.fn()} onRetry={onRetry} onCancel={onCancel} />);
    expect(screen.getByText("Retryable")).not.toBeNull();
    expect(screen.getByText(/Next retry/)).not.toBeNull();
    expect(document.body.textContent).not.toContain("private-token");
    expect(document.body.textContent).not.toContain("provider.test");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRetry).toHaveBeenCalledWith(delivery);
    expect(onCancel).toHaveBeenCalledWith(delivery);
  });
});
