import { describe, expect, it } from "vitest";
import {
  classifyNavigationTarget,
  isDashboardRuntimeDataUrl,
  isSafeExternalUrl,
  isSafeInternalUrl,
  normalizeZoomFactor,
  resolveDirectoryPickerDefaultPath,
  shouldAddRuntimeNoCacheRequestHeaders,
  shouldAllowPermissionCheck,
  shouldAllowPermissionRequest,
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

  it("allows only the dashboard origin and canonical same-port preview origins internally", () => {
    const origin = "http://127.0.0.1:4444";

    expect(isSafeInternalUrl("http://127.0.0.1:4444/projects", origin)).toBe(true);
    expect(isSafeInternalUrl("http://preview-session-123.localhost:4444/", origin)).toBe(true);
    expect(isSafeInternalUrl("http://PREVIEW-SESSION-123.localhost:4444/", origin)).toBe(true);

    expect(isSafeInternalUrl("http://localhost:4444/projects", origin)).toBe(false);
    expect(isSafeInternalUrl("http://preview-.localhost:4444/", origin)).toBe(false);
    expect(isSafeInternalUrl("http://preview-session-123.localhost:4445/", origin)).toBe(false);
    expect(isSafeInternalUrl("https://preview-session-123.localhost:4444/", origin)).toBe(false);
    expect(isSafeInternalUrl("http://preview-session-123.example.com:4444/", origin)).toBe(false);
    expect(isSafeInternalUrl("not a url", origin)).toBe(false);
  });

  it("classifies external navigations without allowing unsafe schemes", () => {
    const origin = "http://127.0.0.1:4444";

    expect(classifyNavigationTarget("http://127.0.0.1:4444/tasks", origin)).toBe("allow-internal");
    expect(classifyNavigationTarget("http://example.test/docs", origin)).toBe("open-external");
    expect(classifyNavigationTarget("https://example.test/docs", origin)).toBe("open-external");
    expect(classifyNavigationTarget("https://github.com/codeux-ai/codeux/releases/tag/v1.2.0", origin)).toBe(
      "open-external",
    );
    expect(classifyNavigationTarget("https://www.npmjs.com/package/@codeuxai/codeux/v/1.2.0", origin)).toBe(
      "open-external",
    );
    expect(classifyNavigationTarget("mailto:support@example.test", origin)).toBe("open-external");
    expect(classifyNavigationTarget("file:///etc/passwd", origin)).toBe("deny");
    expect(classifyNavigationTarget("javascript:alert(1)", origin)).toBe("deny");
    expect(classifyNavigationTarget("not a url", origin)).toBe("deny");

    expect(isSafeExternalUrl("https://example.test")).toBe(true);
    expect(isSafeExternalUrl("https://github.com/codeux-ai/codeux/releases")).toBe(true);
    expect(isSafeExternalUrl("https://www.npmjs.com/package/@codeuxai/codeux")).toBe(true);
    expect(isSafeExternalUrl("mailto:support@example.test")).toBe(true);
    expect(isSafeExternalUrl("data:text/html,hello")).toBe(false);
  });

  it("allows only microphone and audio-only media requests from the trusted dashboard origin", () => {
    const origin = "http://127.0.0.1:4444";

    expect(shouldAllowPermissionRequest("http://127.0.0.1:4444/", origin, "microphone")).toBe(true);
    expect(shouldAllowPermissionRequest("http://localhost:4444/", origin, "microphone")).toBe(true);
    expect(shouldAllowPermissionRequest("http://127.0.0.1:4444/", origin, "media", {
      mediaTypes: ["audio"],
    })).toBe(true);

    for (const permission of ["camera", "geolocation", "notifications", "fullscreen"]) {
      expect(shouldAllowPermissionRequest("http://127.0.0.1:4444/", origin, permission)).toBe(false);
    }
    expect(shouldAllowPermissionRequest("http://127.0.0.1:4444/", origin, "media")).toBe(false);
    expect(shouldAllowPermissionRequest("http://127.0.0.1:4444/", origin, "media", {
      mediaTypes: ["video"],
    })).toBe(false);
    expect(shouldAllowPermissionRequest("http://127.0.0.1:4444/", origin, "media", {
      mediaTypes: ["audio", "video"],
    })).toBe(false);
    expect(shouldAllowPermissionRequest("http://preview-session.localhost:4444/", origin, "microphone")).toBe(false);
    expect(shouldAllowPermissionRequest("http://preview-session.localhost:4444/", origin, "media", {
      mediaTypes: ["audio"],
    })).toBe(false);
    expect(shouldAllowPermissionRequest("https://example.test/", origin, "microphone")).toBe(false);
    expect(shouldAllowPermissionRequest("https://example.test/", origin, "media", {
      mediaTypes: ["audio"],
    })).toBe(false);
    expect(shouldAllowPermissionRequest("http://127.0.0.1:4445/", origin, "microphone")).toBe(false);
    expect(shouldAllowPermissionRequest("not a url", origin, "microphone")).toBe(false);
  });

  it("allows only audio media permission checks from the trusted dashboard origin", () => {
    const origin = "http://127.0.0.1:4444";

    expect(shouldAllowPermissionCheck("http://127.0.0.1:4444", origin, "media", {
      mediaType: "audio",
    })).toBe(true);
    expect(shouldAllowPermissionCheck("http://localhost:4444", origin, "media", {
      mediaType: "audio",
    })).toBe(true);
    expect(shouldAllowPermissionCheck("http://127.0.0.1:4444", origin, "microphone")).toBe(true);

    expect(shouldAllowPermissionCheck("http://127.0.0.1:4444", origin, "media")).toBe(false);
    expect(shouldAllowPermissionCheck("http://127.0.0.1:4444", origin, "media", {
      mediaType: "video",
    })).toBe(false);
    expect(shouldAllowPermissionCheck("http://127.0.0.1:4444", origin, "media", {
      mediaType: "unknown",
    })).toBe(false);
    expect(shouldAllowPermissionCheck("http://127.0.0.1:4444", origin, "geolocation", {
      mediaType: "audio",
    })).toBe(false);
    expect(shouldAllowPermissionCheck("http://preview-session.localhost:4444", origin, "media", {
      mediaType: "audio",
    })).toBe(false);
    expect(shouldAllowPermissionCheck("https://example.test", origin, "media", {
      mediaType: "audio",
    })).toBe(false);
    expect(shouldAllowPermissionCheck("http://127.0.0.1:4444", origin, "media", {
      mediaType: "audio",
      securityOrigin: "http://preview-session.localhost:4444",
    })).toBe(false);
  });

  it("normalizes valid IPC zoom factors and rejects invalid zoom input", () => {
    expect(normalizeZoomFactor(1.25)).toBe(1.25);
    expect(normalizeZoomFactor(0.1)).toBe(0.5);
    expect(normalizeZoomFactor(3)).toBe(2.5);

    expect(() => normalizeZoomFactor("1")).toThrow(TypeError);
    expect(() => normalizeZoomFactor(Number.NaN)).toThrow(TypeError);
    expect(() => normalizeZoomFactor(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("normalizes valid IPC directory picker defaults and rejects invalid paths", () => {
    const resolvePath = (basePath: string, relativePath: string) => `${basePath}/${relativePath}`;
    const isAbsolutePath = (candidatePath: string) => candidatePath.startsWith("/");

    expect(resolveDirectoryPickerDefaultPath(undefined, "/home/dev", resolvePath, isAbsolutePath)).toBe("/home/dev");
    expect(resolveDirectoryPickerDefaultPath(null, "/home/dev", resolvePath, isAbsolutePath)).toBe("/home/dev");
    expect(resolveDirectoryPickerDefaultPath("  ", "/home/dev", resolvePath, isAbsolutePath)).toBe("/home/dev");
    expect(resolveDirectoryPickerDefaultPath("/workspace", "/home/dev", resolvePath, isAbsolutePath)).toBe("/workspace");
    expect(resolveDirectoryPickerDefaultPath("projects/codeux", "/home/dev", resolvePath, isAbsolutePath)).toBe(
      "/home/dev/projects/codeux",
    );

    expect(() => resolveDirectoryPickerDefaultPath(42, "/home/dev", resolvePath, isAbsolutePath)).toThrow(TypeError);
    expect(() => resolveDirectoryPickerDefaultPath("bad\npath", "/home/dev", resolvePath, isAbsolutePath)).toThrow(
      TypeError,
    );
    expect(() => resolveDirectoryPickerDefaultPath("bad\u0000path", "/home/dev", resolvePath, isAbsolutePath)).toThrow(
      TypeError,
    );
  });
});
