import type {
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderSessionStateRecord,
} from "../contracts/chat-provider-types.js";
import {
  CHAT_CONNECTOR_REGISTRY,
  type ChatConnectorRegistry,
} from "../domain/chat-connectors/registry.js";
import type { ChatConnectorProfile } from "../domain/chat-connectors/types.js";
import type { ChatProviderRepository } from "../repositories/chat-provider-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { generateCorrelationId, getCorrelationId } from "../shared/logging/correlation-id.js";
import { redactText } from "../shared/security/redaction.js";
import type { ChatProviderSecretService } from "./chat-provider-secret-service.js";

export type ChatProviderSessionRuntimeStatus =
  | "pending"
  | "connecting"
  | "connected"
  | "retry_wait"
  | "resumable"
  | "completed"
  | "failed"
  | "cancelled";

export interface ChatProviderSessionRunContext {
  connection: ChatProviderConnectionInternalRecord;
  binding: ChatProviderChannelBindingRecord | null;
  profile: ChatConnectorProfile;
  session: ChatProviderSessionStateRecord;
  signal: AbortSignal;
  correlationId: string;
  transition(status: "connected", providerState?: Record<string, unknown>): void;
}

export interface ChatProviderSessionRunResult {
  outcome: "completed" | "reconnect";
  providerState?: Record<string, unknown>;
  retryAfterMs?: number;
  errorCode?: string;
}

export interface ChatProviderSessionRuntimeDriver {
  supports(profile: ChatConnectorProfile, connection: ChatProviderConnectionInternalRecord): boolean;
  run(context: ChatProviderSessionRunContext): Promise<ChatProviderSessionRunResult>;
}

export interface EnsureChatProviderSessionInput {
  providerConnectionId: string;
  channelBindingId?: string | null;
  externalChannelId?: string;
  sessionKey?: string;
  providerState?: Record<string, unknown>;
}

interface ChatProviderSessionRuntimeServiceDependencies {
  chatProviderRepository: ChatProviderRepository;
  chatProviderSecretService?: ChatProviderSecretService;
  driver?: ChatProviderSessionRuntimeDriver;
  connectorRegistry?: ChatConnectorRegistry;
  logger?: Logger;
  initialReconnectMs?: number;
  maxReconnectMs?: number;
  maxReconnectAttempts?: number;
  jitterRatio?: number;
  random?: () => number;
}

const DEFAULT_INITIAL_RECONNECT_MS = 1_000;
const DEFAULT_MAX_RECONNECT_MS = 60_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8;
const DEFAULT_JITTER_RATIO = 0.2;
const MAX_RUNTIME_SESSIONS = 500;

export class ChatProviderSessionRuntimeService {
  private readonly registry: ChatConnectorRegistry;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly jobs = new Map<string, Promise<void>>();
  private started = false;
  private stopping = false;

