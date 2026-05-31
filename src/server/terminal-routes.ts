import { spawn, ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import type { IncomingMessage, Server as HttpServer } from "http";
import * as net from "net";
import type { Socket } from "net";
import type { Express } from "express";
import type { Logger } from "../shared/logging/logger.js";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute, toErrorResponse } from "./route-utils.js";
import { getDockerUserSpec, getProviderFallbackInstallCommand } from "../services/cli-docker-utils.js";

interface TerminalSession {
  sessionId: string;
  providerId: string;
  childProcess: ChildProcess;
  outputBuffer: string;
  clients: Set<Socket>;
  createdAt: number;
  lastHeartbeatAt: number;
  finalized: boolean;
  lastDisconnectAt?: number;
}

const activeTerminalSessions = new Map<string, TerminalSession>();
const LOGIN_SESSION_MAX_AGE_MS = 30 * 60 * 1000;
const LOGIN_SESSION_HEARTBEAT_TTL_MS = 20 * 1000;
const LOGIN_SESSION_SWEEP_INTERVAL_MS = 5 * 1000;
const LOGIN_SESSION_DISCONNECT_GRACE_MS = 1000;
const DISCONNECT_GRACE_PERIOD_MS = 30 * 1000;
let loginSessionSweepStarted = false;

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeFrame(payload: string): Buffer {
  const message = Buffer.from(payload, "utf8");
  const length = message.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), message]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, message]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, message]);
}

function sendJson(socket: Socket, payload: unknown): void {
  try {
    socket.write(encodeFrame(JSON.stringify(payload)));
  } catch {
    // Ignore socket write errors
  }
}

function closeSocket(socket: Socket): void {
  try {
    socket.end(Buffer.from([0x88, 0x00]));
  } catch {
    socket.destroy();
  }
}

function parseClientFrames(buffer: Buffer): {
  messages: string[];
  nextBuffer: Buffer;
  closed: boolean;
} {
  const messages: string[] = [];
  let offset = 0;
  let closed = false;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let headerLength = 2;

    if (!masked) {
      break;
    }

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      const bigLength = Number(buffer.readBigUInt64BE(offset + 2));
      if (!Number.isFinite(bigLength)) {
        closed = true;
        break;
      }
      payloadLength = bigLength;
      headerLength = 10;
    }

    const totalLength = headerLength + 4 + payloadLength;
    if (offset + totalLength > buffer.length) {
      break;
    }

    const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
    const payload = buffer.subarray(offset + headerLength + 4, offset + totalLength);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    if (opcode === 0x8) {
      closed = true;
      offset += totalLength;
      break;
    }

    if (opcode === 0x9) {
      offset += totalLength;
      continue;
    }

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    }

    offset += totalLength;
  }

  return {
    messages,
    nextBuffer: buffer.subarray(offset),
    closed,
  };
}

function acceptKey(clientKey: string): string {
  return createHash("sha1").update(`${clientKey}${WS_MAGIC}`).digest("base64");
}

function getContainerCredsFolder(providerId: string): string {
  switch (providerId) {
    case "gemini":
      return "/workspace/.code-ux-home/.gemini";
    case "codex":
      return "/workspace/.code-ux-home/.codex";
    case "claude-code":
      return "/workspace/.code-ux-home/.claude";
    case "qwen-code":
      return "/workspace/.code-ux-home/.qwen";
    case "opencode":
      return "/workspace/.code-ux-home/.local/share/opencode";
    case "antigravity":
      return "/workspace/.code-ux-home/.antigravity";
    default:
      return `/workspace/.code-ux-home/.${providerId}`;
  }
}

function getBinaryName(providerId: string): string {
  switch (providerId) {
    case "claude-code":
      return "claude";
    case "qwen-code":
      return "qwen";
    case "opencode":
      return "opencode";
    case "antigravity":
      return "agy";
    default:
      return providerId;
  }
}

