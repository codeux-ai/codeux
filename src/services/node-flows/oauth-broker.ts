import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ValidationError } from "../../repositories/repository-utils.js";

export interface OAuthTokenSet {
  accessToken: string; refreshToken?: string; expiresAt: string; scopes: string[]; tokenType?: string;
}
export interface OAuthTokenClient {
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<OAuthTokenSet>;
  refresh(refreshToken: string): Promise<OAuthTokenSet>;
  revoke?(token: string): Promise<void>;
  health?(accessToken: string): Promise<boolean>;
}
export interface OAuthConnectionStore {
  get(connectionId: string): Promise<OAuthTokenSet | null> | OAuthTokenSet | null;
  set(connectionId: string, tokens: OAuthTokenSet): Promise<void> | void;
  delete(connectionId: string): Promise<void> | void;
}
interface OAuthStatePayload { connectionId: string; origin: string; redirectUri: string; verifier: string; expiresAt: number; nonce: string }

export class OAuthBroker {
  private readonly consumedStates = new Set<string>();
  constructor(private readonly input: { key: Buffer; store: OAuthConnectionStore; client: OAuthTokenClient; allowedCallbackOrigins: string[] }) {
    if (input.key.byteLength !== 32) throw new ValidationError("OAuth state encryption key must contain 32 bytes.");
  }

  beginAuthorization(input: { connectionId: string; authorizationUrl: string; redirectUri: string; scopes: string[] }): { authorizationUrl: string; state: string } {
    const redirect = new URL(input.redirectUri); this.assertCallbackOrigin(redirect.origin);
    const verifier = randomBytes(32).toString("base64url");
    const payload: OAuthStatePayload = { connectionId: input.connectionId, origin: redirect.origin, redirectUri: redirect.toString(), verifier, expiresAt: Date.now() + 10 * 60_000, nonce: randomBytes(16).toString("hex") };
    const state = this.encrypt(payload);
    const url = new URL(input.authorizationUrl);
    url.searchParams.set("response_type", "code"); url.searchParams.set("redirect_uri", redirect.toString());
    url.searchParams.set("scope", [...new Set(input.scopes)].sort().join(" ")); url.searchParams.set("state", state);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    return { authorizationUrl: url.toString(), state };
  }

  async completeAuthorization(input: { state: string; code: string; callbackOrigin: string }): Promise<{ connectionId: string; expiresAt: string; scopes: string[] }> {
    const state = this.decrypt(input.state);
    const stateDigest = createHash("sha256").update(input.state).digest("hex");
    if (this.consumedStates.has(stateDigest)) throw new ValidationError("OAuth authorization state has already been used.");
    this.assertCallbackOrigin(input.callbackOrigin);
    if (state.origin !== new URL(input.callbackOrigin).origin) throw new ValidationError("OAuth callback origin does not match authorization state.");
    if (state.expiresAt <= Date.now()) throw new ValidationError("OAuth authorization state has expired.");
    this.consumedStates.add(stateDigest);
    const tokens = normalizeTokens(await this.input.client.exchangeCode({ code: input.code, redirectUri: state.redirectUri, codeVerifier: state.verifier }));
    await this.input.store.set(state.connectionId, tokens);
    return { connectionId: state.connectionId, expiresAt: tokens.expiresAt, scopes: tokens.scopes };
  }

  async getAccessToken(connectionId: string, requiredScopes: string[] = []): Promise<string> {
    let tokens = await this.input.store.get(connectionId);
    if (!tokens) throw new ValidationError("OAuth connection must be reconnected.");
    if (requiredScopes.some((scope) => !tokens!.scopes.includes(scope))) throw new ValidationError("OAuth connection does not grant the required scopes.");
    if (Date.parse(tokens.expiresAt) <= Date.now() + 30_000) {
      if (!tokens.refreshToken) throw new ValidationError("OAuth connection has expired and must be reconnected.");
      const refreshed = normalizeTokens(await this.input.client.refresh(tokens.refreshToken));
      tokens = { ...refreshed, refreshToken: refreshed.refreshToken ?? tokens.refreshToken };
      await this.input.store.set(connectionId, tokens);
    }
    return tokens.accessToken;
  }

  async revoke(connectionId: string): Promise<void> {
    const tokens = await this.input.store.get(connectionId);
    if (tokens && this.input.client.revoke) await this.input.client.revoke(tokens.refreshToken ?? tokens.accessToken);
    await this.input.store.delete(connectionId);
  }
  async reconnect(connectionId: string): Promise<void> { await this.revoke(connectionId); }
  async health(connectionId: string): Promise<{ healthy: boolean; expiresAt: string | null; scopes: string[] }> {
    let tokens = await this.input.store.get(connectionId);
    if (!tokens) return { healthy: false, expiresAt: null, scopes: [] };
    try { const accessToken = await this.getAccessToken(connectionId); tokens = await this.input.store.get(connectionId) ?? tokens; return { healthy: this.input.client.health ? await this.input.client.health(accessToken) : true, expiresAt: tokens.expiresAt, scopes: tokens.scopes }; }
    catch { return { healthy: false, expiresAt: tokens.expiresAt, scopes: tokens.scopes }; }
  }

  private assertCallbackOrigin(origin: string): void {
    let normalized: string; try { normalized = new URL(origin).origin; } catch { throw new ValidationError("OAuth callback origin is invalid."); }
    if (!this.input.allowedCallbackOrigins.some((allowed) => new URL(allowed).origin === normalized)) throw new ValidationError("OAuth callback origin is not allowlisted.");
  }
  private encrypt(payload: OAuthStatePayload): string {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.input.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  }
  private decrypt(value: string): OAuthStatePayload {
    try {
      const packed = Buffer.from(value, "base64url"); if (packed.length < 29) throw new Error("short state");
      const decipher = createDecipheriv("aes-256-gcm", this.input.key, packed.subarray(0, 12));
      decipher.setAuthTag(packed.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8")) as OAuthStatePayload;
    } catch { throw new ValidationError("OAuth authorization state is invalid."); }
  }
}

function normalizeTokens(tokens: OAuthTokenSet): OAuthTokenSet {
  if (!tokens.accessToken || !Number.isFinite(Date.parse(tokens.expiresAt))) throw new ValidationError("OAuth provider returned an invalid token response.");
  return { ...tokens, scopes: [...new Set(tokens.scopes)].sort(), tokenType: tokens.tokenType ?? "Bearer" };
}

export class InMemoryOAuthConnectionStore implements OAuthConnectionStore {
  private readonly records = new Map<string, OAuthTokenSet>();
  get(id: string): OAuthTokenSet | null { return this.records.get(id) ?? null; }
  set(id: string, tokens: OAuthTokenSet): void { this.records.set(id, { ...tokens }); }
  delete(id: string): void { this.records.delete(id); }
}
