import { randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import * as path from "node:path";
import type { CustomNodeHttpPolicy, CustomNodeHttpRequest, CustomNodeHttpResponse } from "../../contracts/custom-node-types.js";
import { ValidationError } from "../../repositories/repository-utils.js";
import type { EgressPolicy, EgressPolicyService } from "../node-flows/egress-policy-service.js";

export const CUSTOM_NODE_EGRESS_SOCKET_DIRECTORY = "/run/codeux-egress";
const CUSTOM_NODE_EGRESS_SOCKET = `${CUSTOM_NODE_EGRESS_SOCKET_DIRECTORY}/egress.sock`;
const MAX_BRIDGE_REQUEST_BYTES = 2 * 1024 * 1024;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

interface BridgeRequest {
  token: string;
  request: CustomNodeHttpRequest;
}

interface BridgeResponse {
  ok: boolean;
  response?: CustomNodeHttpResponse;
  error?: string;
}

export interface CustomNodeEgressBrokerOptions {
  service: EgressPolicyService;
  policy: CustomNodeHttpPolicy;
  socketDirectory: string;
  rateLimitKey: string;
}

/** A per-invocation Unix-socket bridge into the shared host egress policy. */
export class CustomNodeEgressBroker {
  readonly token = randomBytes(32).toString("hex");
  readonly containerSocketPath = CUSTOM_NODE_EGRESS_SOCKET;
  private server: Server | undefined;
  private readonly socketPath: string;

  constructor(private readonly options: CustomNodeEgressBrokerOptions) {
    this.socketPath = path.join(options.socketDirectory, "egress.sock");
  }

  async start(): Promise<void> {
    await fs.mkdir(this.options.socketDirectory, { recursive: true, mode: 0o755 });
    await fs.rm(this.socketPath, { force: true });
    const server = createServer({ allowHalfOpen: true }, (socket) => this.handleConnection(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { server.off("listening", onListening); reject(error); };
      const onListening = (): void => { server.off("error", onError); resolve(); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.socketPath);
    });
    await fs.chmod(this.socketPath, 0o666);
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(this.socketPath, { force: true });
  }

  private handleConnection(socket: Socket): void {
    const chunks: Buffer[] = [];
    let size = 0;
    socket.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BRIDGE_REQUEST_BYTES) {
        socket.destroy(new ValidationError("Custom node HTTP bridge request exceeded its size limit."));
        return;
      }
      chunks.push(chunk);
    });
    socket.once("end", () => {
      void this.respond(socket, Buffer.concat(chunks).toString("utf8"));
    });
    socket.on("error", () => undefined);
  }

  private async respond(socket: Socket, payload: string): Promise<void> {
    let bridgeResponse: BridgeResponse;
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (!isBridgeRequest(parsed) || !safeTokenEquals(parsed.token, this.token)) {
        throw new ValidationError("Custom node HTTP bridge request is unauthorized or invalid.");
      }
      const response = await this.options.service.request({
        ...parsed.request,
        policy: toEgressPolicy(this.options.policy),
        rateLimitKey: this.options.rateLimitKey,
      });
      bridgeResponse = {
        ok: true,
        response: { status: response.status, headers: response.headers, body: response.text() },
      };
    } catch (error) {
      bridgeResponse = { ok: false, error: error instanceof Error ? error.message : "Custom node HTTP request failed." };
    }
    socket.end(JSON.stringify(bridgeResponse));
  }
}

function toEgressPolicy(policy: CustomNodeHttpPolicy): EgressPolicy {
  return {
    allowHttp: policy.allowHttp,
    allowedHosts: policy.allowedHosts,
    allowedPorts: policy.allowedPorts,
    maxRedirects: policy.maxRedirects,
    maxResponseBytes: policy.maxResponseBytes,
    allowedContentTypes: policy.allowedContentTypes,
    timeoutMs: policy.timeoutMs,
    maxRetries: policy.maxRetries,
    requestsPerMinute: policy.maxRequests,
  };
}

function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.token !== "string" || !candidate.request || typeof candidate.request !== "object" || Array.isArray(candidate.request)) return false;
  const request = candidate.request as Record<string, unknown>;
  return typeof request.url === "string"
    && (request.method === undefined || (typeof request.method === "string" && ALLOWED_METHODS.has(request.method)))
    && (request.body === undefined || typeof request.body === "string")
    && (request.headers === undefined || isStringRecord(request.headers));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
}

function safeTokenEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}
