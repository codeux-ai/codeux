import { describe, expect, it } from "vitest";
import {
  isDashboardRuntimeDataUrl,
  shouldAddRuntimeNoCacheRequestHeaders,
} from "../../../src/electron/dashboard-network-policy.js";

describe("Electron dashboard network policy", () => {
  it("recognizes dashboard runtime data URLs on the dashboard origin", () => {
    const origin = "http://127.0.0.1:4444";

    expect(isDashboardRuntimeDataUrl("http://127.0.0.1:4444/api/status", origin)).toBe(true);
    expect(isDashboardRuntimeDataUrl("http://localhost:4444/ready", origin)).toBe(true);
    expect(isDashboardRuntimeDataUrl("http://127.0.0.1:4444/health", origin)).toBe(true);
  });

  it("rejects static assets, preview hosts, and mismatched ports", () => {
    const origin = "http://127.0.0.1:4444";

    expect(isDashboardRuntimeDataUrl("http://127.0.0.1:4444/assets/app.js", origin)).toBe(false);
    expect(isDashboardRuntimeDataUrl("http://preview-session.localhost:4444/api/status", origin)).toBe(false);
    expect(isDashboardRuntimeDataUrl("http://127.0.0.1:4445/api/status", origin)).toBe(false);
    expect(isDashboardRuntimeDataUrl("not a url", origin)).toBe(false);
    expect(isDashboardRuntimeDataUrl("http://127.0.0.1:4444/api/status", null)).toBe(false);
  });

  it("only adds Electron no-cache request headers to bodyless read methods", () => {
    expect(shouldAddRuntimeNoCacheRequestHeaders("GET")).toBe(true);
    expect(shouldAddRuntimeNoCacheRequestHeaders("head")).toBe(true);
    expect(shouldAddRuntimeNoCacheRequestHeaders("POST")).toBe(false);
    expect(shouldAddRuntimeNoCacheRequestHeaders("PUT")).toBe(false);
    expect(shouldAddRuntimeNoCacheRequestHeaders("PATCH")).toBe(false);
    expect(shouldAddRuntimeNoCacheRequestHeaders("DELETE")).toBe(false);
  });
});
