import {
  DISCORD_GATEWAY_URL,
  normalizeDiscordGatewayEvent,
  type DiscordInboundEvent,
} from "../../domain/chat-connectors/providers/discord.js";

export interface DiscordGatewaySessionState {
  sessionId: string;
  resumeGatewayUrl: string;
  sequence: number;
  botUserId?: string;
}

/** Shared persistence boundary; implementations may use SQLite, memory, or another durable store. */
export interface DiscordGatewaySessionStore {
  load(connectionId: string): Promise<DiscordGatewaySessionState | null>;
  save(connectionId: string, state: DiscordGatewaySessionState): Promise<void>;
  clear(connectionId: string): Promise<void>;
}

export interface DiscordGatewayConnection {
  send(payload: string): void | Promise<void>;
  close(code?: number, reason?: string): void | Promise<void>;
}

export interface DiscordGatewayTransportHandlers {
  onMessage(payload: string): void | Promise<void>;
  onClose(code?: number, reason?: string): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
}

export interface DiscordGatewayTransport {
  connect(
    url: string,
    handlers: DiscordGatewayTransportHandlers,
    signal: AbortSignal,
  ): Promise<DiscordGatewayConnection>;
}

export type DiscordGatewayFailureCode =
  | "invalid_auth"
  | "invalid_intents"
  | "missing_privileged_intent"
  | "invalid_shard"
  | "sharding_required"
  | "invalid_api_version"
  | "reconnect_exhausted"
  | "transport_failure"
  | "malformed_gateway_payload";

export class DiscordGatewaySessionError extends Error {
  constructor(readonly code: DiscordGatewayFailureCode, message: string, readonly retryable: boolean) {
    super(message);
    this.name = "DiscordGatewaySessionError";
  }
}

export interface DiscordGatewaySessionOptions {
  connectionId: string;
  botToken: string;
  intents: number;
  sessionStore: DiscordGatewaySessionStore;
  transport: DiscordGatewayTransport;
  onMessage(event: Extract<DiscordInboundEvent, { kind: "message" }>): void | Promise<void>;
  onFailure?(error: DiscordGatewaySessionError): void | Promise<void>;
  random?: () => number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxReconnectAttempts?: number;
  gatewayUrl?: string;
}

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

interface ReconnectDecision {
  reconnect: boolean;
  resumable: boolean;
  error?: DiscordGatewaySessionError;
}

const NON_RESUMABLE_CLOSE_CODES = new Set([4001, 4002, 4003, 4005, 4007, 4009]);

export class DiscordGatewaySession {
  private readonly controller = new AbortController();
  private readonly random: () => number;
  private readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly gatewayUrl: string;
  private state: DiscordGatewaySessionState | null = null;
  private currentConnection: DiscordGatewayConnection | null = null;
  private heartbeatTimer: unknown | null = null;
  private heartbeatIntervalMs = 0;
  private heartbeatAcknowledged = true;
  private runPromise: Promise<void> | null = null;
  private reconnectAttempt = 0;

