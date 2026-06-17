import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MessageListener = (event: { data: string }) => void;
type VoidListener = () => void;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];
  private readonly listeners = new Map<string, Set<MessageListener | VoidListener>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: MessageListener | VoidListener): void {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: MessageListener | VoidListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(payload: string): void {
    this.sentMessages.push(payload);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  emit(type: "open" | "close" | "error"): void;
  emit(type: "message", payload: unknown): void;
  emit(type: string, payload?: unknown): void {
    if (type === "open") {
      this.readyState = MockWebSocket.OPEN;
    }
    if (type === "close") {
      this.readyState = MockWebSocket.CLOSED;
    }
    for (const listener of this.listeners.get(type) || []) {
      if (type === "message") {
        (listener as MessageListener)({ data: JSON.stringify(payload) });
      } else {
        (listener as VoidListener)();
      }
    }
  }
}

describe("dashboard-realtime-client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        host: "localhost:4444",
      },
      setTimeout,
      clearTimeout,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reuses the server sequence watermark across reconnects", async () => {
    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const transportSpy = vi.fn();
    const unsubscribe = subscribeToDashboardRealtime(["overview"], () => {}, transportSpy);

    expect(transportSpy).toHaveBeenCalledWith("disconnected"); // initial

    const firstSocket = MockWebSocket.instances[0];
    expect(firstSocket?.url).toBe("ws://localhost:4444/api/realtime");

    firstSocket.emit("open");
    expect(transportSpy).toHaveBeenCalledWith("connected");
    vi.advanceTimersByTime(25);
    expect(JSON.parse(firstSocket.sentMessages[0] || "{}")).toMatchObject({
      type: "set_subscriptions",
      scopes: ["overview"],
      lastSequence: null,
    });

    firstSocket.emit("message", {
      type: "subscribed",
      scopes: ["overview"],
      lastSequence: 42,
    });

    firstSocket.emit("close");
    expect(transportSpy).toHaveBeenCalledWith("reconnecting");
    vi.advanceTimersByTime(250);

    const secondSocket = MockWebSocket.instances[1];
    expect(secondSocket).toBeDefined();
    secondSocket.emit("open");
    vi.advanceTimersByTime(25);

    expect(JSON.parse(secondSocket.sentMessages[0] || "{}")).toMatchObject({
      type: "set_subscriptions",
      scopes: ["overview"],
      lastSequence: 42,
    });

    unsubscribe();
  });

  it("suppresses subsequent snapshot_required messages within a 3000ms cooldown", async () => {
    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const listener = vi.fn();
    const unsubscribe = subscribeToDashboardRealtime(["overview"], listener);

    const socket = MockWebSocket.instances[0];
    socket?.emit("open");

    // First snapshot_required should be dispatched
    socket?.emit("message", { type: "snapshot_required" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "snapshot_required" });

    // Second snapshot_required within 3s should be suppressed
    vi.advanceTimersByTime(2999);
    socket?.emit("message", { type: "snapshot_required" });
    expect(listener).toHaveBeenCalledTimes(1);

    // After 3000ms cooldown, the next snapshot_required should be dispatched
    vi.advanceTimersByTime(1);
    socket?.emit("message", { type: "snapshot_required" });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("does not suppress event or subscribed messages", async () => {
    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const listener = vi.fn();
    const unsubscribe = subscribeToDashboardRealtime(["overview"], listener);

    const socket = MockWebSocket.instances[0];
    socket?.emit("open");

    // Send an initial snapshot_required to trigger the cooldown
    socket?.emit("message", { type: "snapshot_required" });
    expect(listener).toHaveBeenCalledTimes(1);

    // Send an event message immediately after
    socket?.emit("message", {
      type: "event",
      event: { scope: "overview", type: "updated", sequence: 1 },
    });
    expect(listener).toHaveBeenCalledTimes(2);

    // Send a subscribed message immediately after
    socket?.emit("message", {
      type: "subscribed",
      scopes: ["overview"],
      lastSequence: 1,
    });
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
  });

  it("debounces disconnection when subscriptions drop to 0", async () => {
    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const listener = vi.fn();
    const unsubscribe = subscribeToDashboardRealtime(["overview"], listener);

    expect(MockWebSocket.instances.length).toBe(1);
    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emit("open");

    // Unsubscribe so subscriptions count drops to 0
    unsubscribe();

    // The websocket should NOT close immediately
    expect(firstSocket.readyState).toBe(MockWebSocket.OPEN);

    // Subscribe again within the 250ms debounce time
    vi.advanceTimersByTime(100);
    const unsubscribe2 = subscribeToDashboardRealtime(["overview"], listener);

    // No new socket instance should be created and the old socket should remain open
    expect(MockWebSocket.instances.length).toBe(1);
    expect(firstSocket.readyState).toBe(MockWebSocket.OPEN);

    // Now unsubscribe again and let the full debounce time pass
    unsubscribe2();
    expect(firstSocket.readyState).toBe(MockWebSocket.OPEN);

    vi.advanceTimersByTime(250);

    // The websocket should now be closed
    expect(firstSocket.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("clears timers when the last subscription is removed", async () => {
    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const unsubscribe1 = subscribeToDashboardRealtime(["overview"], () => {});
    const unsubscribe2 = subscribeToDashboardRealtime(["project:1"], () => {});

    const socket = MockWebSocket.instances[0]!;
    socket.emit("open");

    expect(MockWebSocket.instances.length).toBe(1);

    unsubscribe1();

    // Removing one subscription shouldn't close the socket
    vi.advanceTimersByTime(250);
    expect(socket.readyState).toBe(MockWebSocket.OPEN);

    // clear the spy so we can track the final disconnect
    clearTimeoutSpy.mockClear();

    // Remove the last subscription
    unsubscribe2();

    // The subscription sync should have been scheduled, we can clear it now to ensure
    // we test the timer clear in disconnect. Since we advanced 250ms above, any previous
    // sync timer has already fired. Unsubscribing schedules another one.

    // We advance exactly enough for disconnect check to run, which calls disconnect()
    vi.advanceTimersByTime(250);

    expect(socket.readyState).toBe(MockWebSocket.CLOSED);

    // Ensure all timers are properly cleared
    expect(vi.getTimerCount()).toBe(0);

    clearTimeoutSpy.mockRestore();
  });

  it("ignores messages from stale sockets", async () => {
    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const listener = vi.fn();
    const unsubscribe = subscribeToDashboardRealtime(["overview"], listener);

    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emit("open");

    // Close unexpectedly to force a reconnect
    firstSocket.emit("close");
    vi.advanceTimersByTime(250);

    const secondSocket = MockWebSocket.instances[1]!;
    secondSocket.emit("open");

    // Now emit from the first (stale) socket
    firstSocket.emit("message", {
      type: "event",
      event: { scope: "overview", type: "updated", sequence: 2 },
    });

    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("handles malformed JSON gracefully", async () => {
    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const listener = vi.fn();
    const unsubscribe = subscribeToDashboardRealtime(["overview"], listener);

    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emit("open");

    // To test malformed JSON gracefully, we need to bypass `JSON.stringify` logic
    // in our `emit("message", ...)` utility, so we'll just invoke the raw listener.
    const messageListeners = (firstSocket as any).listeners.get("message") || [];

    expect(() => {
      for (const msgListener of messageListeners) {
        msgListener({ data: "{ malformed_json..." });
      }
    }).not.toThrow();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("reconnects when the window online event fires", async () => {
    let onlineListener: () => void = () => {};
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:4444" },
      setTimeout, clearTimeout,
      addEventListener: (type: string, listener: any) => { if (type === "online") onlineListener = listener; },
      removeEventListener: vi.fn(),
    });

    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const transportSpy = vi.fn();
    const unsubscribe = subscribeToDashboardRealtime(["overview"], () => {}, transportSpy);

    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emit("open");
    expect(transportSpy).toHaveBeenCalledWith("connected");

    // Close to go into reconnecting state
    firstSocket.emit("close");
    expect(transportSpy).toHaveBeenCalledWith("reconnecting");

    // Simulate window "online" event
    onlineListener();

    // The reconnection should be triggered immediately, creating a new socket
    expect(MockWebSocket.instances.length).toBe(2);

    unsubscribe();
  });

  it("updates lastSequence when a subscribed message arrives", async () => {
    const { subscribeToDashboardRealtime } = await import("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
    const unsubscribe = subscribeToDashboardRealtime(["overview"], () => {});

    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emit("open");
    vi.advanceTimersByTime(25);

    // Check initial subscription sync message
    let sent = JSON.parse(firstSocket.sentMessages[0] || "{}");
    expect(sent.lastSequence).toBe(null);

    // Simulate backend acknowledging subscription and providing a watermark
    firstSocket.emit("message", {
      type: "subscribed",
      scopes: ["overview"],
      lastSequence: 100,
    });

    // Close the socket to force a reconnect
    firstSocket.emit("close");
    vi.advanceTimersByTime(250);

    const secondSocket = MockWebSocket.instances[1]!;
    secondSocket.emit("open");
    vi.advanceTimersByTime(25);

    // Ensure the new connection uses the updated sequence 100
    sent = JSON.parse(secondSocket.sentMessages[0] || "{}");
    expect(sent.lastSequence).toBe(100);

    unsubscribe();
  });
});
