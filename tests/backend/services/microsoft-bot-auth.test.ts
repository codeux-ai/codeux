import {
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MICROSOFT_BOT_ISSUER,
  MICROSOFT_BOT_JWKS_URL,
  MICROSOFT_BOT_OPENID_METADATA_URL,
  MICROSOFT_BOT_TOKEN_SCOPE,
  MicrosoftBotAuthError,
  MicrosoftBotAuthService,
  isAllowedMicrosoftBotServiceUrl,
  type MicrosoftBotCredentials,
} from "../../../src/services/chat-providers/microsoft-bot-auth.js";

const NOW = new Date("2026-07-13T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const SERVICE_URL = "https://smba.trafficmanager.net/teams";

let privateKey1: KeyObject;
let privateKey2: KeyObject;
let jwk1: Record<string, unknown>;
let jwk2: Record<string, unknown>;

beforeAll(() => {
  ({ privateKey: privateKey1, jwk: jwk1 } = createSigningFixture("key-1"));
  ({ privateKey: privateKey2, jwk: jwk2 } = createSigningFixture("key-2"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MicrosoftBotAuthService inbound authentication", () => {
  it("validates a signed Connector JWT and returns a durable, secret-free conversation reference", async () => {
    const fetchMock = microsoftSigningFetch(() => [jwk1]);
    const service = new MicrosoftBotAuthService({ fetch: fetchMock, now: () => NOW });
    const activity = activityFixture();
    const token = signJwt(privateKey1, "key-1", claimsFixture());

    const result = await service.validateIncomingActivity({
      authorization: `Bearer ${token}`,
      activity,
      credentials: credentials(),
    });

    expect(result.normalized.textBody).toBe("run the checks");
    expect(result.conversationReference).toMatchObject({
      serviceUrl: SERVICE_URL,
      serviceUrlValidated: true,
      activityId: "activity-1",
      channelId: "msteams",
      tenantId: "tenant-1",
      teamId: "team-1",
      teamsChannelId: "channel-1",
      conversation: { id: "conversation-1" },
      bot: { id: "bot-app-id" },
      user: { id: "user-1" },
    });
    expect(result.ingressPayload.microsoftTeamsConversationReference).toEqual(result.conversationReference);
    expect(JSON.stringify(result.ingressPayload)).not.toContain(token);
    expect(JSON.stringify(result.ingressPayload)).not.toContain("client-secret");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["wrong audience", { claims: { aud: "another-app" } }, "jwt_audience_invalid"],
    ["wrong issuer", { claims: { iss: "https://issuer.example.test" } }, "jwt_issuer_invalid"],
    ["expired JWT", { claims: { exp: NOW_SECONDS - 301 } }, "jwt_expired"],
    ["future JWT", { claims: { nbf: NOW_SECONDS + 301 } }, "jwt_not_yet_valid"],
    ["wrong algorithm", { header: { alg: "HS256" } }, "jwt_algorithm_invalid"],
    ["service URL mismatch", { claims: { serviceUrl: `${SERVICE_URL}/wrong` } }, "service_url_mismatch"],
    ["bad signature", { signingKey: "second" }, "jwt_signature_invalid"],
  ] as const)("rejects %s", async (_label, mutation, expectedCode) => {
    const service = new MicrosoftBotAuthService({ fetch: microsoftSigningFetch(() => [jwk1]), now: () => NOW });
    const claims = { ...claimsFixture(), ...(mutation.claims ?? {}) };
    const token = signJwt(
      mutation.signingKey === "second" ? privateKey2 : privateKey1,
      "key-1",
      claims,
      mutation.header,
    );

    await expectAuthCode(service.validateIncomingActivity({
      authorization: `Bearer ${token}`,
      activity: activityFixture(),
      credentials: credentials(),
    }), expectedCode);
  });

  it("rejects a missing channel endorsement", async () => {
    const unendorsed = { ...jwk1, endorsements: ["webchat"] };
    const service = new MicrosoftBotAuthService({ fetch: microsoftSigningFetch(() => [unendorsed]), now: () => NOW });

    await expectAuthCode(service.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey1, "key-1", claimsFixture())}`,
      activity: activityFixture(),
      credentials: credentials(),
    }), "channel_endorsement_missing");
  });

  it("rejects a wrong tenant and an authenticated but undocumented service URL", async () => {
    const service = new MicrosoftBotAuthService({ fetch: microsoftSigningFetch(() => [jwk1]), now: () => NOW });
    await expectAuthCode(service.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey1, "key-1", claimsFixture())}`,
      activity: activityFixture(),
      credentials: { ...credentials(), tenantId: "tenant-2" },
    }), "tenant_mismatch");

    const evilUrl = "https://metadata.internal.example/teams";
    const evilActivity = { ...activityFixture(), serviceUrl: evilUrl };
    await expectAuthCode(service.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey1, "key-1", { ...claimsFixture(), serviceUrl: evilUrl })}`,
      activity: evilActivity,
      credentials: credentials(),
    }), "service_url_invalid");

    const arbitraryBotFrameworkUrl = "https://arbitrary.botframework.com/teams";
    await expectAuthCode(service.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey1, "key-1", {
        ...claimsFixture(),
        serviceUrl: arbitraryBotFrameworkUrl,
      })}`,
      activity: { ...activityFixture(), serviceUrl: arbitraryBotFrameworkUrl },
      credentials: credentials(),
    }), "service_url_invalid");
  });

  it("refreshes once for key rotation, bounds unknown-key refreshes, and refreshes expired caches", async () => {
    let now = new Date(NOW);
    let keys = [jwk1];
    const fetchMock = microsoftSigningFetch(() => keys);
    const service = new MicrosoftBotAuthService({
      fetch: fetchMock,
      now: () => now,
      signingKeyCacheMs: 60 * 60 * 1000,
      unknownKeyRefreshIntervalMs: 5 * 60 * 1000,
    });

    await service.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey1, "key-1", claimsFixture())}`,
      activity: activityFixture(),
      credentials: credentials(),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    keys = [jwk2];
    await service.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey2, "key-2", claimsFixture())}`,
      activity: activityFixture(),
      credentials: credentials(),
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    now = new Date(NOW.getTime() + 5 * 60 * 1000);
    const unknownToken = signJwt(privateKey2, "unknown-key", claimsFixture());
    await expectAuthCode(service.validateIncomingActivity({
      authorization: `Bearer ${unknownToken}`,
      activity: activityFixture(),
      credentials: credentials(),
    }), "signing_key_unknown");
    await expectAuthCode(service.validateIncomingActivity({
      authorization: `Bearer ${unknownToken}`,
      activity: activityFixture(),
      credentials: credentials(),
    }), "signing_key_unknown");
    expect(fetchMock).toHaveBeenCalledTimes(6);

    now = new Date(NOW.getTime() + 65 * 60 * 1000 + 1);
    await service.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey2, "key-2", claimsFixture({ exp: NOW_SECONDS + 7200 }))}`,
      activity: activityFixture(),
      credentials: credentials(),
    });
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("rejects expired signing keys with a deterministic diagnostic code", async () => {
    const expiredKey = { ...jwk1, exp: NOW_SECONDS - 301 };
    const service = new MicrosoftBotAuthService({ fetch: microsoftSigningFetch(() => [expiredKey]), now: () => NOW });
    await expectAuthCode(service.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey1, "key-1", claimsFixture())}`,
      activity: activityFixture(),
      credentials: credentials(),
    }), "signing_key_expired");
  });

  it("fails closed when fixed metadata or JWKS retrieval fails", async () => {
    const invalidMetadataFetch = vi.fn<typeof fetch>(async () => jsonResponse({
      issuer: MICROSOFT_BOT_ISSUER,
      jwks_uri: "https://attacker.example/keys",
      id_token_signing_alg_values_supported: ["RS256"],
    }));
    const invalidMetadataService = new MicrosoftBotAuthService({ fetch: invalidMetadataFetch, now: () => NOW });
    await expectAuthCode(invalidMetadataService.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey1, "key-1", claimsFixture())}`,
      activity: activityFixture(),
      credentials: credentials(),
    }), "openid_metadata_failed");
    expect(invalidMetadataFetch).toHaveBeenCalledTimes(1);

    const jwksFetch = vi.fn<typeof fetch>(async (input) => String(input) === MICROSOFT_BOT_OPENID_METADATA_URL
      ? metadataResponse()
      : new Response("unavailable", { status: 502 }));
    const jwksService = new MicrosoftBotAuthService({ fetch: jwksFetch, now: () => NOW });
    await expectAuthCode(jwksService.validateIncomingActivity({
      authorization: `Bearer ${signJwt(privateKey1, "key-1", claimsFixture())}`,
      activity: activityFixture(),
      credentials: credentials(),
    }), "microsoft_service_unavailable");
  });
});

describe("MicrosoftBotAuthService outbound transport", () => {
  it("caches OAuth tokens only until safe pre-expiry", async () => {
    let now = new Date(NOW);
    let requestCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      token_type: "Bearer",
      expires_in: 3600,
      access_token: `access-${++requestCount}`,
    }));
    const service = new MicrosoftBotAuthService({ fetch: fetchMock, now: () => now });

    expect(await service.acquireAccessToken(credentials())).toBe("access-1");
    now = new Date(NOW.getTime() + 54 * 60 * 1000);
    expect(await service.acquireAccessToken(credentials())).toBe("access-1");
    now = new Date(NOW.getTime() + 55 * 60 * 1000);
    expect(await service.acquireAccessToken(credentials())).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, init] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    expect(String(init?.body)).toContain(`scope=${encodeURIComponent(MICROSOFT_BOT_TOKEN_SCOPE)}`);
  });

  it("sends replies to the validated conversation activity path with a cached bearer token", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("login.microsoftonline.com")) {
        return jsonResponse({ token_type: "Bearer", expires_in: 3600, access_token: "access-token" });
      }
      return jsonResponse({ id: "reply-activity-1" }, 201);
    });
    const service = new MicrosoftBotAuthService({ fetch: fetchMock, now: () => NOW });

    const result = await service.sendReply({
      credentials: credentials(),
      conversationReference: conversationReference(),
      text: "Build passed.",
      correlationId: "correlation-1",
    });

    expect(result).toEqual({ externalMessageId: "reply-activity-1", statusCode: 201 });
    expect(requests[1].url).toBe(
      "https://smba.trafficmanager.net/teams/v3/conversations/conversation-1/activities/activity-1",
    );
    expect(new Headers(requests[1].init?.headers).get("authorization")).toBe("Bearer access-token");
    expect(JSON.parse(String(requests[1].init?.body))).toMatchObject({
      type: "message",
      from: { id: "bot-app-id" },
      recipient: { id: "user-1" },
      conversation: { id: "conversation-1" },
      replyToId: "activity-1",
      text: "Build passed.",
      channelData: { tenant: { id: "tenant-1" } },
    });
  });

  it("rejects unvalidated reply references and classifies throttling and unavailable services", async () => {
    const replyFetch = vi.fn<typeof fetch>();
    const service = new MicrosoftBotAuthService({ fetch: replyFetch, now: () => NOW });
    await expectAuthCode(service.sendReply({
      credentials: credentials(),
      conversationReference: { ...conversationReference(), serviceUrl: "https://attacker.example" },
      text: "No",
    }), "service_url_invalid");
    await expectAuthCode(service.sendReply({
      credentials: credentials(),
      conversationReference: {
        ...conversationReference(),
        serviceUrl: "https://arbitrary.botframework.com/teams",
      },
      text: "Still no",
    }), "service_url_invalid");
    expect(replyFetch).not.toHaveBeenCalled();

    const throttled = new MicrosoftBotAuthService({
      fetch: vi.fn<typeof fetch>(async () => new Response("slow down", {
        status: 429,
        headers: { "retry-after": "3" },
      })),
      now: () => NOW,
    });
    try {
      await throttled.acquireAccessToken(credentials());
      throw new Error("Expected throttling failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "microsoft_throttled", retryable: true, retryAfterMs: 3000 });
    }

    const unavailable = new MicrosoftBotAuthService({
      fetch: vi.fn<typeof fetch>(async () => new Response("offline", { status: 503 })),
      now: () => NOW,
    });
    await expectAuthCode(unavailable.acquireAccessToken(credentials()), "microsoft_service_unavailable");
  });

  it("aborts timed-out Microsoft requests", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const service = new MicrosoftBotAuthService({ fetch: fetchMock, now: () => NOW, requestTimeoutMs: 25 });
    const request = service.acquireAccessToken(credentials());
    const assertion = expectAuthCode(request, "microsoft_service_unavailable");

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("returns deterministic app, token, and signing metadata diagnostics", async () => {
    const invalid = new MicrosoftBotAuthService({ fetch: vi.fn(), now: () => NOW });
    const invalidResult = await invalid.diagnoseConnection({ ...credentials(), microsoftAppId: "" });
    expect(invalidResult).toEqual({
      ok: false,
      checks: [{
        check: "app_identity",
        ok: false,
        code: "app_identity_invalid",
        message: "Microsoft app ID is required.",
        retryable: false,
      }],
    });

    const diagnosticFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("login.microsoftonline.com")) {
        return jsonResponse({ token_type: "Bearer", expires_in: 3600, access_token: "token" });
      }
      if (String(input) === MICROSOFT_BOT_OPENID_METADATA_URL) {
        return metadataResponse();
      }
      return jsonResponse({ keys: [jwk1] });
    });
    const healthy = new MicrosoftBotAuthService({ fetch: diagnosticFetch, now: () => NOW });
    const result = await healthy.diagnoseConnection(credentials());
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => [check.check, check.code])).toEqual([
      ["app_identity", "ok"],
      ["token_acquisition", "ok"],
      ["signing_metadata", "ok"],
    ]);
  });

  it.each([
    [
      "expired",
      () => [{ ...jwk1, exp: NOW_SECONDS - 301 }],
      "signing_key_expired",
      "published no currently active signing keys",
    ],
    [
      "otherwise unusable",
      () => [{
        kid: "unusable-key",
        kty: "RSA",
        alg: "RS256",
        use: "sig",
        key_ops: ["verify"],
        endorsements: ["msteams"],
      }],
      "signing_keys_unusable",
      "published no usable Microsoft Teams signing keys",
    ],
  ] as const)("reports %s signing-key metadata", async (_label, signingKeys, code, message) => {
    const diagnosticFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("login.microsoftonline.com")) {
        return jsonResponse({ token_type: "Bearer", expires_in: 3600, access_token: "token" });
      }
      if (String(input) === MICROSOFT_BOT_OPENID_METADATA_URL) {
        return metadataResponse();
      }
      return jsonResponse({ keys: signingKeys() });
    });
    const service = new MicrosoftBotAuthService({ fetch: diagnosticFetch, now: () => NOW });

    const result = await service.diagnoseConnection(credentials());

    expect(result.ok).toBe(false);
    expect(result.checks[2]).toMatchObject({
      check: "signing_metadata",
      ok: false,
      code,
      message: expect.stringContaining(message),
      retryable: true,
    });
  });
});

describe("Microsoft Bot service URL policy", () => {
  it("allows documented Bot Framework hosts and rejects client-supplied or local URLs", () => {
    expect(isAllowedMicrosoftBotServiceUrl(SERVICE_URL)).toBe(true);
    expect(isAllowedMicrosoftBotServiceUrl("https://smba.infra.gcc.teams.microsoft.com/teams")).toBe(true);
    expect(isAllowedMicrosoftBotServiceUrl("https://smba.infra.gov.teams.microsoft.us/teams")).toBe(true);
    expect(isAllowedMicrosoftBotServiceUrl("https://smba.infra.dod.teams.microsoft.us/teams")).toBe(true);
    expect(isAllowedMicrosoftBotServiceUrl("https://msteams.botframework.com/amer")).toBe(false);
    expect(isAllowedMicrosoftBotServiceUrl("https://arbitrary.botframework.com/teams")).toBe(false);
    expect(isAllowedMicrosoftBotServiceUrl("http://localhost:3978")).toBe(false);
    expect(isAllowedMicrosoftBotServiceUrl("https://smba.trafficmanager.net.evil.example/teams")).toBe(false);
    expect(isAllowedMicrosoftBotServiceUrl("https://smba.trafficmanager.net:8443/teams")).toBe(false);
  });
});

function createSigningFixture(kid: string): {
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
} {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey,
    jwk: {
      ...publicKey.export({ format: "jwk" }),
      kid,
      alg: "RS256",
      use: "sig",
      key_ops: ["verify"],
      endorsements: ["msteams"],
    },
  };
}

function signJwt(
  privateKey: KeyObject,
  kid: string,
  claims: Record<string, unknown>,
  headerOverrides: Record<string, unknown> = {},
): string {
  const header = encodeJson({ typ: "JWT", alg: "RS256", kid, ...headerOverrides });
  const payload = encodeJson(claims);
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString("base64url")}`;
}

function encodeJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function claimsFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: MICROSOFT_BOT_ISSUER,
    aud: "bot-app-id",
    nbf: NOW_SECONDS - 60,
    iat: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 3600,
    serviceUrl: SERVICE_URL,
    ...overrides,
  };
}

function activityFixture(): Record<string, unknown> {
  return {
    type: "message",
    id: "activity-1",
    serviceUrl: SERVICE_URL,
    channelId: "msteams",
    locale: "en-US",
    timestamp: NOW.toISOString(),
    from: { id: "user-1", aadObjectId: "aad-user-1", name: "Taylor" },
    recipient: { id: "bot-app-id", name: "Code UX" },
    conversation: { id: "conversation-1", name: "Engineering", conversationType: "channel", isGroup: true },
    channelData: {
      tenant: { id: "tenant-1" },
      team: { id: "team-1" },
      channel: { id: "channel-1", name: "Engineering" },
    },
    text: "<at>Code UX</at> run the checks",
    entities: [{
      type: "mention",
      text: "<at>Code UX</at>",
      mentioned: { id: "bot-app-id", name: "Code UX" },
    }],
  };
}

function credentials(): MicrosoftBotCredentials {
  return {
    microsoftAppId: "bot-app-id",
    applicationType: "SingleTenant",
    tenantId: "tenant-1",
    clientSecret: "client-secret",
  };
}

