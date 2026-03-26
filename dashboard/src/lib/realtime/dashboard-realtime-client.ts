import type { DashboardRealtimeEvent, DashboardRealtimeServerMessage } from "../../types.js";

type RealtimeListener = (message: DashboardRealtimeServerMessage) => void;

interface RealtimeSubscription {
  scopes: string[];
  listener: RealtimeListener;
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
  private snapshotRequiredLastDispatchedAt: number = 0;
  private readonly SNAPSHOT_REQUIRED_COOLDOWN_MS = 3000;

  subscribe(scopes: string[], listener: RealtimeListener): () => void {
    const subscriptionId = this.nextSubscriptionId++;
    this.subscriptions.set(subscriptionId, {
      scopes: [...new Set(scopes.map((scope) => String(scope || "").trim()).filter(Boolean))],
      listener,
    });
    this.ensureConnected();
    this.syncSubscriptions();

    return () => {
      this.subscriptions.delete(subscriptionId);
      this.syncSubscriptions();
      if (this.subscriptions.size === 0) {
        this.disconnect();
      }
    };
  }

  private ensureConnected(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.clearReconnectTimer();
    const socket = new WebSocket(buildRealtimeUrl());
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.syncSubscriptions();
    });

    socket.addEventListener("message", (event) => {
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
      if (this.socket === socket) {
        this.socket = null;
      }
      if (this.subscriptions.size > 0) {
        this.scheduleReconnect();
      }
    });

    socket.addEventListener("error", () => {
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

    for (const subscription of this.subscriptions.values()) {
      if (message.type === "event") {
        if (!subscription.scopes.includes(message.event.scope)) {
          continue;
        }
      }
      subscription.listener(message);
    }
  }

  private syncSubscriptions(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const scopes = [...new Set(
      [...this.subscriptions.values()].flatMap((subscription) => subscription.scopes),
    )];

    this.socket.send(JSON.stringify({
      type: "set_subscriptions",
      scopes,
      lastSequence: this.lastSequence,
    }));
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
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
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
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

export function subscribeToDashboardRealtime(scopes: string[], listener: RealtimeListener): () => void {
  return getClient().subscribe(scopes, listener);
}