  constructor(private readonly options: DiscordGatewaySessionOptions) {
    if (!options.connectionId.trim()) throw new Error("Discord connection ID is required.");
    if (!options.botToken.trim()) throw new Error("Discord bot token is required.");
    if (!Number.isSafeInteger(options.intents) || options.intents < 0) throw new Error("Discord intents must be a non-negative integer.");
    this.random = options.random ?? Math.random;
    this.wait = options.wait ?? abortableWait;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref?.();
      return timer;
    });
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));
    this.initialBackoffMs = options.initialBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 8;
    this.gatewayUrl = normalizeGatewayUrl(options.gatewayUrl) ?? DISCORD_GATEWAY_URL;
  }

  start(signal?: AbortSignal): Promise<void> {
    if (this.runPromise) return this.runPromise;
    if (signal?.aborted) this.controller.abort(signal.reason);
    else signal?.addEventListener("abort", () => this.controller.abort(signal.reason), { once: true });
    this.runPromise = this.runLoop().finally(() => {
      this.clearHeartbeat();
      this.currentConnection = null;
    });
    return this.runPromise;
  }

  async stop(): Promise<void> {
    if (!this.controller.signal.aborted) this.controller.abort(new Error("Discord Gateway session stopped."));
    this.clearHeartbeat();
    const connection = this.currentConnection;
    this.currentConnection = null;
    if (connection) await connection.close(1000, "Code UX shutdown");
    await this.runPromise;
    this.state = null;
    await this.options.sessionStore.clear(this.options.connectionId);
  }

  private async runLoop(): Promise<void> {
    this.state = sanitizeSessionState(await this.options.sessionStore.load(this.options.connectionId));
    let shouldResume = this.state !== null;
    while (!this.controller.signal.aborted) {
      const decision = await this.runConnection(shouldResume);
      if (this.controller.signal.aborted || !decision.reconnect) {
        if (decision.error) await this.reportFailure(decision.error);
        this.state = null;
        await this.options.sessionStore.clear(this.options.connectionId);
        return;
      }
      if (!decision.resumable) {
        this.state = null;
        await this.options.sessionStore.clear(this.options.connectionId);
      }
      shouldResume = decision.resumable && this.state !== null;
      if (decision.error && !decision.error.retryable) {
        await this.reportFailure(decision.error);
        throw decision.error;
      }
      if (this.reconnectAttempt >= this.maxReconnectAttempts) {
        const exhausted = new DiscordGatewaySessionError(
          "reconnect_exhausted",
          "Discord Gateway reconnect attempts were exhausted.",
          false,
        );
        await this.reportFailure(exhausted);
        throw exhausted;
      }
      const delayMs = Math.min(
        this.maxBackoffMs,
        this.initialBackoffMs * Math.pow(2, this.reconnectAttempt),
      );
      this.reconnectAttempt += 1;
      try {
        await this.wait(delayMs, this.controller.signal);
      } catch {
        if (this.controller.signal.aborted) return;
        throw new DiscordGatewaySessionError("transport_failure", "Discord Gateway reconnect delay failed.", false);
      }
    }
  }

  private async runConnection(shouldResume: boolean): Promise<ReconnectDecision> {
    let settle!: (decision: ReconnectDecision) => void;
    let settled = false;
    const completed = new Promise<ReconnectDecision>((resolve) => {
      settle = (decision) => {
        if (settled) return;
        settled = true;
        resolve(decision);
      };
    });
    const requestReconnect = async (decision: ReconnectDecision, closeCode = 4000, reason = "Reconnect"): Promise<void> => {
      settle(decision);
      const connection = this.currentConnection;
      if (connection) await connection.close(closeCode, reason);
    };
    const abort = (): void => {
      settle({ reconnect: false, resumable: false });
      void this.currentConnection?.close(1000, "Code UX cancellation");
    };
    this.controller.signal.addEventListener("abort", abort, { once: true });

    try {
      const resumeUrl = shouldResume ? normalizeGatewayUrl(this.state?.resumeGatewayUrl) : null;
      const url = resumeUrl ?? this.gatewayUrl;
      const connection = await this.options.transport.connect(url, {
        onMessage: async (raw) => {
          try {
            const payload = parseGatewayPayload(raw);
            await this.handleGatewayPayload(payload, shouldResume, requestReconnect);
          } catch (error) {
            const normalized = error instanceof DiscordGatewaySessionError
              ? error
              : new DiscordGatewaySessionError("malformed_gateway_payload", "Discord sent a malformed Gateway payload.", true);
            await requestReconnect({ reconnect: true, resumable: this.state !== null, error: normalized }, 4002, "Malformed payload");
          }
        },
        onClose: (code) => settle(closeDecision(code, this.state !== null)),
        onError: () => requestReconnect({
          reconnect: true,
          resumable: this.state !== null,
          error: new DiscordGatewaySessionError("transport_failure", "Discord Gateway transport failed.", true),
        }, 4000, "Transport failure"),
      }, this.controller.signal);
      if (this.controller.signal.aborted) {
        await connection.close(1000, "Code UX shutdown");
        return { reconnect: false, resumable: false };
      }
      this.currentConnection = connection;
      return await completed;
    } catch (error) {
      if (this.controller.signal.aborted) return { reconnect: false, resumable: false };
      return {
        reconnect: true,
        resumable: this.state !== null,
        error: error instanceof DiscordGatewaySessionError
          ? error
          : new DiscordGatewaySessionError("transport_failure", "Discord Gateway connection failed.", true),
      };
    } finally {
      this.controller.signal.removeEventListener("abort", abort);
      this.clearHeartbeat();
      this.currentConnection = null;
    }
  }

  private async handleGatewayPayload(
    payload: GatewayPayload,
    shouldResume: boolean,
    requestReconnect: (decision: ReconnectDecision, code?: number, reason?: string) => Promise<void>,
  ): Promise<void> {
    if (typeof payload.s === "number") {
      if (this.state) {
        this.state = { ...this.state, sequence: payload.s };
        await this.persistState();
      }
    }
    switch (payload.op) {
      case 0:
        await this.handleDispatch(payload);
        return;
      case 1:
        await this.sendHeartbeat();
        return;
      case 7:
        await requestReconnect({ reconnect: true, resumable: this.state !== null });
        return;
      case 9: {
        const resumable = payload.d === true && this.state !== null;
        await requestReconnect({ reconnect: true, resumable }, 4000, "Invalid session");
        return;
      }
      case 10:
        await this.handleHello(payload, shouldResume, requestReconnect);
        return;
      case 11:
        this.heartbeatAcknowledged = true;
        return;
      default:
        return;
    }
  }

  private async handleHello(
    payload: GatewayPayload,
    shouldResume: boolean,
    requestReconnect: (decision: ReconnectDecision, code?: number, reason?: string) => Promise<void>,
  ): Promise<void> {
    const data = asRecord(payload.d);
    const interval = Number(data?.heartbeat_interval);
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new DiscordGatewaySessionError("malformed_gateway_payload", "Discord Hello omitted a heartbeat interval.", true);
    }
    this.heartbeatIntervalMs = interval;
    this.heartbeatAcknowledged = true;
    this.scheduleHeartbeat(Math.floor(interval * clampJitter(this.random())) , requestReconnect);
    if (shouldResume && this.state) {
      await this.send({
        op: 6,
        d: { token: this.options.botToken, session_id: this.state.sessionId, seq: this.state.sequence },
      });
      return;
    }
    await this.send({
      op: 2,
      d: {
        token: this.options.botToken,
        intents: this.options.intents,
        properties: { os: process.platform, browser: "codeux", device: "codeux" },
      },
    });
  }

  private async handleDispatch(payload: GatewayPayload): Promise<void> {
    const sequence = typeof payload.s === "number" ? payload.s : this.state?.sequence;
    if (payload.t === "READY") {
      const data = asRecord(payload.d);
      const sessionId = readNonEmptyString(data?.session_id);
      const resumeGatewayUrl = normalizeGatewayUrl(readNonEmptyString(data?.resume_gateway_url));
      const user = asRecord(data?.user);
      const botUserId = readNonEmptyString(user?.id);
      if (!sessionId || !resumeGatewayUrl || sequence === undefined) {
        throw new DiscordGatewaySessionError("malformed_gateway_payload", "Discord Ready omitted resumable session state.", true);
      }
      this.state = {
        sessionId,
        resumeGatewayUrl,
        sequence,
        ...(botUserId ? { botUserId } : {}),
      };
      this.reconnectAttempt = 0;
      await this.persistState();
      return;
    }
    if (payload.t === "RESUMED") {
      this.reconnectAttempt = 0;
      await this.persistState();
      return;
    }
    if (payload.t === "MESSAGE_CREATE") {
      const event = normalizeDiscordGatewayEvent(
        { op: payload.op, d: payload.d, s: payload.s, t: payload.t },
        this.state?.botUserId,
      );
      if (event.kind === "message") await this.options.onMessage(event);
    }
  }

  private scheduleHeartbeat(
    delayMs: number,
    requestReconnect: (decision: ReconnectDecision, code?: number, reason?: string) => Promise<void>,
  ): void {
    this.clearHeartbeat();
    this.heartbeatTimer = this.setTimer(() => {
      this.heartbeatTimer = null;
      if (!this.heartbeatAcknowledged) {
        void requestReconnect({ reconnect: true, resumable: this.state !== null }, 4000, "Missed heartbeat ACK");
        return;
      }
      void this.sendHeartbeat().then(() => {
        this.scheduleHeartbeat(this.heartbeatIntervalMs, requestReconnect);
      }).catch(() => {
        void requestReconnect({ reconnect: true, resumable: this.state !== null }, 4000, "Heartbeat failed");
      });
    }, Math.max(0, delayMs));
  }

  private async sendHeartbeat(): Promise<void> {
    await this.send({ op: 1, d: this.state?.sequence ?? null });
    this.heartbeatAcknowledged = false;
  }

  private async send(payload: Record<string, unknown>): Promise<void> {
    const connection = this.currentConnection;
    if (!connection) throw new DiscordGatewaySessionError("transport_failure", "Discord Gateway connection is unavailable.", true);
    await connection.send(JSON.stringify(payload));
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) this.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async persistState(): Promise<void> {
    if (this.state) await this.options.sessionStore.save(this.options.connectionId, { ...this.state });
  }

  private async reportFailure(error: DiscordGatewaySessionError): Promise<void> {
    await this.options.onFailure?.(error);
  }
}

