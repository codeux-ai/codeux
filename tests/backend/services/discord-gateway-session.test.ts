import { describe, expect, it, vi } from "vitest";
import {
  DiscordGatewaySession,
  DiscordGatewaySessionError,
  type DiscordGatewayConnection,
  type DiscordGatewaySessionState,
  type DiscordGatewaySessionStore,
  type DiscordGatewayTransport,
  type DiscordGatewayTransportHandlers,
} from "../../../src/services/chat-providers/discord-gateway-session.js";

describe("DiscordGatewaySession", () => {
  it("identifies, tracks sequence state, delivers messages, and suppresses its own bot loop", async () => {
    const harness = createHarness();
    const running = harness.session.start();
    await harness.connected(0);
    await harness.emit(0, { op: 10, d: { heartbeat_interval: 45_000 } });
    expect(harness.sent(0)).toContainEqual(expect.objectContaining({ op: 2, d: expect.objectContaining({ token: "bot-token", intents: 37_377 }) }));

    await harness.emit(0, ready(10));
    expect(harness.store.value).toEqual({
      sessionId: "session-1",
      resumeGatewayUrl: "wss://gateway.discord.gg/?v=10&encoding=json",
      sequence: 10,
      botUserId: "999999999999999999",
    });
    expect(JSON.stringify(harness.store.value)).not.toContain("bot-token");

    await harness.emit(0, message(11, "333333333333333333"));
    await harness.emit(0, message(12, "999999999999999999"));
    expect(harness.onMessage).toHaveBeenCalledTimes(1);
    expect(harness.onMessage).toHaveBeenCalledWith(expect.objectContaining({
      normalized: expect.objectContaining({
        externalMessageId: "111111111111111111",
        externalSenderId: "333333333333333333",
      }),
    }));
    expect(harness.store.value?.sequence).toBe(12);

    await harness.session.stop();
    await running;
    expect(harness.transport.connections[0]?.closed).toContainEqual([1000, "Code UX shutdown"]);
    expect(harness.store.value).toBeNull();
  });

  it("resumes a persisted session after a simulated disconnect", async () => {
    const harness = createHarness({
      sessionId: "stored-session",
      resumeGatewayUrl: "wss://gateway.discord.gg",
      sequence: 77,
      botUserId: "999999999999999999",
    });
    const running = harness.session.start();
    await harness.connected(0);
    expect(harness.transport.urls[0]).toBe("wss://gateway.discord.gg/?v=10&encoding=json");
    await harness.emit(0, { op: 10, d: { heartbeat_interval: 45_000 } });
    expect(harness.sent(0)).toContainEqual({
      op: 6,
      d: { token: "bot-token", session_id: "stored-session", seq: 77 },
    });
    await harness.close(0, 4000);
    await harness.connected(1);
    await harness.emit(1, { op: 10, d: { heartbeat_interval: 45_000 } });
    expect(harness.sent(1)).toContainEqual({
      op: 6,
      d: { token: "bot-token", session_id: "stored-session", seq: 77 },
    });
    expect(harness.wait).toHaveBeenCalledWith(100, expect.any(AbortSignal));

    await harness.session.stop();
    await running;
  });

  it("falls back to Identify when Discord invalidates resumable state", async () => {
    const harness = createHarness({
      sessionId: "stored-session",
      resumeGatewayUrl: "wss://gateway.discord.gg",
      sequence: 77,
    });
    const running = harness.session.start();
    await harness.connected(0);
    await harness.emit(0, { op: 10, d: { heartbeat_interval: 45_000 } });
    await harness.emit(0, { op: 9, d: false });
    await harness.connected(1);
    await harness.emit(1, { op: 10, d: { heartbeat_interval: 45_000 } });
    expect(harness.sent(1)).toContainEqual(expect.objectContaining({ op: 2 }));
    expect(harness.sent(1)).not.toContainEqual(expect.objectContaining({ op: 6 }));

    await harness.session.stop();
    await running;
  });

  it("uses heartbeat jitter, records ACKs, and reconnects after a missed ACK", async () => {
    const harness = createHarness(null, { random: () => 0.5 });
    const running = harness.session.start();
    await harness.connected(0);
    await harness.emit(0, { op: 10, d: { heartbeat_interval: 1_000 } });
    expect(harness.timers.delays).toEqual([500]);

    await harness.timers.fireNext();
    expect(harness.sent(0)).toContainEqual({ op: 1, d: null });
    expect(harness.timers.delays).toEqual([1_000]);
    await harness.timers.fireNext();
    await harness.connected(1);
    expect(harness.transport.connections[0]?.closed).toContainEqual([4000, "Missed heartbeat ACK"]);

    await harness.session.stop();
    await running;
  });

  it("continues heartbeats when ACKs arrive", async () => {
    const harness = createHarness(null, { random: () => 0 });
    const running = harness.session.start();
    await harness.connected(0);
    await harness.emit(0, { op: 10, d: { heartbeat_interval: 1_000 } });
    await harness.timers.fireNext();
    await harness.emit(0, { op: 11 });
    await harness.timers.fireNext();
    expect(harness.sent(0).filter((payload) => payload.op === 1)).toHaveLength(2);
    expect(harness.transport.connections).toHaveLength(1);

    await harness.session.stop();
    await running;
  });

  it("classifies privileged intent failures without token disclosure", async () => {
    const harness = createHarness();
    const running = harness.session.start();
    const rejection = expect(running).rejects.toMatchObject({ code: "missing_privileged_intent", retryable: false });
    await harness.connected(0);
    await harness.close(0, 4014);
    await rejection;
    expect(harness.onFailure).toHaveBeenCalledWith(expect.objectContaining({ code: "missing_privileged_intent" }));
    expect(JSON.stringify(harness.onFailure.mock.calls)).not.toContain("bot-token");
  });

  it("bounds exponential reconnect backoff", async () => {
    const harness = createHarness(null, { maxReconnectAttempts: 3 });
    const running = harness.session.start();
    const rejection = expect(running).rejects.toMatchObject({ code: "reconnect_exhausted" });
    await harness.connected(0);
    await harness.close(0, 4000);
    await harness.connected(1);
    await harness.close(1, 4000);
    await harness.connected(2);
    await harness.close(2, 4000);
    await harness.connected(3);
    await harness.close(3, 4000);
    await rejection;
    expect(harness.wait.mock.calls.map(([delay]) => delay)).toEqual([100, 200, 250]);
  });

  it("stops reconnecting after cancellation or clean shutdown", async () => {
    const controller = new AbortController();
    const harness = createHarness();
    const running = harness.session.start(controller.signal);
    await harness.connected(0);
    controller.abort();
    await running;
    await flush();
    expect(harness.transport.connections).toHaveLength(1);

    const clean = createHarness();
    const cleanRunning = clean.session.start();
    await clean.connected(0);
    await clean.session.stop();
    await cleanRunning;
    expect(clean.transport.connections).toHaveLength(1);
  });

  it("rejects untrusted persisted resume origins", async () => {
    const harness = createHarness({
      sessionId: "stored-session",
      resumeGatewayUrl: "wss://attacker.example.test/gateway",
      sequence: 77,
    });
    const running = harness.session.start();
    await harness.connected(0);
    expect(harness.transport.urls[0]).toBe("wss://gateway.discord.gg/?v=10&encoding=json");
    await harness.emit(0, { op: 10, d: { heartbeat_interval: 45_000 } });
    expect(harness.sent(0)).toContainEqual(expect.objectContaining({ op: 2 }));
    await harness.session.stop();
    await running;
  });
});

