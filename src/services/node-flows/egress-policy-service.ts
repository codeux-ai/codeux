import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "../../repositories/repository-utils.js";

const RESTRICTED_HEADERS = new Set([
  "authorization", "cookie", "host", "proxy-authorization", "proxy-connection",
  "connection", "transfer-encoding", "upgrade", "x-forwarded-for", "x-real-ip",
]);
const DEFAULT_CONTENT_TYPES = ["application/json", "text/"];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface EgressPolicy {
  allowHttp?: boolean;
  allowedHosts?: string[];
  allowedPorts?: number[];
  maxRedirects?: number;
  maxResponseBytes?: number;
  allowedContentTypes?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  requestsPerMinute?: number;
}

export interface EgressRequest {
  url: string | URL;
  method?: string;
  headers?: Record<string, string>;
  credentialHeaders?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
  policy?: EgressPolicy;
  rateLimitKey?: string;
}

export interface EgressResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  contentType: string;
  body: Uint8Array;
  text(): string;
  json(): unknown;
}

export interface EgressPolicyServiceOptions {
  fetch?: typeof fetch;
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  defaults?: EgressPolicy;
}

export class EgressPolicyService {
  private readonly fetchImpl: typeof fetch;
  private readonly lookup: NonNullable<EgressPolicyServiceOptions["lookup"]>;
  private readonly defaults: EgressPolicy;
  private readonly rateWindows = new Map<string, number[]>();

  constructor(options: EgressPolicyServiceOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.lookup = options.lookup ?? (async (hostname) => dnsLookup(hostname, { all: true, verbatim: true }));
    this.defaults = options.defaults ?? {};
  }