function parseGatewayPayload(raw: string): GatewayPayload {
  const value = JSON.parse(raw) as unknown;
  const record = asRecord(value);
  if (!record || !Number.isInteger(record.op)) throw new Error("Malformed payload");
  return {
    op: Number(record.op),
    d: record.d,
    s: typeof record.s === "number" ? record.s : null,
    t: typeof record.t === "string" ? record.t : null,
  };
}

function closeDecision(code: number | undefined, hasState: boolean): ReconnectDecision {
  if (code === 1000 || code === 1001) return { reconnect: false, resumable: false };
  if (code === 4004) return fatalClose("invalid_auth", "Discord rejected Gateway authentication.");
  if (code === 4013) return fatalClose("invalid_intents", "Discord rejected the Gateway intents bitfield.");
  if (code === 4014) return fatalClose("missing_privileged_intent", "Discord MESSAGE_CONTENT intent is not enabled or approved.");
  if (code === 4010) return fatalClose("invalid_shard", "Discord rejected the Gateway shard configuration.");
  if (code === 4011) return fatalClose("sharding_required", "Discord requires Gateway sharding for this bot.");
  if (code === 4012) return fatalClose("invalid_api_version", "Discord rejected Gateway API version 10.");
  return { reconnect: true, resumable: hasState && !NON_RESUMABLE_CLOSE_CODES.has(code ?? -1) };
}

function fatalClose(code: DiscordGatewayFailureCode, message: string): ReconnectDecision {
  return { reconnect: true, resumable: false, error: new DiscordGatewaySessionError(code, message, false) };
}

function sanitizeSessionState(value: DiscordGatewaySessionState | null): DiscordGatewaySessionState | null {
  if (!value) return null;
  const resumeGatewayUrl = normalizeGatewayUrl(value.resumeGatewayUrl);
  if (!readNonEmptyString(value.sessionId) || !resumeGatewayUrl || !Number.isSafeInteger(value.sequence) || value.sequence < 0) return null;
  return {
    sessionId: value.sessionId,
    resumeGatewayUrl,
    sequence: value.sequence,
    ...(readNonEmptyString(value.botUserId) ? { botUserId: value.botUserId } : {}),
  };
}

function normalizeGatewayUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "wss:" || url.username || url.password) return null;
    if (url.hostname !== "gateway.discord.gg" && !url.hostname.endsWith(".discord.gg")) return null;
    url.searchParams.set("v", "10");
    url.searchParams.set("encoding", "json");
    return url.toString();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampJitter(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function abortableWait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    timer.unref?.();
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
