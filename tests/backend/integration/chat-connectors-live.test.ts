import { describe, expect, it, vi } from "vitest";

type LiveProvider = "whatsapp" | "telegram" | "slack" | "discord";

interface LiveAcceptanceResult {
  provider: LiveProvider;
  source: "official-endpoint";
  endpoint: string;
  outcome: "passed" | "failed";
}

const LIVE_ENABLED = process.env.CODEUX_CHAT_CONNECTOR_LIVE_TESTS === "1";
const META_TOKEN = process.env.CODEUX_CHAT_CONNECTOR_META_ACCESS_TOKEN;
const META_VERSION = process.env.CODEUX_CHAT_CONNECTOR_META_GRAPH_API_VERSION;
const META_PHONE_NUMBER_ID = process.env.CODEUX_CHAT_CONNECTOR_META_PHONE_NUMBER_ID;
const TELEGRAM_TOKEN = process.env.CODEUX_CHAT_CONNECTOR_TELEGRAM_BOT_TOKEN;
const SLACK_TOKEN = process.env.CODEUX_CHAT_CONNECTOR_SLACK_BOT_TOKEN;
const DISCORD_TOKEN = process.env.CODEUX_CHAT_CONNECTOR_DISCORD_BOT_TOKEN;
const WHATSAPP_SEND_ENABLED = process.env.CODEUX_CHAT_CONNECTOR_WHATSAPP_TEST_SEND === "1";
const META_TEST_PHONE_NUMBER_ID = process.env.CODEUX_CHAT_CONNECTOR_META_TEST_PHONE_NUMBER_ID;
const META_TEST_RECIPIENT = process.env.CODEUX_CHAT_CONNECTOR_META_TEST_RECIPIENT;

const acceptanceResults: LiveAcceptanceResult[] = [];

