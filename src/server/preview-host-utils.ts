import express from "express";
import { request as httpRequest } from "http";
import type { IncomingMessage } from "http";
import net from "net";
import type { Duplex } from "stream";
import path from "path";
import type { SprintPreviewSession } from "../contracts/app-types.js";

export const PREVIEW_BRIDGE_PATH = "/_sprint_os/preview-bridge.js";
export const PREVIEW_STATUS_PATH = "/_sprint_os/preview-status";
export const PREVIEW_START_PATH = "/_sprint_os/preview-start";
export const PREVIEW_REBUILD_PATH = "/_sprint_os/preview-rebuild";
export const PREVIEW_HOST_PREFIX = "preview-";

export function escapeHtml(value: string | null | undefined): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function parsePreviewSessionIdFromHost(hostHeader: string | undefined): string | null {
  const rawHost = String(hostHeader || "").trim().toLowerCase();
  if (!rawHost) {
    return null;
  }
  const hostWithoutPort = rawHost.split(":")[0] || "";
  if (!hostWithoutPort.startsWith(PREVIEW_HOST_PREFIX)) {
    return null;
  }
  const firstDotIndex = hostWithoutPort.indexOf(".");
  if (firstDotIndex === -1) {
    return null; // Must have a domain suffix
  }
  const firstSegment = hostWithoutPort.slice(0, firstDotIndex);
  if (firstSegment === PREVIEW_HOST_PREFIX) {
    return null;
  }
  const sessionId = firstSegment.slice(PREVIEW_HOST_PREFIX.length).trim();
  return sessionId || null;
}

export function buildDashboardOriginForPreviewHost(req: express.Request): string {
  const protocol = req.protocol || "http";
  const rawHost = String(req.headers.host || "").trim();
  const hostWithoutPort = rawHost.split(":")[0] || "localhost";
  const port = rawHost.includes(":") ? rawHost.slice(rawHost.lastIndexOf(":")) : "";

  if (hostWithoutPort.startsWith(PREVIEW_HOST_PREFIX)) {
    const firstDotIndex = hostWithoutPort.indexOf(".");
    if (firstDotIndex !== -1) {
      const dashboardHostWithoutPort = hostWithoutPort.slice(firstDotIndex + 1);
      const finalHost = dashboardHostWithoutPort === "localhost" ? `localhost${port}` : `${dashboardHostWithoutPort}${port}`;
      return `${protocol}://${finalHost}`;
    }
  }

  return `${protocol}://${rawHost}`;
}

export function shouldAttemptPreviewSpaFallback(req: express.Request): boolean {
  const accept = String(req.headers.accept || "").toLowerCase();
  return req.method === "GET"
    && req.path !== "/"
    && path.extname(req.path) === ""
    && !req.path.startsWith("/api/")
    && !req.path.startsWith(PREVIEW_BRIDGE_PATH)
    && accept.includes("text/html");
}

export function buildPreviewProxyRequestHeaders(
  req: express.Request,
  upstreamPort: number,
): Record<string, string | string[] | undefined> {
  const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
  delete headers["accept-encoding"];
  headers["x-forwarded-host"] = String(req.headers.host || "");
  headers.host = `127.0.0.1:${upstreamPort}`;
  headers["x-forwarded-proto"] = req.protocol || "http";
  if (req.socket.localPort) {
    headers["x-forwarded-port"] = String(req.socket.localPort);
  }
  return headers;
}