  async request(input: EgressRequest): Promise<EgressResponse> {
    const policy = { ...this.defaults, ...input.policy };
    const method = (input.method ?? "GET").toUpperCase();
    const headers = normalizeRequestHeaders(input.headers, false);
    Object.assign(headers, normalizeRequestHeaders(input.credentialHeaders, true));
    this.enforceRateLimit(input.rateLimitKey ?? new URL(input.url).hostname, policy.requestsPerMinute ?? 60);

    const retries = Math.max(0, Math.min(5, Math.floor(policy.maxRetries ?? 0)));
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await this.requestWithRedirects(input.url, method, headers, input.body, input.signal, policy);
        if (!RETRYABLE_STATUSES.has(response.status) || attempt === retries || !isRetrySafe(method, headers)) return response;
      } catch (error) {
        lastError = error;
        if (attempt === retries || !isRetrySafe(method, headers) || error instanceof ValidationError) throw error;
      }
      await boundedBackoff(attempt, input.signal);
    }
    throw lastError instanceof Error ? lastError : new Error("Egress request failed.");
  }

  async validateUrl(value: string | URL, policy: EgressPolicy = {}): Promise<{ url: URL; addresses: string[] }> {
    let url: URL;
    try { url = new URL(value); } catch { throw new ValidationError("Egress URL is invalid."); }
    if (url.username || url.password) throw new ValidationError("Credentials in URLs are not allowed.");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && policy.allowHttp === true)) {
      throw new ValidationError("Egress URL must use HTTPS unless HTTP is explicitly enabled.");
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
      throw new ValidationError("Private, loopback, and metadata hosts are not allowed.");
    }
    const allowedHosts = policy.allowedHosts?.map((entry) => entry.toLowerCase());
    if (allowedHosts?.length && !allowedHosts.some((entry) => hostname === entry || (entry.startsWith("*.") && hostname.endsWith(entry.slice(1))))) {
      throw new ValidationError(`Egress host is not allowlisted: ${hostname}.`);
    }
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    const allowedPorts = policy.allowedPorts ?? (url.protocol === "https:" ? [443] : [80]);
    if (!Number.isInteger(port) || !allowedPorts.includes(port)) throw new ValidationError(`Egress port is not allowlisted: ${port}.`);

    const addresses = isIP(hostname)
      ? [hostname]
      : (await this.lookup(hostname)).map((entry) => entry.address);
    if (addresses.length === 0) throw new ValidationError("Egress host did not resolve to an address.");
    if (addresses.some(isBlockedAddress)) throw new ValidationError("Private, loopback, link-local, and metadata addresses are not allowed.");
    const rebound = isIP(hostname) ? addresses : (await this.lookup(hostname)).map((entry) => entry.address);
    if (rebound.length === 0 || !sameAddressSet(addresses, rebound) || rebound.some(isBlockedAddress)) {
      throw new ValidationError("DNS rebinding was detected for the egress host.");
    }
    return { url, addresses: [...new Set(addresses)].sort() };
  }

  private async requestWithRedirects(
    initialUrl: string | URL, method: string, headers: Record<string, string>, body: BodyInit | undefined,
    parentSignal: AbortSignal | undefined, policy: EgressPolicy,
  ): Promise<EgressResponse> {
    let current = (await this.validateUrl(initialUrl, policy)).url;
    const maxRedirects = Math.max(0, Math.min(10, Math.floor(policy.maxRedirects ?? 3)));
    let timeoutMs = 30_000;
    if (policy.timeoutMs !== undefined) {
      const requestedTimeoutMs = policy.timeoutMs;
      if (!Number.isFinite(requestedTimeoutMs) || requestedTimeoutMs < 1 || requestedTimeoutMs > 120_000) {
        throw new ValidationError("Egress timeout must be between 1 and 120000 milliseconds.");
      }
      timeoutMs = Math.floor(requestedTimeoutMs);
    }
    for (let redirects = 0; ; redirects += 1) {
      const controller = new AbortController();
      const abort = (): void => controller.abort(parentSignal?.reason);
      parentSignal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error(`Egress request timed out after ${timeoutMs}ms.`)), timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(current, { method, headers, body, redirect: "manual", signal: controller.signal });
        if (REDIRECT_STATUSES.has(response.status)) {
          if (redirects >= maxRedirects) throw new ValidationError("Egress redirect limit exceeded.");
          const location = response.headers.get("location");
          if (!location) throw new ValidationError("Egress redirect response omitted Location.");
          const next = new URL(location, current);
          if (next.origin !== current.origin) {
            delete headers.authorization;
            delete headers.cookie;
          }
          current = (await this.validateUrl(next, policy)).url;
          continue;
        }
        return await this.readResponse(response, current, policy);
      } finally {
        clearTimeout(timer); parentSignal?.removeEventListener("abort", abort);
      }
    }
  }

  private async readResponse(response: Response, url: URL, policy: EgressPolicy): Promise<EgressResponse> {
    const maxBytes = Math.max(1, Math.min(50 * 1024 * 1024, Math.floor(policy.maxResponseBytes ?? 2 * 1024 * 1024)));
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new ValidationError("Egress response exceeds the configured size limit.");
    const contentType = (response.headers.get("content-type") ?? "application/octet-stream").split(";", 1)[0]!.trim().toLowerCase();
    const allowed = policy.allowedContentTypes ?? DEFAULT_CONTENT_TYPES;
    if (response.status !== 204 && !allowed.some((entry) => contentType === entry || (entry.endsWith("/") && contentType.startsWith(entry)))) {
      throw new ValidationError(`Egress response content type is not allowed: ${contentType}.`);
    }
    const chunks: Uint8Array[] = []; let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new ValidationError("Egress response exceeds the configured size limit."); }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return {
      url: url.toString(), status: response.status, ok: response.ok,
      headers: Object.fromEntries([...response.headers].map(([key, value]) => [key.toLowerCase(), value])),
      contentType, body: bytes,
      text: () => new TextDecoder().decode(bytes),
      json: () => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    };
  }

  private enforceRateLimit(key: string, limit: number): void {
    const boundedLimit = Math.max(1, Math.min(10_000, Math.floor(limit)));
    const cutoff = Date.now() - 60_000;
    const recent = (this.rateWindows.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length >= boundedLimit) throw new ValidationError("Egress rate limit exceeded.");
    recent.push(Date.now()); this.rateWindows.set(key, recent);
  }
}

function normalizeRequestHeaders(input: Record<string, string> | undefined, trusted: boolean): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input ?? {})) {
    const name = rawName.trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\r\n]/.test(rawValue)) throw new ValidationError("Egress header is invalid.");
    if (!trusted && RESTRICTED_HEADERS.has(name)) throw new ValidationError(`Egress header is restricted: ${name}.`);
    if (name === "host" || name === "connection" || name.startsWith("proxy-")) throw new ValidationError(`Egress header is restricted: ${name}.`);
    result[name] = String(rawValue).trim();
  }
  return result;
}

function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0]!;
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isBlockedAddress(mapped);
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)
      || (a === 100 && b! >= 64 && b! <= 127) || (a === 192 && b === 0)
      || (a === 192 && b === 2) || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0);
  }
  return isIP(normalized) !== 6;
}
const sameAddressSet = (left: string[], right: string[]): boolean => [...new Set(left)].sort().join("|") === [...new Set(right)].sort().join("|");
const isRetrySafe = (method: string, headers: Record<string, string>): boolean => ["GET", "HEAD", "OPTIONS"].includes(method) || Boolean(headers["idempotency-key"]);
async function boundedBackoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const ms = Math.min(2_000, 100 * (2 ** attempt));
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); });
}
