import type { DashboardRealtimeEvent, DashboardRealtimeServerMessage } from "../../types.js";

export type TransportState = "connecting" | "connected" | "reconnecting" | "disconnected";

type RealtimeListener = (message: DashboardRealtimeServerMessage) => void;
type TransportStateListener = (state: TransportState) => void;

interface RealtimeSubscription {
  scopes: string[];
  listener: RealtimeListener;
  transportListener?: TransportStateListener;
}

function buildRealtimeUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/realtime`;
}

class DashboardRealtimeClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private lastSequence: number | null = null;
  private readonly subscriptions = new Map<number, RealtimeSubscription>();
  private nextSubscriptionId = 1;
  private subscriptionSyncTimer: number | null = null;
  private lastSentScopesKey = "";
  private snapshotRequiredLastDispatchedAt: number = 0;
  private readonly SNAPSHOT_REQUIRED_COOLDOWN_MS = 3000;
  private transportState: TransportState = "disconnected";
  private disconnectTimer: number | null = null;
  private onlineListener: (() => void) | null = null;

  constructor() {
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      this.onlineListener = () => {
        if (this.subscriptions.size > 0) {
          this.reconnectAttempt = 0;
          this.clearReconnectTimer();
          this.ensureConnected();
        }
      };
      window.addEventListener("online", this.onlineListener);
    }
  }

  dispose(): void {
    if (this.onlineListener && typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("online", this.onlineListener);
      this.onlineListener = null;
    }
    this.clearDisconnectTimer();
    this.clearReconnectTimer();
    if (this.subscriptionSyncTimer !== null) {
      globalThis.clearTimeout(this.subscriptionSyncTimer);
      this.subscriptionSyncTimer = null;
    }
    this.subscriptions.clear();
    this.lastSentScopesKey = "";
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }
    this.setTransportState("disconnected");
  }

  subscribe(scopes: string[], listener: RealtimeListener, transportListener?: TransportStateListener): () => void {
    const subscriptionId = this.nextSubscriptionId++;
    this.subscriptions.set(subscriptionId, {
      scopes: [...new Set(scopes.map((scope) => String(scope || "").trim()).filter(Boolean))],
      listener,
      transportListener,
    });
    if (transportListener) {
      transportListener(this.transportState);
    }
    this.ensureConnected();
    this.scheduleSubscriptionSync();

    return () => {
      this.subscriptions.delete(subscriptionId);
      if (this.subscriptions.size === 0) {
        if (this.subscriptionSyncTimer !== null) {
          globalThis.clearTimeout(this.subscriptionSyncTimer);
          this.subscriptionSyncTimer = null;
        }
        this.clearReconnectTimer();
        this.lastSentScopesKey = "";
        this.scheduleDisconnectCheck();
      } else {
        this.scheduleSubscriptionSync();
      }
    };
  }

  private ensureConnected(): void {
    this.clearDisconnectTimer();
    if (typeof window === "undefined") {
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.clearReconnectTimer();
    this.setTransportState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const socket = new WebSocket(buildRealtimeUrl());
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.setTransportState("connected");
      this.scheduleSubscriptionSync();
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      try {
        const payload = JSON.parse(String(event.data || "")) as DashboardRealtimeServerMessage;
        if (payload.type === "event") {
          this.handleEvent(payload.event);
        } else if (payload.type === "subscribed") {
          this.lastSequence = Math.max(this.lastSequence || 0, payload.lastSequence || 0);
        }
        this.dispatch(payload);
      } catch {
        // Ignore malformed payloads and rely on fallback polling.
      }
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.lastSentScopesKey = "";
      if (this.subscriptions.size === 0) {
        this.setTransportState("disconnected");
      }
      if (this.subscriptions.size > 0) {
        this.scheduleReconnect();
      }
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      socket.close();
    });
  }

  private handleEvent(event: DashboardRealtimeEvent): void {
    this.lastSequence = Math.max(this.lastSequence || 0, event.sequence);
  }

  private dispatch(message: DashboardRealtimeServerMessage): void {
    if (message.type === "snapshot_required") {
      const now = Date.now();
      if (now - this.snapshotRequiredLastDispatchedAt < this.SNAPSHOT_REQUIRED_COOLDOWN_MS) {
        return;
      }
      this.snapshotRequiredLastDispatchedAt = now;
    }

    const currentSubscriptions = Array.from(this.subscriptions.entries());
    for (const [id, subscription] of currentSubscriptions) {
      if (!this.subscriptions.has(id)) {
        continue;
      }
      if (message.type === "event") {
        if (!subscription.scopes.includes(message.event.scope)) {
          continue;
        }
      }
      subscription.listener(message);
    }
  }

  private scheduleSubscriptionSync(): void {
    if (this.subscriptionSyncTimer !== null) {
      globalThis.clearTimeout(this.subscriptionSyncTimer);
    }
    if (typeof window === "undefined") {
      this.subscriptionSyncTimer = null;
      return;
    }
    this.subscriptionSyncTimer = window.setTimeout(() => {
      this.subscriptionSyncTimer = null;
      this.syncSubscriptions();
    }, 25);
  }

  private syncSubscriptions(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const scopes = [...new Set(
      [...this.subscriptions.values()].flatMap((subscription) => subscription.scopes),
    )];
    const scopesKey = scopes.slice().sort().join("\u0000");
    if (scopesKey === this.lastSentScopesKey) {
      return;
    }
    this.lastSentScopesKey = scopesKey;

    this.socket.send(JSON.stringify({
      type: "set_subscriptions",
      scopes,
      lastSequence: this.lastSequence,
    }));
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.setTransportState("reconnecting");
    if (typeof window === "undefined") {
      return;
    }
    const delayMs = Math.min(5000, 250 * (2 ** this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.subscriptions.size > 0) {
        this.ensureConnected();
      }
    }, delayMs);
  }

  private disconnect(): void {
    this.clearDisconnectTimer();
    this.clearReconnectTimer();
    if (this.subscriptionSyncTimer !== null) {
      globalThis.clearTimeout(this.subscriptionSyncTimer);
      this.subscriptionSyncTimer = null;
    }
    this.lastSentScopesKey = "";
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }
    this.setTransportState("disconnected");
  }

  private scheduleDisconnectCheck(): void {
    this.clearDisconnectTimer();
    if (typeof window === "undefined") {
      this.disconnect();
      return;
    }
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = null;
      if (this.subscriptions.size === 0) {
        this.disconnect();
      }
    }, 250);
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer !== null) {
      if (typeof window !== "undefined") {
        window.clearTimeout(this.disconnectTimer);
      } else {
        globalThis.clearTimeout(this.disconnectTimer);
      }
      this.disconnectTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setTransportState(state: TransportState): void {
    if (this.transportState === state) {
      return;
    }
    this.transportState = state;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.transportListener) {
        subscription.transportListener(state);
      }
    }
  }
}

let sharedClient: DashboardRealtimeClient | null = null;

function getClient(): DashboardRealtimeClient {
  if (!sharedClient) {
    sharedClient = new DashboardRealtimeClient();
  }
  return sharedClient;
}

export function subscribeToDashboardRealtime(scopes: string[], listener: RealtimeListener, transportListener?: TransportStateListener): () => void {
  return getClient().subscribe(scopes, listener, transportListener);
}

export function resetSharedDashboardRealtimeClientForTest(): void {
  if (sharedClient) {
    sharedClient.dispose();
    sharedClient = null;
  }
}