describe("chat connector live harness safety", () => {
  it("rejects non-HTTPS, redirects, disallowed hosts, production-looking fixtures, and unsupported live providers", async () => {
    expect(() => assertAllowedProviderUrl("http://api.telegram.org/botfixture/getMe", "telegram")).toThrow("HTTPS");
    expect(() => assertAllowedProviderUrl("https://example.com/api/auth.test", "slack")).toThrow("allowlist");
    expect(() => assertLiveFixtureLabel("production customer channel")).toThrow("production-looking");
    expect(() => buildUnsupportedLiveRequest("microsoft-teams")).toThrow("not supported");
    expect(() => buildUnsupportedLiveRequest("imessage")).toThrow("not supported");

    const redirectFetch: typeof fetch = async () => new Response(null, {
      status: 302,
      headers: { location: "https://example.com/credential-capture" },
    });
    await expect(safeProviderFetch("https://slack.com/api/auth.test", "slack", { method: "POST" }, redirectFetch))
      .rejects.toThrow("redirect");
  });

  it("rejects fixture-like Meta access tokens before lookup or send network requests", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(requestMetaPhoneNumberResource({
      accessToken: "fixture-meta-access-token",
      graphApiVersion: "v23.0",
      phoneNumberId: "109876543210987",
    }, fetchImplementation)).rejects.toThrow("deterministic fixture value");
    await expect(requestMetaTestMessage({
      accessToken: "example-meta-access-token",
      graphApiVersion: "v23.0",
      testPhoneNumberId: "109876543210987",
      testRecipient: "15550000101",
    }, fetchImplementation)).rejects.toThrow("deterministic fixture value");

    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("credential-gated official chat connector evidence", () => {
  it.skipIf(!LIVE_ENABLED || !META_TOKEN || !META_VERSION || !META_PHONE_NUMBER_ID)(
    liveTitle("WhatsApp phone-number resource", Boolean(META_TOKEN && META_VERSION && META_PHONE_NUMBER_ID)),
    async () => {
      const endpoint = "https://graph.facebook.com/{version}/{phone-number-id}";
      const response = await requestMetaPhoneNumberResource({
        accessToken: META_TOKEN!,
        graphApiVersion: META_VERSION!,
        phoneNumberId: META_PHONE_NUMBER_ID!,
      });
      await recordOfficialOutcome("whatsapp", endpoint, response, async () => {
        const body = await response.json() as { id?: unknown };
        expect(body.id).toBe(META_PHONE_NUMBER_ID);
      });
    },
  );

  it.skipIf(!LIVE_ENABLED || !TELEGRAM_TOKEN)(
    liveTitle("Telegram getMe", Boolean(TELEGRAM_TOKEN)),
    async () => {
      assertOpaqueCredential(TELEGRAM_TOKEN!);
      const endpoint = "https://api.telegram.org/bot[redacted]/getMe";
      const response = await requestOfficialEndpoint("telegram", `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`, endpoint, { method: "GET" });
      await recordOfficialOutcome("telegram", endpoint, response, async () => {
        const body = await response.json() as { ok?: unknown; result?: { is_bot?: unknown } };
        expect(body).toMatchObject({ ok: true, result: { is_bot: true } });
      });
    },
  );

  it.skipIf(!LIVE_ENABLED || !SLACK_TOKEN)(
    liveTitle("Slack auth.test", Boolean(SLACK_TOKEN)),
    async () => {
      assertOpaqueCredential(SLACK_TOKEN!);
      const endpoint = "https://slack.com/api/auth.test";
      const response = await requestOfficialEndpoint("slack", endpoint, endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${SLACK_TOKEN}`, "content-type": "application/x-www-form-urlencoded" },
        body: "",
      });
      await recordOfficialOutcome("slack", endpoint, response, async () => {
        const body = await response.json() as { ok?: unknown };
        expect(body.ok).toBe(true);
      });
    },
  );

  it.skipIf(!LIVE_ENABLED || !DISCORD_TOKEN)(
    liveTitle("Discord current user", Boolean(DISCORD_TOKEN)),
    async () => {
      assertOpaqueCredential(DISCORD_TOKEN!);
      const endpoint = "https://discord.com/api/v10/users/@me";
      const response = await requestOfficialEndpoint("discord", endpoint, endpoint, {
        method: "GET",
        headers: { authorization: `Bot ${DISCORD_TOKEN}` },
      });
      await recordOfficialOutcome("discord", endpoint, response, async () => {
        const body = await response.json() as { id?: unknown; bot?: unknown };
        expect(typeof body.id).toBe("string");
        expect(body.bot).toBe(true);
      });
    },
  );

  it.skipIf(
    !LIVE_ENABLED
    || !WHATSAPP_SEND_ENABLED
    || !META_TOKEN
    || !META_VERSION
    || !META_TEST_PHONE_NUMBER_ID
    || !META_TEST_RECIPIENT
  )(
    liveTitle("WhatsApp explicit test-number send", Boolean(
      WHATSAPP_SEND_ENABLED && META_TOKEN && META_VERSION && META_TEST_PHONE_NUMBER_ID && META_TEST_RECIPIENT,
    )),
    async () => {
      const endpoint = "https://graph.facebook.com/{version}/{test-phone-number-id}/messages";
      const response = await requestMetaTestMessage({
        accessToken: META_TOKEN!,
        graphApiVersion: META_VERSION!,
        testPhoneNumberId: META_TEST_PHONE_NUMBER_ID!,
        testRecipient: META_TEST_RECIPIENT!,
      });
      await recordOfficialOutcome("whatsapp", endpoint, response, async () => {
        const body = await response.json() as { messages?: Array<{ id?: unknown }> };
        expect(typeof body.messages?.[0]?.id).toBe("string");
      });
    },
  );
});

function liveTitle(check: string, credentialsPresent: boolean): string {
  if (!LIVE_ENABLED) return `${check} (skipped: CODEUX_CHAT_CONNECTOR_LIVE_TESTS is not 1)`;
  if (!credentialsPresent) return `${check} (skipped: sanitized test credentials are missing)`;
  return check;
}

function allowedHosts(provider: LiveProvider): readonly string[] {
  switch (provider) {
    case "whatsapp": return ["graph.facebook.com"];
    case "telegram": return ["api.telegram.org"];
    case "slack": return ["slack.com"];
    case "discord": return ["discord.com"];
  }
}

export function assertAllowedProviderUrl(value: string, provider: LiveProvider): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Live connector endpoints must use HTTPS.");
  if (!allowedHosts(provider).includes(url.hostname)) throw new Error(`Live ${provider} endpoint is outside the provider allowlist.`);
  if (url.username || url.password) throw new Error("Live connector endpoints must not contain URL credentials.");
  return url;
}

async function safeProviderFetch(
  value: string,
  provider: LiveProvider,
  init: RequestInit,
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const url = assertAllowedProviderUrl(value, provider);
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(`Live ${provider} request failed before a sanitized response was available.`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Live ${provider} request rejected a redirect.`);
  }
  return response;
}

async function requestOfficialEndpoint(
  provider: LiveProvider,
  url: string,
  endpoint: string,
  init: RequestInit,
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<Response> {
  try {
    return await safeProviderFetch(url, provider, init, fetchImplementation);
  } catch (error) {
    recordAcceptanceResult({ provider, source: "official-endpoint", endpoint, outcome: "failed" });
    throw error;
  }
}

async function requestMetaPhoneNumberResource(
  input: {
    accessToken: string;
    graphApiVersion: string;
    phoneNumberId: string;
  },
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<Response> {
  assertOpaqueCredential(input.accessToken);
  if (!/^v\d{1,3}\.\d{1,2}$/.test(input.graphApiVersion) || !/^\d+$/.test(input.phoneNumberId)) {
    throw new Error("Meta live fixture version and phone-number id must use provider-shaped test values.");
  }
  const endpoint = "https://graph.facebook.com/{version}/{phone-number-id}";
  const url = `https://graph.facebook.com/${input.graphApiVersion}/${input.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`;
  return requestOfficialEndpoint("whatsapp", url, endpoint, {
    method: "GET",
    headers: { authorization: `Bearer ${input.accessToken}` },
  }, fetchImplementation);
}

async function requestMetaTestMessage(
  input: {
    accessToken: string;
    graphApiVersion: string;
    testPhoneNumberId: string;
    testRecipient: string;
  },
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<Response> {
  assertOpaqueCredential(input.accessToken);
  if (
    !/^v\d{1,3}\.\d{1,2}$/.test(input.graphApiVersion)
    || !/^\d+$/.test(input.testPhoneNumberId)
    || !/^\d{5,20}$/.test(input.testRecipient)
  ) {
    throw new Error("WhatsApp sends require numeric Meta test-number and test-recipient variables.");
  }
  const endpoint = "https://graph.facebook.com/{version}/{test-phone-number-id}/messages";
  const url = `https://graph.facebook.com/${input.graphApiVersion}/${input.testPhoneNumberId}/messages`;
  return requestOfficialEndpoint("whatsapp", url, endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.testRecipient,
      type: "text",
      text: { preview_url: false, body: "Code UX connector test-number acceptance check" },
    }),
  }, fetchImplementation);
}

async function recordOfficialOutcome(
  provider: LiveProvider,
  endpoint: string,
  response: Response,
  assertBody: () => Promise<void>,
): Promise<void> {
  const result: LiveAcceptanceResult = {
    provider,
    source: "official-endpoint",
    endpoint,
    outcome: "failed",
  };
  try {
    expect(response.ok, `Official ${provider} endpoint returned HTTP ${response.status}.`).toBe(true);
    await assertBody();
    result.outcome = "passed";
  } finally {
    recordAcceptanceResult(result);
  }
  expect(acceptanceResults.at(-1)).toEqual(result);
}

function recordAcceptanceResult(result: LiveAcceptanceResult): void {
  acceptanceResults.push(result);
  // This intentionally records only a fixed, credential-free endpoint label.
  console.info(`[chat-connector-live] provider=${result.provider} source=${result.source} endpoint=${result.endpoint} outcome=${result.outcome}`);
}

function assertOpaqueCredential(value: string): void {
  if (!value.trim() || /fixture|example|replace|changeme/i.test(value)) {
    throw new Error("Live connector credential is empty or looks like a deterministic fixture value.");
  }
}

function assertLiveFixtureLabel(value: string): void {
  if (/\b(?:prod|production|customer|personal|live)\b/i.test(value)) {
    throw new Error("Live connector harness rejected a production-looking fixture value.");
  }
}

function buildUnsupportedLiveRequest(provider: "microsoft-teams" | "imessage"): never {
  throw new Error(`Provider-controlled live requests are not supported for ${provider}.`);
}