function getFallbackInstallKey(providerId: string): string {
  switch (providerId) {
    case "claude-code":
      return "claude";
    case "antigravity":
      return "agy";
    default:
      return providerId;
  }
}

function terminateSession(sessionId: string, reason: string): void {
  const session = activeTerminalSessions.get(sessionId);
  if (!session || session.finalized) {
    return;
  }
  session.finalized = true;
  try {
    session.childProcess.kill("SIGKILL");
  } catch {
    // Ignore if process is already dead
  }
  const cleanupProcess = spawn("docker", ["rm", "-f", `code-ux-login-${session.providerId}-${session.sessionId}`], {
    stdio: "ignore",
  });
  if (typeof cleanupProcess.unref === "function") {
    cleanupProcess.unref();
  }
  activeTerminalSessions.delete(sessionId);
}

function maybeStartLoginSessionSweeper(): void {
  if (loginSessionSweepStarted) {
    return;
  }
  loginSessionSweepStarted = true;
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of activeTerminalSessions.entries()) {
      if (session.finalized) {
        activeTerminalSessions.delete(id);
        continue;
      }
      const sessionAgeMs = now - session.createdAt;
      const shouldExpireByAge = sessionAgeMs > LOGIN_SESSION_MAX_AGE_MS;
      const hasNoClients = session.clients.size === 0;
      let shouldExpireByHeartbeat = false;

      if (hasNoClients) {
        if (session.lastDisconnectAt) {
          shouldExpireByHeartbeat = (now - session.lastDisconnectAt) > DISCONNECT_GRACE_PERIOD_MS;
        } else {
          session.lastDisconnectAt = now;
        }
      }

      if (shouldExpireByAge || shouldExpireByHeartbeat) {
        terminateSession(id, shouldExpireByAge ? "max-age" : "stale-heartbeat");
      }
    }
  }, LOGIN_SESSION_SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") {
    sweepTimer.unref();
  }
}

