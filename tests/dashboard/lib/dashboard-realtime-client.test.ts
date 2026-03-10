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
    const unsubscribe = subscribeToDashboardRealtime(["overview"], () => {});

    const firstSocket = MockWebSocket.instances[0];
    expect(firstSocket?.url).toBe("ws://localhost:4444/api/realtime");

    firstSocket.emit("open");
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
});