export async function requestBufferedPreviewResponse(args: {
  method: string;
  upstreamPort: number;
  targetPath: string;
  headers: Record<string, string | string[] | undefined>;
}): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return await new Promise((resolve, reject) => {
    const proxyRequest = httpRequest({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: args.upstreamPort,
      method: args.method,
      path: args.targetPath,
      headers: args.headers,
    }, (proxyResponse: IncomingMessage) => {
      const chunks: Buffer[] = [];
      proxyResponse.on("data", (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      proxyResponse.on("end", () => {
        resolve({
          statusCode: proxyResponse.statusCode || 502,
          headers: { ...proxyResponse.headers },
          body: Buffer.concat(chunks),
        });
      });
    });

    proxyRequest.on("error", reject);
    proxyRequest.end();
  });
}

export function sendBufferedPreviewResponse(args: {
  req: express.Request;
  res: express.Response;
  upstreamPort: number;
  response: { statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer };
}): void {
  const contentType = String(args.response.headers["content-type"] || "");
  const isHtml = contentType.toLowerCase().includes("text/html");
  const responseHeaders = { ...args.response.headers };

  if (typeof responseHeaders.location === "string") {
    responseHeaders.location = rewritePreviewLocationHeader(responseHeaders.location, args.req, args.upstreamPort);
  }

  if (!isHtml) {
    args.res.writeHead(args.response.statusCode, responseHeaders);
    args.res.end(args.response.body);
    return;
  }

  delete responseHeaders["content-length"];
  delete responseHeaders["content-security-policy"];
  delete responseHeaders["content-security-policy-report-only"];
  args.res.writeHead(args.response.statusCode, responseHeaders);
  args.res.end(injectPreviewBridgeIntoHtml(args.response.body.toString("utf8")));
}

export function buildPreviewBridgeScript(): string {
  return [
    "(() => {",
    "  const sendState = () => {",
    "    try {",
    "      window.parent?.postMessage({",
    "        type: 'sprint-preview:state',",
    "        href: window.location.href,",
    "        path: `${window.location.pathname}${window.location.search}${window.location.hash}`,",
    "        title: document.title || ''",
    "      }, '*');",
    "    } catch {}",
    "  };",
    "  const wrapHistory = (methodName) => {",
    "    const original = history[methodName];",
    "    if (typeof original !== 'function') return;",
    "    history[methodName] = function (...args) {",
    "      const result = original.apply(this, args);",
    "      queueMicrotask(sendState);",
    "      return result;",
    "    };",
    "  };",
    "  wrapHistory('pushState');",
    "  wrapHistory('replaceState');",
    "  window.addEventListener('popstate', sendState);",
    "  window.addEventListener('hashchange', sendState);",
    "  window.addEventListener('load', sendState);",
    "  document.addEventListener('DOMContentLoaded', sendState);",
    "  window.addEventListener('message', (event) => {",
    "    const message = event.data || {};",
    "    if (message.type !== 'sprint-preview:navigate') return;",
    "    const action = String(message.action || '');",
    "    if (action === 'back') { history.back(); return; }",
    "    if (action === 'forward') { history.forward(); return; }",
    "    if (action === 'reload') { window.location.reload(); return; }",
    "    if (action === 'push' || action === 'replace') {",
    "      const target = typeof message.path === 'string' && message.path.trim() ? message.path.trim() : '/';",
    "      try {",
    "        if (action === 'replace') history.replaceState(history.state, '', target);",
    "        else history.pushState(history.state, '', target);",
    "        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));",
    "        queueMicrotask(sendState);",
    "      } catch {",
    "        if (action === 'replace') window.location.replace(target);",
    "        else window.location.assign(target);",
    "      }",
    "    }",
    "  });",
    "})();",
  ].join("\n");
}

export function buildPreviewStandbyHtml(args: {
  req: express.Request;
  session: SprintPreviewSession;
  reason?: string | null;
}): string {
  const requestedPath = args.req.originalUrl || args.req.url || "/";
  const status = args.session.status;
  const title = status === "starting"
    ? "Container is starting"
    : status === "stopped"
      ? "Container is stopped"
      : "Container is unavailable";
  const description = status === "starting"
    ? "Sprint OS is building and booting this preview container. The browser will reconnect automatically once the preview responds."
    : status === "stopped"
      ? "This preview container is currently offline. Start it again or rebuild it to bring the in-app browser back."
      : "The preview host is not reachable right now. Rebuild or start the container to restore the browser.";
  const detail = args.reason?.trim() || args.session.lastError?.trim() || "";
  const pollOnLoad = status === "starting" || status === "running";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg-a: #f8f4ea;
      --bg-b: #eef4ff;
      --panel: rgba(255,255,255,0.84);
      --panel-dark: rgba(5,8,13,0.88);
      --border: rgba(15,23,42,0.10);
      --text: #0f172a;
      --muted: #475569;
      --accent: #25c27a;
      --accent-text: #032314;
      --button: #0f172a;
      --button-text: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-a: #071018;
        --bg-b: #111827;
        --panel: var(--panel-dark);
        --border: rgba(255,255,255,0.10);
        --text: #f8fafc;
        --muted: #cbd5e1;
        --button: #e2e8f0;
        --button-text: #0f172a;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(37,194,122,0.16), transparent 28%),
        radial-gradient(circle at bottom right, rgba(59,130,246,0.14), transparent 30%),
        linear-gradient(160deg, var(--bg-a), var(--bg-b));
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .panel {
      width: min(680px, 100%);
      border-radius: 28px;
      border: 1px solid var(--border);
      background: var(--panel);
      box-shadow: 0 24px 80px rgba(15,23,42,0.16);
      padding: 32px;
      backdrop-filter: blur(18px);
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(37,194,122,0.24);
      background: rgba(37,194,122,0.10);
      color: #15935b;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    h1 {
      margin: 18px 0 10px;
      font-size: clamp(28px, 4vw, 38px);
      line-height: 1.05;
    }
    p {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.7;
    }
    .meta {
      margin-top: 18px;
      padding: 16px 18px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: rgba(15,23,42,0.04);
      font-size: 13px;
      line-height: 1.7;
      color: var(--muted);
    }
    .meta code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--text);
      word-break: break-word;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 22px;
    }
    button, a {
      appearance: none;
      border: 0;
      border-radius: 16px;
      cursor: pointer;
      text-decoration: none;
      font: inherit;
      font-weight: 700;
      padding: 12px 18px;
      transition: transform 140ms ease, opacity 140ms ease, background 140ms ease;
    }
    button:hover, a:hover { transform: translateY(-1px); }
    button:disabled { cursor: default; opacity: 0.55; transform: none; }
    .primary { background: var(--accent); color: var(--accent-text); }
    .secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }
    .status {
      margin-top: 16px;
      min-height: 22px;
      font-size: 13px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <main class="panel">
    <div class="eyebrow">Preview Standby</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <div class="meta">
      <div><strong>Sprint:</strong> ${escapeHtml(args.session.sprintName)}</div>
      <div><strong>Container:</strong> ${escapeHtml(args.session.containerName || "Not assigned yet")}</div>
      <div><strong>Requested path:</strong> <code>${escapeHtml(requestedPath)}</code></div>
      ${detail ? `<div><strong>Details:</strong> ${escapeHtml(detail)}</div>` : ""}
    </div>
    <div class="actions">
      <button id="start" class="primary" type="button">Start Container</button>
      <button id="rebuild" class="secondary" type="button">Rebuild Container</button>
    </div>
    <div id="status" class="status"></div>
  </main>
  <script>
    (() => {
      const requestedPath = ${JSON.stringify(requestedPath)};
      const statusNode = document.getElementById("status");
      const startButton = document.getElementById("start");
      const rebuildButton = document.getElementById("rebuild");
      let pollTimer = null;

      const setBusy = (message, busy) => {
        if (statusNode) statusNode.textContent = message || "";
        if (startButton) startButton.disabled = Boolean(busy);
        if (rebuildButton) rebuildButton.disabled = Boolean(busy);
      };

	      const pollUntilReady = async () => {
	        try {
	          const response = await fetch(${JSON.stringify(PREVIEW_STATUS_PATH)}, {
	            headers: { Accept: "application/json" },
	            cache: "no-store",
	          });
	          if (!response.ok) {
	            throw new Error("Failed to refresh preview session state.");
	          }
	          const session = await response.json();
	          if (
	            session
	            && session.hostPort
	            && session.status !== "stopped"
	            && session.status !== "error"
	          ) {
	            window.location.replace(requestedPath);
	            return;
	          }
          if (session && session.lastError && statusNode) {
            statusNode.textContent = session.lastError;
          }
        } catch (error) {
          if (statusNode) {
            statusNode.textContent = error instanceof Error ? error.message : String(error);
          }
        }
        pollTimer = window.setTimeout(pollUntilReady, 2000);
      };

      const triggerAction = async (targetPath, busyMessage) => {
        window.clearTimeout(pollTimer);
        setBusy(busyMessage, true);
        try {
          const response = await fetch(targetPath, { method: "POST" });
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(body || "Preview action failed.");
          }
          pollTimer = window.setTimeout(pollUntilReady, 1200);
        } catch (error) {
          setBusy(error instanceof Error ? error.message : String(error), false);
        }
      };

      startButton?.addEventListener("click", () => {
        void triggerAction(${JSON.stringify(PREVIEW_START_PATH)}, "Starting preview container...");
      });
      rebuildButton?.addEventListener("click", () => {
        void triggerAction(${JSON.stringify(PREVIEW_REBUILD_PATH)}, "Rebuilding preview container...");
      });

      if (${pollOnLoad ? "true" : "false"}) {
        setBusy("Waiting for the preview container to respond...", true);
        pollTimer = window.setTimeout(pollUntilReady, 1200);
      }
    })();
  </script>
