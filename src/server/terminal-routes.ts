import { spawn, ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import { isHostileBrowserOrigin } from "./dashboard-security.js";
import type { IncomingMessage, Server as HttpServer } from "http";
import * as net from "net";
import type { Socket } from "net";
import type { Express } from "express";
import type { Logger } from "../shared/logging/logger.js";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute, toErrorResponse } from "./route-utils.js";
import { getDockerUserSpec } from "../services/cli-docker-utils.js";
import { assertSafePathSegment } from "../utils/path-validator.js";
import { managedRuntimeService } from "../services/managed-runtime-service.js";
import { PROVIDER_TOOL_MOUNT, providerToolManager } from "../services/provider-tool-manager.js";

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
  hostProxyServer?: net.Server | null;
  watchInterval?: NodeJS.Timeout;
  targetPort?: number;
}

export function parseAndValidateLoginUrl(urlStr: string): { isValid: true; url: string; randomPort?: number } | { isValid: false } {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { isValid: false };
    }

    let randomPort: number | undefined;
    const decodedUrl = decodeURIComponent(urlStr);
    const match = decodedUrl.match(/redirect_uri=([^&]+)/);

    if (match) {
      const redirectUrlStr = match[1];

      try {
        const redirectUrl = new URL(redirectUrlStr);
        if (redirectUrl.protocol === "http:" || redirectUrl.protocol === "https:") {
          if (redirectUrl.hostname === "localhost" || redirectUrl.hostname === "127.0.0.1") {
            const portStr = redirectUrl.port;
            if (portStr) {
              const port = parseInt(portStr, 10);
              if (!Number.isNaN(port) && port >= 1024 && port <= 65535) {
                randomPort = port;
              }
            }
          }
        }
      } catch (err) {
        // Invalid redirect_uri, but overall URL might still be safe to pass to browser,
        // we just won't create a local proxy for it.
      }
    }

    return { isValid: true, url: parsed.toString(), randomPort };
  } catch (err) {
    return { isValid: false };
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
    server.on("error", (err) => {
      reject(err);
    });
  });
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

