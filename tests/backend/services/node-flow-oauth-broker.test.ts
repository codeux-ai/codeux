import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryOAuthConnectionStore, OAuthBroker } from "../../../src/services/node-flows/oauth-broker.js";

describe("OAuthBroker", () => {
  it("uses encrypted PKCE state, rotates refresh tokens, checks scopes, health, and revocation", async () => {
    const store = new InMemoryOAuthConnectionStore();
    const client = {
      exchangeCode: vi.fn().mockResolvedValue({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: new Date(Date.now() - 1).toISOString(), scopes: ["mail.send"] }),
      refresh: vi.fn().mockResolvedValue({ accessToken: "access-2", refreshToken: "refresh-2", expiresAt: new Date(Date.now() + 60_000).toISOString(), scopes: ["mail.send"] }),
      revoke: vi.fn().mockResolvedValue(undefined), health: vi.fn().mockResolvedValue(true),
    };
    const broker = new OAuthBroker({ key: randomBytes(32), store, client, allowedCallbackOrigins: ["https://app.example.test"] });
    const started = broker.beginAuthorization({ connectionId: "mail", authorizationUrl: "https://oauth.example.test/authorize", redirectUri: "https://app.example.test/oauth/callback", scopes: ["mail.send"] });
    expect(started.state).not.toContain("mail");
    expect(new URL(started.authorizationUrl).searchParams.get("code_challenge_method")).toBe("S256");
    await broker.completeAuthorization({ state: started.state, code: "code", callbackOrigin: "https://app.example.test" });
    await expect(broker.getAccessToken("mail", ["mail.send"])).resolves.toBe("access-2");
    await expect(broker.getAccessToken("mail", ["mail.read"])).rejects.toThrow(/scopes/i);
    await expect(broker.health("mail")).resolves.toMatchObject({ healthy: true, scopes: ["mail.send"] });
    await broker.revoke("mail");
    await expect(broker.health("mail")).resolves.toMatchObject({ healthy: false });
    expect(client.revoke).toHaveBeenCalled();
  });

  it("rejects callback-origin mismatches and tampered state", async () => {
    const broker = new OAuthBroker({ key: randomBytes(32), store: new InMemoryOAuthConnectionStore(), client: { exchangeCode: vi.fn(), refresh: vi.fn() }, allowedCallbackOrigins: ["https://app.example.test"] });
    const started = broker.beginAuthorization({ connectionId: "x", authorizationUrl: "https://oauth.example.test", redirectUri: "https://app.example.test/callback", scopes: [] });
    await expect(broker.completeAuthorization({ state: `${started.state}x`, code: "x", callbackOrigin: "https://app.example.test" })).rejects.toThrow(/state is invalid/i);
    await expect(broker.completeAuthorization({ state: started.state, code: "x", callbackOrigin: "https://evil.example.test" })).rejects.toThrow(/not allowlisted/i);
  });
});
