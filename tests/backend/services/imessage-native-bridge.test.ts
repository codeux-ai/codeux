import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  IMESSAGE_BRIDGE_PROTOCOL_VERSION,
  type ImessageBridgeEnvelope,
} from "../../../src/domain/chat-connectors/providers/imessage.js";
import {
  classifyImessageNativeBridgeSpawnError,
  ImessageNativeBridge,
  ImessageNativeBridgeError,
  parseImessageNativeBridgeCommand,
} from "../../../src/services/chat-providers/imessage-native-bridge.js";

const tempDirs: string[] = [];
const bridges: ImessageNativeBridge[] = [];

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  await Promise.allSettled(bridges.splice(0).map((bridge) => bridge.dispose()));
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("ImessageNativeBridge", () => {
  it("executes a quoted Node fixture without a shell and sends the v1 contract", async () => {
    vi.stubEnv("JULES_API_KEY", "must-not-inherit");
    const fixture = await createFixture(`
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        const request = JSON.parse(input);
        process.stdout.write(JSON.stringify({
          protocolVersion: request.protocolVersion,
          operation: request.operation,
          correlation: request.correlation,
          message: request.message,
          chat: request.chat,
          sender: request.sender,
          reply: request.reply,
          result: {
            status: 'sent',
            messageGuid: 'bridge-message-guid',
            chatGuid: request.chat.guid,
            metadata: {
              argv: process.argv.slice(2),
              tokenBoundary: process.env.CODEUX_CHAT_BRIDGE_TOKEN === 'dedicated-secret',
              echoedCredential: process.env.CODEUX_CHAT_BRIDGE_TOKEN,
              unrelatedSecretInherited: Boolean(process.env.JULES_API_KEY),
            },
          },
          error: null,
        }));
      });
    `);
    const bridge = track(new ImessageNativeBridge());
    const correlationId = "send-correlation";

    const result = await bridge.send({
      command: `${quote(process.execPath)} ${quote(fixture)} "argument with spaces" "semicolon;is-literal"`,
      workingDirectory: path.dirname(fixture),
      bridgeToken: "dedicated-secret",
      correlationId,
      request: sendRequest(correlationId),
    });

    expect(result).toEqual({
      externalMessageId: "bridge-message-guid",
      responseMetadata: {
        protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
        status: "sent",
        chatGuid: "chat-guid",
        metadata: {
          argv: ["argument with spaces", "semicolon;is-literal"],
          tokenBoundary: true,
          echoedCredential: "[REDACTED]",
          unrelatedSecretInherited: false,
        },
      },
    });
  });

  it("parses macOS, Windows, and bare executable command records without losing path separators", () => {
    expect(parseImessageNativeBridgeCommand(
      '"/Applications/Bridge App/bridge" --profile "Local Relay"',
      "darwin",
    )).toEqual(["/Applications/Bridge App/bridge", "--profile", "Local Relay"]);
    expect(parseImessageNativeBridgeCommand(
      String.raw`"C:\Program Files\Bridge App\bridge.exe" --profile "Local Relay"`,
      "win32",
    )).toEqual([String.raw`C:\Program Files\Bridge App\bridge.exe`, "--profile", "Local Relay"]);
    expect(parseImessageNativeBridgeCommand(
      '"C:\\\\Program Files\\\\Bridge App\\\\bridge.exe" --health',
      "win32",
    )).toEqual([String.raw`C:\Program Files\Bridge App\bridge.exe`, "--health"]);
    expect(parseImessageNativeBridgeCommand(
      '"\\\\\\\\server\\\\Bridge Share\\\\bridge.exe" --health',
      "win32",
    )).toEqual([String.raw`\\server\Bridge Share\bridge.exe`, "--health"]);
    expect(parseImessageNativeBridgeCommand("bridge --literal semicolon;value", "linux"))
      .toEqual(["bridge", "--literal", "semicolon;value"]);
    expect(() => parseImessageNativeBridgeCommand('bridge "unfinished', "linux"))
      .toThrowError(expect.objectContaining({ code: "invalid_configuration" }));
  });

  it("returns deterministic unsupported-platform, missing-executable, and permission diagnostics", async () => {
    const bridge = track(new ImessageNativeBridge({ platform: process.platform }));
    const unsupported = await bridge.verifyNative({
      command: quote(process.execPath),
      correlationId: "platform-check",
      supportedPlatforms: process.platform === "darwin" ? ["linux"] : ["darwin"],
    });
    const missing = await bridge.verifyNative({
      command: path.join(os.tmpdir(), "code-ux-definitely-missing-imessage-bridge"),
      correlationId: "missing-check",
    });
    const permission = classifyImessageNativeBridgeSpawnError(Object.assign(new Error("access denied"), { code: "EACCES" }));

    expect(unsupported).toMatchObject({ ok: false, code: "unsupported_platform", protocolVersion: null });
    expect(missing).toMatchObject({ ok: false, code: "missing_executable", protocolVersion: null });
    expect(permission).toMatchObject({ code: "permission_denied", retryable: false });
  });

  it("terminates timed-out and cancelled fixtures with stable diagnostics", async () => {
    const fixture = await createFixture("process.stdin.resume(); setInterval(() => {}, 1000);");
    const bridge = track(new ImessageNativeBridge());

    const timeout = await bridge.verifyNative({
      command: `${quote(process.execPath)} ${quote(fixture)}`,
      correlationId: "timeout-check",
      timeoutMs: 50,
    });
    const controller = new AbortController();
    const cancellationPromise = bridge.verifyNative({
      command: `${quote(process.execPath)} ${quote(fixture)}`,
      correlationId: "cancel-check",
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort("fixture cancellation"), 25);

    expect(timeout).toMatchObject({ ok: false, code: "timeout" });
    await expect(cancellationPromise).resolves.toMatchObject({ ok: false, code: "cancelled" });
  });

  it("terminates all active child processes when disposed", async () => {
    const fixture = await createFixture("process.stdin.resume(); setInterval(() => {}, 1000);");
    const bridge = track(new ImessageNativeBridge());
    const healthPromise = bridge.verifyNative({
      command: `${quote(process.execPath)} ${quote(fixture)}`,
      correlationId: "shutdown-check",
      timeoutMs: 2_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    await bridge.dispose();

    await expect(healthPromise).resolves.toMatchObject({ ok: false, code: "shutdown" });
  });

  it("rejects oversized output and malformed JSON", async () => {
    const oversizedFixture = await createFixture("process.stdin.resume(); process.stdout.write('x'.repeat(4096));");
    const malformedFixture = await createFixture("process.stdin.resume(); process.stdout.write('{not-json');");
    const bridge = track(new ImessageNativeBridge());

    await expect(bridge.verifyNative({
      command: `${quote(process.execPath)} ${quote(oversizedFixture)}`,
      correlationId: "oversized-check",
      maxStdoutBytes: 128,
    })).resolves.toMatchObject({ ok: false, code: "output_limit_exceeded" });
    await expect(bridge.verifyNative({
      command: `${quote(process.execPath)} ${quote(malformedFixture)}`,
      correlationId: "malformed-check",
    })).resolves.toMatchObject({ ok: false, code: "malformed_response" });
  });

  it("negotiates protocol and correlation fields strictly for health checks", async () => {
    const wrongVersion = await createFixture(responseFixture({ protocolVersion: "2.0" }));
    const wrongCorrelation = await createFixture(responseFixture({ correlationId: "different-correlation" }));
    const bridge = track(new ImessageNativeBridge());

    await expect(bridge.verifyNative({
      command: `${quote(process.execPath)} ${quote(wrongVersion)}`,
      correlationId: "version-check",
    })).resolves.toMatchObject({ ok: false, code: "protocol_version_mismatch" });
    await expect(bridge.verifyNative({
      command: `${quote(process.execPath)} ${quote(wrongCorrelation)}`,
      correlationId: "correlation-check",
    })).resolves.toMatchObject({ ok: false, code: "correlation_mismatch" });
  });

  it("redacts bridge credentials from nonzero-exit diagnostics", async () => {
    const fixture = await createFixture(`
      process.stdin.resume();
      process.stderr.write('credential=' + process.env.CODEUX_CHAT_BRIDGE_TOKEN);
      process.exitCode = 17;
    `);
    const bridge = track(new ImessageNativeBridge());
    const result = await bridge.verifyNative({
      command: `${quote(process.execPath)} ${quote(fixture)}`,
      correlationId: "redaction-check",
      bridgeToken: "plain-fixture-credential",
    });

    expect(result).toMatchObject({ ok: false, code: "nonzero_exit" });
    expect(result.message).toContain("[REDACTED]");
    expect(result.message).not.toContain("plain-fixture-credential");
  });

  it("verifies a managed bridge through the same protocol without contacting Apple", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as ImessageBridgeEnvelope;
      expect(init?.headers).toMatchObject({ authorization: "Bearer managed-fixture-secret" });
      return Response.json({
        ...request,
        result: { status: "healthy", messageGuid: null, chatGuid: null, metadata: { fixture: true } },
      });
    });
    const bridge = track(new ImessageNativeBridge({ fetch: fetchMock }));

    const result = await bridge.verifyManaged({
      url: "https://third-party-bridge.example.test/health",
      bridgeApiKey: "managed-fixture-secret",
      correlationId: "managed-health",
    });
    const apple = await bridge.verifyManaged({
      url: "https://api.apple.com/messages",
      bridgeApiKey: "managed-fixture-secret",
      correlationId: "apple-health",
    });

    expect(result).toMatchObject({ ok: true, code: "healthy", protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION });
    expect(apple).toMatchObject({ ok: false, code: "provider_native_verification_unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function sendRequest(correlationId: string): ImessageBridgeEnvelope {
  return {
    protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
    operation: "send",
    correlation: { id: correlationId },
    message: { guid: "local-message-guid", text: "Fixture message", timestamp: null },
    chat: { guid: "chat-guid", name: "Fixture chat" },
    sender: { id: null, name: null },
    reply: { messageGuid: "reply-guid", threadId: "thread-id" },
    result: null,
    error: null,
  };
}

function responseFixture(overrides: { protocolVersion?: string; correlationId?: string }): string {
  return `
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      const request = JSON.parse(input);
      process.stdout.write(JSON.stringify({
        ...request,
        protocolVersion: ${JSON.stringify(overrides.protocolVersion ?? IMESSAGE_BRIDGE_PROTOCOL_VERSION)},
        correlation: { id: ${JSON.stringify(overrides.correlationId)} || request.correlation.id },
        result: { status: 'healthy', messageGuid: null, chatGuid: null, metadata: {} },
      }));
    });
  `;
}

async function createFixture(source: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "code ux imessage fixture "));
  tempDirs.push(directory);
  const fixturePath = path.join(directory, "bridge fixture.cjs");
  await fs.writeFile(fixturePath, source, "utf8");
  return fixturePath;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function track(bridge: ImessageNativeBridge): ImessageNativeBridge {
  bridges.push(bridge);
  return bridge;
}

describe("ImessageNativeBridgeError", () => {
  it("retains stable machine-readable codes", () => {
    expect(new ImessageNativeBridgeError("cancelled", "cancelled", true)).toMatchObject({
      name: "ImessageNativeBridgeError",
      code: "cancelled",
      retryable: true,
    });
  });
});