</body>
</html>`;
}

export function injectPreviewBridgeIntoHtml(html: string): string {
  const tag = `<script src="${PREVIEW_BRIDGE_PATH}"></script>`;
  if (html.includes(PREVIEW_BRIDGE_PATH)) {
    return html;
  }
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${tag}\n</head>`);
  }
  if (html.includes("</body>")) {
    return html.replace("</body>", `  ${tag}\n</body>`);
  }
  return `${html}\n${tag}\n`;
}

export function rewritePreviewLocationHeader(location: string, req: express.Request, upstreamPort: number): string {
  if (!location) {
    return location;
  }
  const previewOrigin = `${req.protocol || "http"}://${String(req.headers.host || "").trim()}`;
  const upstreamOrigins = new Set([
    `http://127.0.0.1:${upstreamPort}`,
    `http://localhost:${upstreamPort}`,
  ]);
  for (const upstreamOrigin of upstreamOrigins) {
    if (location.startsWith(upstreamOrigin)) {
      return `${previewOrigin}${location.slice(upstreamOrigin.length)}`;
    }
  }
  return location;
}

export async function pipePreviewUpgradeRequest(args: {
  req: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  upstreamPort: number;
}): Promise<void> {
  const upstreamSocket = net.connect(args.upstreamPort, "127.0.0.1");
  const requestLines = [`${args.req.method || "GET"} ${args.req.url || "/"} HTTP/${args.req.httpVersion}`];
  for (const [key, value] of Object.entries(args.req.headers)) {
    if (value === undefined) {
      continue;
    }
    const headerValue = key.toLowerCase() === "host" ? `127.0.0.1:${args.upstreamPort}` : value;
    if (Array.isArray(headerValue)) {
      for (const item of headerValue) {
        requestLines.push(`${key}: ${item}`);
      }
      continue;
    }
    requestLines.push(`${key}: ${headerValue}`);
  }
  requestLines.push("", "");
  const requestBuffer = Buffer.from(requestLines.join("\r\n"), "utf8");

  const destroyBoth = () => {
    args.socket.destroy();
    upstreamSocket.destroy();
  };

  upstreamSocket.on("connect", () => {
    upstreamSocket.write(requestBuffer);
    if (args.head.length > 0) {
      upstreamSocket.write(args.head);
    }
    args.socket.pipe(upstreamSocket);
    upstreamSocket.pipe(args.socket);
  });
  upstreamSocket.on("error", destroyBoth);
  args.socket.on("error", destroyBoth);
  args.socket.on("close", () => upstreamSocket.destroy());
}
