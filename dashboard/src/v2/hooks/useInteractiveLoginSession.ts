import { useEffect, useRef, useState } from "preact/hooks";

export interface InteractiveLoginMessage {
  type: string;
  data?: string;
  code?: number;
  url?: string;
}

interface UseInteractiveLoginSessionArgs {
  providerConfigId: string;
  providerId: string;
  onSessionMessage: (message: InteractiveLoginMessage) => void;
  onSessionError: (message: string) => void;
}

interface UseInteractiveLoginSessionResult {
  status: "connecting" | "active" | "exited" | "error";
  sessionId: string | null;
  websocket: WebSocket | null;
  closeSession: () => void;
}

const HEARTBEAT_INTERVAL_MS = 5000;

export function useInteractiveLoginSession(args: UseInteractiveLoginSessionArgs): UseInteractiveLoginSessionResult {
  const [status, setStatus] = useState<"connecting" | "active" | "exited" | "error">("connecting");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const closedRef = useRef(false);

  const finalizeWithBeacon = (activeSessionId: string): void => {
    const payload = JSON.stringify({ sessionId: activeSessionId });
    try {
      if (typeof navigator.sendBeacon === "function") {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/terminal/finalize", blob);
        return;
      }
    } catch {
      // Ignore and use fallback request below.
    }
    void fetch("/api/terminal/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  };

  const closeSession = (): void => {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;

    const activeSessionId = sessionIdRef.current;
    wsRef.current?.close();

    if (activeSessionId) {
      finalizeWithBeacon(activeSessionId);
      void fetch("/api/terminal/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId }),
      }).catch(() => undefined);
    }
  };

  useEffect(() => {
    closedRef.current = false;

    const startSession = async (): Promise<void> => {
      try {
        const response = await fetch("/api/terminal/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerConfigId: args.providerConfigId, providerId: args.providerId }),
        });

        if (!response.ok) {
          const errData = await response.json() as { error?: string };
          throw new Error(errData.error || "Failed to start terminal session.");
        }

        const data = await response.json() as { sessionId: string };
        sessionIdRef.current = data.sessionId;
        setSessionId(data.sessionId);

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/api/terminal/ws?sessionId=${data.sessionId}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setStatus("active");
        };

        ws.onmessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string) as InteractiveLoginMessage;
            args.onSessionMessage(msg);
          } catch {
            if (typeof event.data === "string") {
              args.onSessionMessage({ type: "output", data: event.data });
            }
          }
        };

        ws.onerror = () => {
          setStatus("error");
          args.onSessionError("WebSocket connection encountered an error.");
        };

        ws.onclose = () => {
          setStatus((currentStatus) => {
            if (currentStatus === "active") {
              return "exited";
            }
            return currentStatus;
          });
        };
      } catch (err) {
        setStatus("error");
        args.onSessionError(err instanceof Error ? err.message : String(err));
      }
    };

    void startSession();

    const heartbeatInterval = window.setInterval(() => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId || closedRef.current) {
        return;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: "heartbeat" }));
        } catch {
          // Ignore intermittent socket failures; HTTP fallback still updates heartbeat.
        }
      }
      void fetch("/api/terminal/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId }),
      }).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);

    const handlePageHide = (): void => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId || closedRef.current) {
        return;
      }
      finalizeWithBeacon(activeSessionId);
    };

    window.addEventListener("beforeunload", handlePageHide);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.clearInterval(heartbeatInterval);
      window.removeEventListener("beforeunload", handlePageHide);
      window.removeEventListener("pagehide", handlePageHide);
      closeSession();
    };
  }, [args.providerConfigId, args.providerId]);

  return {
    status,
    sessionId,
    websocket: wsRef.current,
    closeSession,
  };
}