export function registerTerminalRoutes(app: Express, options: DashboardDependencies): void {
  maybeStartLoginSessionSweeper();
  app.post("/api/terminal/start", asyncRoute(async (req, res) => {
    try {
      const { providerConfigId, providerId: requestProviderId } = req.body as {
        providerConfigId?: string;
        providerId?: string;
      };

      if (!providerConfigId && !requestProviderId) {
        res.status(400).json({ error: "Missing providerConfigId or providerId parameter." });
        return;
      }

      let providerId = requestProviderId;
      const systemSettings = options.getSystemSettings();

      if (!providerId && providerConfigId) {
        const providerConfig = systemSettings.integrations.providers[providerConfigId];
        if (providerConfig) {
          providerId = providerConfig.provider;
        } else {
          // Fallback to parsing provider prefix for unsaved/dynamically-generated IDs
          const knownProviders = ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"];
          for (const known of knownProviders) {
            if (providerConfigId === known || providerConfigId.startsWith(`${known}-`)) {
              providerId = known;
              break;
            }
          }

          if (!providerId) {
            res.status(404).json({ error: `Provider configuration '${providerConfigId}' not found.` });
            return;
          }
        }
      }

      if (!providerId) {
        res.status(400).json({ error: "Unable to resolve a valid provider type from the request." });
        return;
      }
      const baseImage = systemSettings.defaults.cliWorkflow.containerImage.trim() || "node:24-bookworm";

      const sessionId = Math.random().toString(36).substring(2, 15);
      const hostCredsDir = path.join(os.homedir(), ".code-ux", "credentials", providerId);
      const tempCredsDir = path.join(os.homedir(), ".code-ux", "credentials", `${providerId}-temp-${sessionId}`);

      // Ensure the temp credentials folder starts completely empty
      try {
        await fs.rm(tempCredsDir, { recursive: true, force: true });
      } catch (err) {
        // Ignore if it doesn't exist
      }
      await fs.mkdir(tempCredsDir, { recursive: true });

      const binaryName = getBinaryName(providerId);
      let loginCmd = binaryName;
      if (providerId === "codex") {
        loginCmd = "codex login"; // codex requires the explicit login command to prompt auth
      } else if (providerId === "claude-code") {
        loginCmd = "claude auth login";
      }

      const fallbackKey = getFallbackInstallKey(providerId);
      const installCmd = getProviderFallbackInstallCommand(fallbackKey);

      let proxyCmd = "";
      if (providerId === "codex") {
        proxyCmd = "node -e \"const net = require('net'), os = require('os'); let ip = '0.0.0.0'; const ifs = os.networkInterfaces(); for (const n of Object.keys(ifs)) { for (const netIf of ifs[n]) { if (netIf.family === 'IPv4' && !netIf.internal) { ip = netIf.address; break; } } } const s = net.createServer((c) => { const p = net.connect(1455, '127.0.0.1', () => { c.pipe(p).pipe(c); }); p.on('error', () => c.destroy()); c.on('error', () => p.destroy()); }); s.on('error', () => {}); s.listen(1455, ip);\" &";
      }

      const containerCmd = [
        "set -e",
        "mkdir -p /tmp/.local/share /tmp/.config",
        "ln -sf /tmp/.credentials /tmp/.gemini",
        "ln -sf /tmp/.credentials /tmp/.codex",
        "ln -sf /tmp/.credentials /tmp/.claude",
        "ln -sf /tmp/.credentials/.claude.json /tmp/.claude.json",
        "ln -sf /tmp/.credentials /tmp/.qwen",
        "ln -sf /tmp/.credentials /tmp/.local/share/opencode",
        "ln -sf /tmp/.credentials /tmp/.antigravity",
        "mkdir -p /tmp/.npm-global",
        "export NPM_CONFIG_PREFIX=/tmp/.npm-global",
        "export PATH=/tmp/.npm-global/bin:$PATH",
        "export BROWSER=xdg-open",
        "mkdir -p /tmp/.npm-global/bin",
        "cat << 'EOF' > /tmp/.npm-global/bin/xdg-open",
        "#!/usr/bin/env node",
        "const fs = require('fs');",
        "const { spawn } = require('child_process');",
        "const args = process.argv.slice(2);",
        "console.log('[DEBUG] xdg-open called with args:', args);",
        "let url = args.find(arg => arg.startsWith('http://') || arg.startsWith('https://'));",
        "if (url) {",
        "  const decodedUrl = decodeURIComponent(url);",
        "  const match = decodedUrl.match(/redirect_uri=https?:\\/\\/(?:localhost|127\\.0\\.0\\.1):(\\d+)/);",
        "  if (match && match[1]) {",
        "    const randomPort = parseInt(match[1], 10);",
        "    const providerId = process.env.PROVIDER_ID;",
        "    let targetPort = randomPort;",
        "    if (providerId === 'claude-code') {",
        "      targetPort = 36573;",
        "    } else if (providerId === 'codex') {",
        "      targetPort = 1455;",
        "    }",
        "    console.log(`[DEBUG] Detected ${providerId} random callback port: ${randomPort}`);",
        "    if (targetPort !== randomPort) {",
        "      try {",
        "        if (fs.existsSync('/tmp/proxy.pid')) {",
        "          const pid = fs.readFileSync('/tmp/proxy.pid', 'utf8').trim();",
        "          process.kill(parseInt(pid, 10), 'SIGTERM');",
        "        }",
        "      } catch (e) {}",
        "      const proxyCode = 'const net = require(\"net\");\\n' +",
        "        'const proxyServer = net.createServer((clientSocket) => {\\n' +",
        "        '  const serverSocket = net.connect(' + randomPort + ', \"127.0.0.1\", () => {\\n' +",
        "        '    clientSocket.pipe(serverSocket).pipe(clientSocket);\\n' +",
        "        '  });\\n' +",
        "        '  clientSocket.on(\"error\", () => serverSocket.destroy());\\n' +",
        "        '  serverSocket.on(\"error\", () => clientSocket.destroy());\\n' +",
        "        '});\\n' +",
        "        'proxyServer.listen(' + targetPort + ', \"0.0.0.0\");';",
        "      fs.writeFileSync('/tmp/proxy.js', proxyCode);",
        "      const out = fs.openSync('/tmp/proxy.log', 'a');",
        "      const err = fs.openSync('/tmp/proxy.log', 'a');",
        "      const child = spawn('node', ['/tmp/proxy.js'], {",
        "        detached: true,",
        "        stdio: ['ignore', out, err]",
        "      });",
        "      fs.writeFileSync('/tmp/proxy.pid', String(child.pid));",
        "      child.unref();",
        "    }",
        "    fs.writeFileSync('/tmp/.credentials/login_url.txt', url);",
        "  } else {",
        "    fs.writeFileSync('/tmp/.credentials/login_url.txt', url);",
        "  }",
        "}",
        "process.exit(0);",
        "EOF",
        "chmod +x /tmp/.npm-global/bin/xdg-open",
        "ln -sf /tmp/.npm-global/bin/xdg-open /tmp/.npm-global/bin/sensible-browser",
        "ln -sf /tmp/.npm-global/bin/xdg-open /tmp/.npm-global/bin/x-www-browser",
        "ln -sf /tmp/.npm-global/bin/xdg-open /tmp/.npm-global/bin/open",
        `if ! command -v ${binaryName} >/dev/null 2>&1; then`,
        `  echo 'Installing provider CLI fallback in container...'`,
        `  ${installCmd || "echo 'No installation command configured'"};`,
        "fi",
        proxyCmd,
        `script -q -c "export NPM_CONFIG_PREFIX=/tmp/.npm-global && export PATH=/tmp/.npm-global/bin:/tmp/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin && export BROWSER=xdg-open && stty cols 80 rows 24 && ${loginCmd}" /dev/null`,
      ].filter(Boolean).join("\n");
 
      const userSpec = getDockerUserSpec();
      let networkArgs = ["--network", "host"];
      if (providerId === "codex") {
        networkArgs = ["-p", "1455:1455"];
      } else if (providerId === "claude-code") {
        networkArgs = ["-p", "36573:36573"];
      }

      const dockerArgs = [
        "run",
        "--rm",
        "-i",
        ...networkArgs,
        "--name",
        `code-ux-login-${providerId}-${sessionId}`,
        "--label",
        "code-ux.login=true",
        "--label",
        `code-ux.session-id=${sessionId}`,
        "--label",
        `code-ux.provider-id=${providerId}`,
        "--label",
        `code-ux.command=${loginCmd}`,
        "-e",
        "HOME=/tmp",
        "-e",
        `PROVIDER_ID=${providerId}`,
        "--user",
        userSpec,
        "-v",
        `${tempCredsDir}:/tmp/.credentials`,
        baseImage,
        "bash",
        "-c",
        containerCmd
      ];

      const childProcess = spawn("docker", dockerArgs, {
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const session: TerminalSession = {
        sessionId,
        providerId,
        childProcess,
        outputBuffer: "",
        clients: new Set<Socket>(),
        createdAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        finalized: false,
      };

      activeTerminalSessions.set(sessionId, session);

      // Watch for the login URL file written by our custom xdg-open wrapper
      const urlFilePath = path.join(tempCredsDir, "login_url.txt");
      let hostProxyServer: net.Server | null = null;
      const watchInterval = setInterval(async () => {
        if (session.finalized) {
          clearInterval(watchInterval);
          if (hostProxyServer) {
            hostProxyServer.close();
          }
          return;
        }
        try {
          const content = await fs.readFile(urlFilePath, "utf8");
          const url = content.trim();
          if (url && url.startsWith("http")) {
            const decodedUrl = decodeURIComponent(url);
            const match = decodedUrl.match(/redirect_uri=https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
            if (match && match[1]) {
              const randomPort = parseInt(match[1], 10);
              const targetPort = 36573;
              if (targetPort !== randomPort) {
                try {
                  if (hostProxyServer) {
                    try { hostProxyServer.close(); } catch (_) {}
                  }
                  hostProxyServer = net.createServer((clientSocket) => {
                    const serverSocket = net.connect(targetPort, "127.0.0.1", () => {
                      clientSocket.pipe(serverSocket).pipe(clientSocket);
                    });
                    clientSocket.on("error", () => serverSocket.destroy());
                    serverSocket.on("error", () => clientSocket.destroy());
                  });
                  hostProxyServer.listen(randomPort, "127.0.0.1", () => {
                    options.logger?.info(`[DEBUG] Host Proxy listening on 127.0.0.1:${randomPort} -> 127.0.0.1:${targetPort}`);
                  });
                  if (typeof hostProxyServer.unref === "function") {
                    hostProxyServer.unref();
                  }
                } catch (err) {
                  options.logger?.error(`[DEBUG] Failed to start host proxy on port ${randomPort}: ${String(err)}`);
                }
              }
            }

            for (const client of session.clients) {
              sendJson(client, { type: "login_url", url });
            }
            await fs.rm(urlFilePath, { force: true }).catch(() => {});
          }
        } catch {
          // File doesn't exist yet, ignore
        }
      }, 500);
      if (typeof watchInterval.unref === "function") {
        watchInterval.unref();
      }

      let loginSucceeded = false;

      const handleOutput = (chunk: Buffer): void => {
        const text = chunk.toString("utf8");
        session.outputBuffer += text;
        if (session.outputBuffer.length > 50000) {
          session.outputBuffer = session.outputBuffer.substring(session.outputBuffer.length - 50000);
        }

        // Auto-detect successful login and terminate early
        if (!loginSucceeded) {
          if (
            (providerId === "gemini" && session.outputBuffer.includes("Signed in")) ||
            (providerId === "codex" && session.outputBuffer.includes("Successfully logged in")) ||
            (providerId === "claude-code" && (
              session.outputBuffer.includes("Logged in") ||
              session.outputBuffer.includes("Login successful") ||
              session.outputBuffer.includes("Authentication successful") ||
              session.outputBuffer.includes("Successfully authenticated") ||
              session.outputBuffer.includes("Authenticated successfully")
            ))
          ) {
            loginSucceeded = true;
            setTimeout(() => {
              try {
                childProcess.kill("SIGKILL");
              } catch (e) {
                // Ignore error if already dead
              }
            }, 800); // 800ms grace period to let credentials finish writing
          }
        }

        for (const client of session.clients) {
          sendJson(client, { type: "output", data: text });
        }
      };

      childProcess.stdout?.on("data", handleOutput);
      childProcess.stderr?.on("data", handleOutput);

      childProcess.on("exit", (code) => {
        session.finalized = true;
        // Asynchronously copy newly generated credentials to the active host path on success
        void (async () => {
          if (code === 0 || loginSucceeded) {
            try {
              await fs.rm(hostCredsDir, { recursive: true, force: true }).catch(() => {});
              await fs.mkdir(hostCredsDir, { recursive: true });
              await fs.cp(tempCredsDir, hostCredsDir, { recursive: true });
            } catch (err) {
              // Ignore copy error
            }
          }

          // Always clean up the temporary directory
          try {
            await fs.rm(tempCredsDir, { recursive: true, force: true });
          } catch (err) {
            // Ignore cleanup error
          }
        })();

        for (const client of session.clients) {
          sendJson(client, { type: "exit", code: code ?? 0 });
          closeSocket(client);
        }
        activeTerminalSessions.delete(sessionId);
      });

      res.json({ sessionId, providerId });
    } catch (e) {
      res.status(500).json(toErrorResponse(e));
    }
  }));

  app.post("/api/terminal/stop", syncRoute((req, res) => {
    try {
      const { sessionId } = req.body as { sessionId: string };
      if (!sessionId) {
        res.status(400).json({ error: "Missing sessionId parameter." });
        return;
      }

      const session = activeTerminalSessions.get(sessionId);
      if (session) {
        terminateSession(sessionId, "explicit-stop");
      }

      res.json({ success: true });
    } catch (e) {
      res.status(500).json(toErrorResponse(e));
    }
  }));

  app.post("/api/terminal/heartbeat", syncRoute((req, res) => {
    try {
      const { sessionId } = req.body as { sessionId?: string };
      if (!sessionId) {
        res.status(400).json({ error: "Missing sessionId parameter." });
        return;
      }
      const session = activeTerminalSessions.get(sessionId);
      if (!session || session.finalized) {
        res.status(404).json({ error: "Session not found." });
        return;
      }
      session.lastHeartbeatAt = Date.now();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json(toErrorResponse(e));
    }
  }));

  app.post("/api/terminal/finalize", syncRoute((req, res) => {
    try {
      const { sessionId } = req.body as { sessionId?: string };
      if (!sessionId) {
        res.status(400).json({ error: "Missing sessionId parameter." });
        return;
      }
      const session = activeTerminalSessions.get(sessionId);
      if (session) {
        terminateSession(sessionId, "finalize");
      }
      // Idempotent response for duplicate unload/finalize attempts.
      res.json({ success: true });
    } catch (e) {
      res.status(500).json(toErrorResponse(e));
    }
  }));
}

export function bootDashboardTerminalWebSocketServer(args: {
  server: HttpServer;
  pathName: string;
  logger: Logger;
}): void {
  const upgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname !== args.pathName) {
      return;
    }

    const sessionId = requestUrl.searchParams.get("sessionId");
    if (!sessionId) {
      socket.destroy();
      return;
    }

    const session = activeTerminalSessions.get(sessionId);
    if (!session) {
      socket.destroy();
      return;
    }

    const wsKey = String(req.headers["sec-websocket-key"] || "").trim();
    if (!wsKey) {
      socket.destroy();
      return;
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey(wsKey)}`,
        "",
        "",
      ].join("\r\n"),
    );

    session.clients.add(socket);
    session.lastDisconnectAt = undefined;

    // Stream existing buffer history to client immediately on connection
    if (session.outputBuffer) {
      sendJson(socket, { type: "output", data: session.outputBuffer });
    }

    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const parsed = parseClientFrames(buffered);
      buffered = parsed.nextBuffer;

      if (parsed.closed) {
        session.clients.delete(socket);
        closeSocket(socket);
        return;
      }

      for (const messageText of parsed.messages) {
        try {
          const message = JSON.parse(messageText) as { type: string; data?: string };
          if (message.type === "input" && typeof message.data === "string") {
            session.childProcess.stdin?.write(message.data);
          } else if (message.type === "heartbeat") {
            session.lastHeartbeatAt = Date.now();
          }
        } catch {
          // Ignore invalid client message parsing
        }
      }
    });

    const handleDisconnect = (): void => {
      session.clients.delete(socket);
      if (session.clients.size === 0 && !session.lastDisconnectAt) {
        session.lastDisconnectAt = Date.now();
      }

      const finalizeIfStale = (): void => {
        if (session.clients.size > 0 || !activeTerminalSessions.has(sessionId)) {
          return;
        }
        const ageMs = session.lastDisconnectAt ? (Date.now() - session.lastDisconnectAt) : 0;
        if (ageMs > DISCONNECT_GRACE_PERIOD_MS) {
          terminateSession(sessionId, "disconnect-stale-heartbeat");
        }
      };
      setTimeout(finalizeIfStale, DISCONNECT_GRACE_PERIOD_MS + 250);
    };

    socket.on("close", handleDisconnect);
    socket.on("end", handleDisconnect);
    socket.on("error", handleDisconnect);
  };

  args.server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname === args.pathName) {
      upgradeHandler(req, socket as Socket, head);
    }
  });
}