function conversationReference() {
  return {
    activityId: "activity-1",
    serviceUrl: SERVICE_URL,
    serviceUrlValidated: true as const,
    channelId: "msteams",
    locale: "en-US",
    tenantId: "tenant-1",
    teamId: "team-1",
    teamsChannelId: "channel-1",
    conversation: { id: "conversation-1", name: "Engineering", conversationType: "channel", isGroup: true },
    bot: { id: "bot-app-id", name: "Code UX" },
    user: { id: "user-1", name: "Taylor" },
  };
}

function microsoftSigningFetch(keys: () => Record<string, unknown>[]): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input) => {
    if (String(input) === MICROSOFT_BOT_OPENID_METADATA_URL) {
      return metadataResponse();
    }
    if (String(input) === MICROSOFT_BOT_JWKS_URL) {
      return jsonResponse({ keys: keys() });
    }
    throw new Error(`Unexpected request: ${String(input)}`);
  });
}

function metadataResponse(): Response {
  return jsonResponse({
    issuer: MICROSOFT_BOT_ISSUER,
    jwks_uri: MICROSOFT_BOT_JWKS_URL,
    id_token_signing_alg_values_supported: ["RS256"],
  });
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function expectAuthCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected MicrosoftBotAuthError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(MicrosoftBotAuthError);
    expect(error).toMatchObject({ code });
  }
}