function parseClientFrames(buffer: Buffer, maxFrameSize: number = 10 * 1024 * 1024): {
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
      closed = true;
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

    if (payloadLength > maxFrameSize) {
      closed = true;
      break;
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

function terminateSession(sessionId: string, reason: string): void {
  const session = activeTerminalSessions.get(sessionId);
  if (!session || session.finalized) {
    return;
  }
  session.finalized = true;

  if (session.watchInterval) {
    clearInterval(session.watchInterval);
  }
  if (session.hostProxyServer) {
    try {
      session.hostProxyServer.close();
    } catch (_) {}
  }

  try {
    session.childProcess.kill("SIGKILL");
  } catch {
    // Ignore if process is already dead
  }
  const cleanupProcess = spawn("docker", ["rm", "-f", "-v", `code-ux-login-${session.providerId}-${session.sessionId}`], {
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

async function cleanupAllRunningLoginSessions(logger?: Logger): Promise<void> {
  for (const [id] of activeTerminalSessions.entries()) {
    try {
      terminateSession(id, "preemptive-cleanup");
    } catch (_) {}
  }

  // 2. Clean up any leftover docker containers labeled code-ux.login=true
  try {
    const cp = await import("child_process");
    if (!cp || typeof cp.exec !== "function") {
      return;
    }
    await new Promise<void>((resolve) => {
      cp.exec("docker ps -a -q --filter 'label=code-ux.login=true'", (err, stdout) => {
        if (err) {
          logger?.error(`[DEBUG] Failed to query leftover login containers: ${String(err)}`);
          resolve();
          return;
        }
        const containerIds = stdout.trim().split(/\s+/).filter(Boolean);
        if (containerIds.length > 0) {
          logger?.info(`[DEBUG] Preemptively removing active/stray login containers: ${containerIds.join(", ")}`);
          cp.exec(`docker rm -f -v ${containerIds.join(" ")}`, (rmErr) => {
            if (rmErr) {
              logger?.error(`[DEBUG] Failed to force-remove leftover login containers: ${String(rmErr)}`);
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  } catch (_) {
    // Ignore in environments where child_process dynamic import or exec is unavailable
  }
}

export function registerTerminalRoutes(app: Express, options: DashboardDependencies): void {
  maybeStartLoginSessionSweeper();
  app.post("/api/terminal/start", asyncRoute(async (req, res) => {
    try {
      await cleanupAllRunningLoginSessions(options.logger);
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

      if (providerId) {
        const knownProviders = ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity", "generic-cli"];
        if (!knownProviders.includes(providerId)) {
          res.status(400).json({ error: `Unknown providerId: ${providerId}` });
          return;
        }
      }

      if (!providerId) {
        res.status(400).json({ error: "Unable to resolve a valid provider type from the request." });
        return;
      }
      const workflowSettings = systemSettings.defaults.cliWorkflow;
      const runtime = options.managedRuntimeService ?? managedRuntimeService;
      const tools = options.providerToolManager ?? providerToolManager;
      const baseImage = await runtime.resolveImage(workflowSettings, "base");
      const preparedTool = tools.getStatus(providerId)
        ? await tools.prepare(providerId, workflowSettings, { logger: options.logger })
        : null;

      let targetPort = 0;
      if (providerId === "codex" || providerId === "claude-code") {
        try {
          targetPort = await getFreePort();
        } catch (err) {
          options.logger?.error(`Failed to find a free port: ${String(err)}`);
          targetPort = providerId === "claude-code" ? 36573 : 1455;
        }
      }

      // The candidate config id is request-controlled and becomes a directory name under
      // ~/.code-ux/credentials, where it is targeted by destructive fs.rm(recursive)/mkdir/cp
      // calls. Reject any value that could escape that directory before it touches the FS, and
      // use the validator's own return value (not the raw request input) for every path built
      // from it below.
      let safeConfigId: string;
      try {
        safeConfigId = assertSafePathSegment(providerConfigId || providerId, "providerConfigId");
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid providerConfigId" });
        return;
      }
      const sessionId = randomUUID();
      const credentialsRoot = path.join(os.homedir(), ".code-ux", "credentials");
      const hostCredsDir = path.join(credentialsRoot, safeConfigId);
      const tempCredsDir = path.join(credentialsRoot, `${safeConfigId}-temp-${sessionId}`);
      // Inline containment check right beside the credentials directories that
      // are about to be read/written below (defense in depth on top of the
      // character allow-list above).
      if (
        path.relative(credentialsRoot, hostCredsDir).startsWith("..")
        || path.relative(credentialsRoot, tempCredsDir).startsWith("..")
      ) {
        res.status(400).json({ error: "Invalid providerConfigId" });
        return;
      }

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

      const proxyCmd = "";

      const containerCmd = [
        "set -e",
        "mkdir -p /tmp/code-ux-login",
        "cd /tmp/code-ux-login",
        "mkdir -p /tmp/.local/share /tmp/.config",
        "ln -sf /tmp/.credentials /tmp/.gemini",
        "ln -sf /tmp/.credentials /tmp/.codex",
        "ln -sf /tmp/.credentials /tmp/.claude",
        "ln -sf /tmp/.credentials/.claude.json /tmp/.claude.json",
        "ln -sf /tmp/.credentials /tmp/.qwen",
        "ln -sf /tmp/.credentials /tmp/.local/share/opencode",
        "ln -sf /tmp/.credentials /tmp/.antigravity",
        providerId === "antigravity" ? "ln -sf /tmp/.credentials /tmp/.local/share/keyrings" : "",
        providerId === "antigravity" ? [
          "if ! command -v dbus-daemon >/dev/null 2>&1 || ! command -v gnome-keyring-daemon >/dev/null 2>&1; then",
          "  echo 'Installing keyring dependencies in container...'",
          "  if command -v apt-get >/dev/null 2>&1; then",
          "    (apt-get update -qy && apt-get install -qy dbus gnome-keyring libsecret-1-0 xdg-utils) || true",
          "  fi",
          "fi",
          "if command -v dbus-daemon >/dev/null 2>&1 && command -v gnome-keyring-daemon >/dev/null 2>&1; then",
          "  echo 'Starting D-Bus session and gnome-keyring-daemon...' >&2",
          "  export DBUS_SESSION_BUS_ADDRESS=$(dbus-daemon --session --print-address --fork || echo '')",
          "  if [ -n \"$DBUS_SESSION_BUS_ADDRESS\" ]; then",
          "    export $(echo -n 'dummy' | gnome-keyring-daemon --unlock 2>/dev/null || echo '') >/dev/null 2>&1 || true",
          "    export $(gnome-keyring-daemon --start --components=secrets 2>/dev/null || echo '') >/dev/null 2>&1 || true",
          "  fi",
          "fi",
        ].join("\n") : "",
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
        "    if (process.env.TARGET_PORT) {",
        "      targetPort = parseInt(process.env.TARGET_PORT, 10);",
        "    } else if (providerId === 'claude-code') {",
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
        proxyCmd,
        `script -q -c "export PATH=${PROVIDER_TOOL_MOUNT}/bin:/tmp/.npm-global/bin:/tmp/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin && export BROWSER=xdg-open && export TERM=xterm-256color && stty cols 100 rows 30 && ${loginCmd}" /dev/null`,
      ].filter(Boolean).join("\n");

      const userSpec = getDockerUserSpec();
      let networkArgs: string[] = [];
      if (providerId === "codex") {
        networkArgs = ["-p", `127.0.0.1:${targetPort}:${targetPort}`];
      } else if (providerId === "claude-code") {
        networkArgs = ["-p", `127.0.0.1:${targetPort}:${targetPort}`];
      }

      const dockerArgs = [
        "run",
        "--rm",
        "-i",
        ...networkArgs,
        "--workdir",
        "/tmp",
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
        "-e",
        `TARGET_PORT=${targetPort}`,
        "-e",
        "DISABLE_AUTOUPDATER=1",
        "-e",
        "OPENCODE_DISABLE_AUTOUPDATE=true",
        "-e",
        "AGY_CLI_DISABLE_AUTO_UPDATE=true",
        "-e",
        "TERM=xterm-256color",
        "-e",
        "COLORTERM=truecolor",
        "--user",
        userSpec,
        "-v",
        `${tempCredsDir}:/tmp/.credentials`,
        ...(preparedTool ? [
          "--mount",
          `type=volume,source=${preparedTool.volumeName},target=${PROVIDER_TOOL_MOUNT},readonly`,
        ] : []),
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
        targetPort,
      };

      activeTerminalSessions.set(sessionId, session);

      // Watch for the login URL file written by our custom xdg-open wrapper
      const urlFilePath = path.join(tempCredsDir, "login_url.txt");
      session.hostProxyServer = null;
      const watchInterval = setInterval(async () => {
        if (session.finalized) {
          clearInterval(watchInterval);
          if (session.hostProxyServer) {
            session.hostProxyServer.close();
          }
          return;
        }
        try {
          const content = await fs.readFile(urlFilePath, "utf8");
          const rawUrl = content.trim();
          if (rawUrl) {
            const validationResult = parseAndValidateLoginUrl(rawUrl);

            if (validationResult.isValid) {
              const { url, randomPort } = validationResult;

              if (randomPort) {
                const targetPort = session.targetPort || (providerId === "claude-code" ? 36573 : 1455);
                if (targetPort !== randomPort) {
                  try {
                    if (session.hostProxyServer) {
                      try { session.hostProxyServer.close(); } catch (_) {}
                    }
                    session.hostProxyServer = net.createServer((clientSocket) => {
                      const serverSocket = net.connect(targetPort, "127.0.0.1", () => {
                        clientSocket.pipe(serverSocket).pipe(clientSocket);
                      });
                      clientSocket.on("error", () => serverSocket.destroy());
                      serverSocket.on("error", () => clientSocket.destroy());
                    });
                    session.hostProxyServer.listen(randomPort, "127.0.0.1", () => {
                      options.logger?.info(`[DEBUG] Host Proxy listening on 127.0.0.1:${randomPort} -> 127.0.0.1:${targetPort}`);
                    });
                    if (typeof session.hostProxyServer.unref === "function") {
                      session.hostProxyServer.unref();
                    }
                  } catch (err) {
                    options.logger?.error(`[DEBUG] Failed to start host proxy on port ${randomPort}: ${String(err)}`);
                  }
                }
              }

              for (const client of session.clients) {
                sendJson(client, { type: "login_url", url });
              }
            } else {
              options.logger?.warn("[DEBUG] Rejected malformed or privileged provider login URL");
            }
            await fs.rm(urlFilePath, { force: true }).catch(() => {});
          }
        } catch {
          // File doesn't exist yet, ignore
        }
      }, 500);
      session.watchInterval = watchInterval;
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
            (providerId === "antigravity" && session.outputBuffer.includes("Choose your color scheme")) ||
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

    const fakeReq = {
      method: "POST",
      path: "/api/terminal/ws",
      headers: req.headers,
    };
    if (isHostileBrowserOrigin(fakeReq as any)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
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
    const MAX_WEBSOCKET_BUFFER_SIZE = 25 * 1024 * 1024;
    const MAX_WEBSOCKET_FRAME_SIZE = 10 * 1024 * 1024;
    socket.on("data", (chunk: Buffer) => {
      if (buffered.length + chunk.length > MAX_WEBSOCKET_BUFFER_SIZE) {
        socket.destroy();
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);
      const parsed = parseClientFrames(buffered, MAX_WEBSOCKET_FRAME_SIZE);
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