interface FakeConnection extends DiscordGatewayConnection {
  sent: string[];
  closed: Array<[number | undefined, string | undefined]>;
}

class FakeTransport implements DiscordGatewayTransport {
  readonly connections: FakeConnection[] = [];
  readonly handlers: DiscordGatewayTransportHandlers[] = [];
  readonly urls: string[] = [];

  async connect(url: string, handlers: DiscordGatewayTransportHandlers): Promise<DiscordGatewayConnection> {
    this.urls.push(url);
    this.handlers.push(handlers);
    const connection: FakeConnection = {
      sent: [],
      closed: [],
      send: (payload) => { connection.sent.push(payload); },
      close: (code, reason) => { connection.closed.push([code, reason]); },
    };
    this.connections.push(connection);
    return connection;
  }
}

class MemoryStore implements DiscordGatewaySessionStore {
  value: DiscordGatewaySessionState | null;
  constructor(initial: DiscordGatewaySessionState | null) { this.value = initial; }
  async load(): Promise<DiscordGatewaySessionState | null> { return this.value ? { ...this.value } : null; }
  async save(_connectionId: string, value: DiscordGatewaySessionState): Promise<void> { this.value = { ...value }; }
  async clear(): Promise<void> { this.value = null; }
}

function createTimers() {
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  return {
    callbacks,
    delays,
    setTimer(callback: () => void, delay: number) {
      callbacks.push(callback);
      delays.push(delay);
      return callback;
    },
    clearTimer(timer: unknown) {
      const index = callbacks.indexOf(timer as () => void);
      if (index >= 0) callbacks.splice(index, 1);
    },
    async fireNext() {
      const callback = callbacks.shift();
      delays.shift();
      if (!callback) throw new Error("No scheduled timer");
      callback();
      await flush();
    },
  };
}

function createHarness(
  initial: DiscordGatewaySessionState | null = null,
  overrides: Partial<ConstructorParameters<typeof DiscordGatewaySession>[0]> = {},
) {
  const transport = new FakeTransport();
  const store = new MemoryStore(initial);
  const timers = createTimers();
  const onMessage = vi.fn(async () => undefined);
  const onFailure = vi.fn(async () => undefined);
  const wait = vi.fn(async () => undefined);
  const session = new DiscordGatewaySession({
    connectionId: "connection-1",
    botToken: "bot-token",
    intents: 37_377,
    transport,
    sessionStore: store,
    onMessage,
    onFailure,
    wait,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    initialBackoffMs: 100,
    maxBackoffMs: 250,
    ...overrides,
  });
  return {
    session,
    transport,
    store,
    timers,
    onMessage,
    onFailure,
    wait,
    async connected(index: number) {
      await until(() => transport.connections.length > index);
    },
    async emit(index: number, payload: unknown) {
      await transport.handlers[index]?.onMessage(JSON.stringify(payload));
      await flush();
    },
    async close(index: number, code: number) {
      await transport.handlers[index]?.onClose(code);
      await flush();
    },
    sent(index: number): Array<Record<string, unknown>> {
      return (transport.connections[index]?.sent ?? []).map((payload) => JSON.parse(payload));
    },
  };
}

function ready(sequence: number) {
  return {
    op: 0,
    t: "READY",
    s: sequence,
    d: {
      session_id: "session-1",
      resume_gateway_url: "wss://gateway.discord.gg",
      user: { id: "999999999999999999" },
    },
  };
}

function message(sequence: number, authorId: string) {
  return {
    op: 0,
    t: "MESSAGE_CREATE",
    s: sequence,
    d: {
      id: "111111111111111111",
      channel_id: "222222222222222222",
      content: "Investigate the failure",
      author: { id: authorId, username: "alex" },
    },
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new DiscordGatewaySessionError("transport_failure", "Test transport did not connect.", false);
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
