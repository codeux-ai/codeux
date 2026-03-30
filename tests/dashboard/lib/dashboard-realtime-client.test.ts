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
});