  constructor(private readonly deps: ChatProviderSessionRuntimeServiceDependencies) {
    this.registry = deps.connectorRegistry ?? CHAT_CONNECTOR_REGISTRY;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.deps.chatProviderRepository.cleanupExpiredProviderSessions();
    if (!this.deps.driver) return;

    const sessions = this.deps.chatProviderRepository.listProviderSessions({ limit: MAX_RUNTIME_SESSIONS });
    for (const session of sessions) {
      if (isResumable(session)) this.schedule(session, retryDelayFromState(session.state));
    }

    const connections = this.deps.chatProviderRepository.listConnections({ enabledOnly: true });
    for (const publicConnection of connections) {
      const connection = await this.resolveConnection(publicConnection.id);
      if (!connection || connection.status !== "active") continue;
      const profile = this.registry.getForMode(connection.providerKind, connection.bridgeMode);
      if (!profile.session.required || !this.deps.driver.supports(profile, connection)) continue;
      if (profile.session.scope === "connection") {
        const session = this.ensureSession({ providerConnectionId: connection.id });
        this.schedule(session, 0);
      } else if (profile.session.scope === "channel") {
        const bindings = this.deps.chatProviderRepository.listChannelBindings({
          providerConnectionId: connection.id,
          enabledOnly: true,
        });
        for (const binding of bindings) {
          const session = this.ensureSession({
            providerConnectionId: connection.id,
            channelBindingId: binding.id,
            externalChannelId: binding.externalChannelId,
          });
          this.schedule(session, 0);
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.started && this.timers.size === 0 && this.jobs.size === 0) return;
    this.started = false;
    this.stopping = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const controller of this.controllers.values()) {
      controller.abort(new Error("Chat provider session runtime is stopping."));
    }
    await Promise.allSettled([...this.jobs.values()]);
  }

  ensureSession(input: EnsureChatProviderSessionInput): ChatProviderSessionStateRecord {
    const connection = this.deps.chatProviderRepository.getConnectionInternal(input.providerConnectionId);
    if (!connection) throw new Error(`Chat provider connection not found: ${input.providerConnectionId}`);
    const profile = this.registry.getForMode(connection.providerKind, connection.bridgeMode);
    const binding = input.channelBindingId
      ? this.deps.chatProviderRepository.getChannelBinding(input.channelBindingId)
      : null;
    const externalChannelId = input.externalChannelId?.trim()
      || binding?.externalChannelId
      || connection.id;
    const sessionKey = input.sessionKey?.trim()
      || buildSessionKey(profile, connection.id, binding, externalChannelId);
    const existing = this.deps.chatProviderRepository.getProviderSession(connection.id, sessionKey);
    if (existing) return existing;
    return this.deps.chatProviderRepository.createProviderSession({
      providerConnectionId: connection.id,
      channelBindingId: binding?.id ?? null,
      externalChannelId,
      sessionKey,
      state: {
        status: "pending",
        resumable: true,
        reconnectAttempt: 0,
        providerState: input.providerState ?? {},
      },
    });
  }

  async cancelSession(providerConnectionId: string, sessionKey: string): Promise<ChatProviderSessionStateRecord> {
    const session = this.deps.chatProviderRepository.getProviderSession(providerConnectionId, sessionKey);
    if (!session) throw new Error(`Chat provider session not found: ${sessionKey}`);
    const timer = this.timers.get(session.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(session.id);
    const cancelled = this.transition(session, "cancelled", {
      resumable: false,
      nextReconnectAt: null,
    });
    this.controllers.get(session.id)?.abort(new Error("Provider session cancelled manually."));
    return cancelled;
  }

  private schedule(session: ChatProviderSessionStateRecord, delayMs: number): void {
    if (!this.started || this.stopping || this.timers.has(session.id)) return;
    const timer = setTimeout(() => {
      this.timers.delete(session.id);
      if (!this.started || this.stopping) return;
      const job = this.run(session.id).finally(() => this.jobs.delete(session.id));
      this.jobs.set(session.id, job);
    }, Math.max(0, delayMs));
    timer.unref?.();
    this.timers.set(session.id, timer);
  }

  private async run(sessionId: string): Promise<void> {
    const persisted = this.deps.chatProviderRepository.listProviderSessions({ limit: MAX_RUNTIME_SESSIONS })
      .find((session) => session.id === sessionId);
    if (!persisted || !isResumable(persisted) || !this.deps.driver) return;
    const connection = await this.resolveConnection(persisted.providerConnectionId);
    if (!connection || !connection.enabled || connection.status !== "active") return;
    const profile = this.registry.getForMode(connection.providerKind, connection.bridgeMode);
    if (!this.deps.driver.supports(profile, connection)) return;
    const binding = persisted.channelBindingId
      ? this.deps.chatProviderRepository.getChannelBinding(persisted.channelBindingId)
      : null;
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    const correlationId = getCorrelationId() ?? generateCorrelationId();
    const attempt = readNonNegativeInteger(persisted.state.reconnectAttempt) + 1;
    let current = this.transition(persisted, "connecting", {
      reconnectAttempt: attempt,
      nextReconnectAt: null,
      resumable: true,
    });
    const startedAt = Date.now();

    try {
      const result = await this.deps.driver.run({
        connection,
        binding,
        profile,
        session: current,
        signal: controller.signal,
        correlationId,
        transition: (status, providerState) => {
          current = this.transition(current, status, {
            providerState: providerState ?? current.state.providerState ?? {},
          });
        },
      });
      if (result.outcome === "completed") {
        this.transition(current, "completed", {
          resumable: false,
          providerState: result.providerState ?? current.state.providerState ?? {},
          nextReconnectAt: null,
        });
        this.logTransition(current, "completed", attempt, Date.now() - startedAt, null, result.errorCode);
        return;
      }
      this.scheduleReconnect(current, attempt, result.retryAfterMs, result.providerState, result.errorCode, startedAt);
    } catch (error) {
      const latest = this.deps.chatProviderRepository.getProviderSession(current.providerConnectionId, current.sessionKey) ?? current;
      if (latest.state.status === "cancelled") return;
      if (controller.signal.aborted && this.stopping) {
        this.transition(latest, "resumable", { resumable: true, nextReconnectAt: null });
        this.logTransition(latest, "resumable", attempt, Date.now() - startedAt, null, "shutdown_abort");
        return;
      }
      this.scheduleReconnect(latest, attempt, undefined, undefined, errorCode(error), startedAt);
    } finally {
      this.controllers.delete(sessionId);
    }
  }

  private scheduleReconnect(
    session: ChatProviderSessionStateRecord,
    attempt: number,
    retryAfterMs: number | undefined,
    providerState: Record<string, unknown> | undefined,
    providerErrorCode: string | undefined,
    startedAt: number,
  ): void {
    const maxAttempts = this.deps.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    if (attempt >= maxAttempts) {
      this.transition(session, "failed", {
        resumable: false,
        nextReconnectAt: null,
        providerState: providerState ?? session.state.providerState ?? {},
        providerErrorCode: redactText(providerErrorCode ?? "session_failed"),
      });
      this.logTransition(session, "failed", attempt, Date.now() - startedAt, null, providerErrorCode);
      return;
    }
    const delay = Math.max(this.reconnectBackoff(attempt), retryAfterMs ?? 0);
    const retryAt = new Date(Date.now() + delay).toISOString();
    const waiting = this.transition(session, "retry_wait", {
      resumable: true,
      nextReconnectAt: retryAt,
      providerState: providerState ?? session.state.providerState ?? {},
      providerErrorCode: redactText(providerErrorCode ?? "session_disconnected"),
    });
    this.logTransition(waiting, "retry_wait", attempt, Date.now() - startedAt, retryAt, providerErrorCode);
    this.schedule(waiting, delay);
  }

  private transition(
    session: ChatProviderSessionStateRecord,
    status: ChatProviderSessionRuntimeStatus,
    patch: Record<string, unknown>,
  ): ChatProviderSessionStateRecord {
    return this.deps.chatProviderRepository.compareAndSetProviderSession(session.id, session.version, {
      ...session.state,
      ...patch,
      status,
      transitionedAt: new Date().toISOString(),
    });
  }

  private reconnectBackoff(attempt: number): number {
    const initial = this.deps.initialReconnectMs ?? DEFAULT_INITIAL_RECONNECT_MS;
    const max = this.deps.maxReconnectMs ?? DEFAULT_MAX_RECONNECT_MS;
    const base = Math.min(max, initial * Math.pow(2, Math.max(0, attempt - 1)));
    const ratio = this.deps.jitterRatio ?? DEFAULT_JITTER_RATIO;
    const random = this.deps.random ?? Math.random;
    return Math.max(0, Math.round(base + base * ratio * ((random() * 2) - 1)));
  }

  private async resolveConnection(connectionId: string): Promise<ChatProviderConnectionInternalRecord | null> {
    return this.deps.chatProviderSecretService
      ? this.deps.chatProviderSecretService.resolveConnection(connectionId).catch(() => null)
      : this.deps.chatProviderRepository.getConnectionInternal(connectionId);
  }

  private logTransition(
    session: ChatProviderSessionStateRecord,
    transition: ChatProviderSessionRuntimeStatus,
    attempt: number,
    latencyMs: number,
    retryAt: string | null,
    providerErrorCode?: string,
  ): void {
    const connection = this.deps.chatProviderRepository.getConnection(session.providerConnectionId);
    this.deps.logger?.info("Chat provider session transition", {
      logPurpose: "integration",
      correlationId: getCorrelationId(),
      providerKind: connection?.providerKind,
      providerConnectionId: session.providerConnectionId,
      channelBindingId: session.channelBindingId,
      sessionId: session.id,
      sessionTransition: transition,
      attempt,
      latencyMs: Math.max(0, latencyMs),
      retryAt,
      providerErrorCode: providerErrorCode ? redactText(providerErrorCode) : null,
    });
  }
}

function buildSessionKey(
  profile: ChatConnectorProfile,
  connectionId: string,
  binding: ChatProviderChannelBindingRecord | null,
  externalChannelId: string,
): string {
  switch (profile.session.scope) {
    case "connection": return `connection:${connectionId}`;
    case "channel": return `channel:${binding?.id ?? externalChannelId}`;
    case "conversation": return `conversation:${externalChannelId}`;
    case "none": return `connection:${connectionId}`;
  }
}

function isResumable(session: ChatProviderSessionStateRecord): boolean {
  const status = session.state.status;
  return status !== "completed"
    && status !== "failed"
    && status !== "cancelled"
    && session.state.resumable !== false;
}

function retryDelayFromState(state: Record<string, unknown>): number {
  const retryAt = typeof state.nextReconnectAt === "string" ? Date.parse(state.nextReconnectAt) : Number.NaN;
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0;
}

function readNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.name : "session_error";
}
