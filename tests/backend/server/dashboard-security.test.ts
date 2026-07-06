import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { isTrustedDashboardHost, isHostileBrowserOrigin, applyDashboardSecurityHeaders } from "../../../src/server/dashboard-security.js";

describe("Dashboard Security Helper", () => {
  describe("isTrustedDashboardHost", () => {
    it("should allow localhost", () => {
      expect(isTrustedDashboardHost("localhost")).toBe(true);
      expect(isTrustedDashboardHost("localhost:3000")).toBe(true);
    });

    it("should allow loopback IP", () => {
      expect(isTrustedDashboardHost("127.0.0.1")).toBe(true);
      expect(isTrustedDashboardHost("127.0.0.1:4000")).toBe(true);
      expect(isTrustedDashboardHost("[::1]")).toBe(true);
      expect(isTrustedDashboardHost("[::1]:4444")).toBe(true);
    });

    it("should allow configured DASHBOARD_HOST", () => {
      const originalHost = process.env.DASHBOARD_HOST;
      try {
        process.env.DASHBOARD_HOST = "my-custom-host";

        expect(isTrustedDashboardHost("my-custom-host")).toBe(true);
        expect(isTrustedDashboardHost("my-custom-host:8080")).toBe(true);
      } finally {
        if (originalHost === undefined) {
          delete process.env.DASHBOARD_HOST;
        } else {
          process.env.DASHBOARD_HOST = originalHost;
        }
      }
    });

    it("should allow preview hosts", () => {
      expect(isTrustedDashboardHost("preview-abc.localhost:3000")).toBe(true);
    });

    it("should reject untrusted hosts", () => {
      expect(isTrustedDashboardHost("evil.com")).toBe(false);
      expect(isTrustedDashboardHost("evil.com:80")).toBe(false);
      expect(isTrustedDashboardHost(undefined)).toBe(false);
      expect(isTrustedDashboardHost("")).toBe(false);
    });

    it("should reject malformed host values", () => {
      expect(isTrustedDashboardHost("localhost, evil.com")).toBe(false);
      expect(isTrustedDashboardHost("evil@localhost")).toBe(false);
      expect(isTrustedDashboardHost("localhost/path")).toBe(false);
      expect(isTrustedDashboardHost("local\u0000host")).toBe(false);
    });

    it("should reject non-local preview host spoofing", () => {
      expect(isTrustedDashboardHost("preview-123.my-domain.com")).toBe(false);
      expect(isTrustedDashboardHost("preview-123.evil.com:4444")).toBe(false);
      expect(isTrustedDashboardHost("preview-.localhost:4444")).toBe(false);
    });

    it("should validate forwarded hosts against the actual host boundary", () => {
      expect(isTrustedDashboardHost("127.0.0.1:4444", "localhost:4444")).toBe(true);
      expect(isTrustedDashboardHost("localhost:4444", "127.0.0.1:4444")).toBe(true);
      expect(isTrustedDashboardHost("localhost:4444", "localhost:4444, evil.com")).toBe(false);
      expect(isTrustedDashboardHost("localhost:4444", "evil.com")).toBe(false);
      expect(isTrustedDashboardHost("localhost:4444", "preview-test.localhost:4444")).toBe(false);
    });
  });

  describe("isHostileBrowserOrigin", () => {
    const createReq = (overrides: Partial<Request>): Request => {
      return {
        method: "POST",
        path: "/api/something",
        headers: { host: "localhost:3000" },
        ...overrides,
      } as Request;
    };

    it("should allow same-origin non-mutation methods", () => {
      const req = createReq({ method: "GET", headers: { origin: "http://localhost:3000", host: "localhost:3000" } });
      expect(isHostileBrowserOrigin(req)).toBe(false);
    });

    it("should allow non-sensitive paths", () => {
      const req = createReq({ path: "/public/assets/style.css", headers: { "sec-fetch-site": "cross-site" } });
      expect(isHostileBrowserOrigin(req)).toBe(false);
    });

    it("should reject cross-site Sec-Fetch-Site on sensitive paths", () => {
      const req = createReq({ headers: { "sec-fetch-site": "cross-site", host: "localhost:3000" } });
      expect(isHostileBrowserOrigin(req)).toBe(true);
    });

    it("should reject hostile Origin", () => {
      const req = createReq({ headers: { origin: "https://evil.com", host: "localhost:3000" } });
      expect(isHostileBrowserOrigin(req)).toBe(true);
    });

    it("should reject malformed Origin on sensitive mutations", () => {
      const req = createReq({ headers: { origin: "not a valid origin", host: "localhost:3000" } });
      expect(isHostileBrowserOrigin(req)).toBe(true);
    });

    it("should reject hostile Referer when Origin is missing", () => {
      const req = createReq({ headers: { referer: "https://evil.com/page", host: "localhost:3000" } });
      expect(isHostileBrowserOrigin(req)).toBe(true);
    });

    it("should reject malformed Referer when Origin is missing", () => {
      const req = createReq({ headers: { referer: "not a valid referer", host: "localhost:3000" } });
      expect(isHostileBrowserOrigin(req)).toBe(true);
    });

    it("should reject malformed Referer even when Origin is same-origin", () => {
      const req = createReq({
        headers: {
          origin: "http://localhost:3000",
          referer: "not a valid referer",
          host: "localhost:3000",
        },
      });
      expect(isHostileBrowserOrigin(req)).toBe(true);
    });

    it("should reject comma-separated forwarded hosts", () => {
      const req = createReq({
        headers: {
          host: "localhost:3000",
          "x-forwarded-host": "localhost:3000, evil.com",
          origin: "http://localhost:3000",
        },
      });
      expect(isHostileBrowserOrigin(req)).toBe(true);
    });

    it("should reject preview-host spoofing through forwarded hosts", () => {
      const req = createReq({
        headers: {
          host: "localhost:3000",
          "x-forwarded-host": "preview-test.localhost:3000",
          origin: "http://preview-test.localhost:3000",
        },
      });
      expect(isHostileBrowserOrigin(req)).toBe(true);
    });

    it("should allow same-origin requests", () => {
      const req = createReq({ headers: { origin: "http://localhost:3000", referer: "http://localhost:3000/dashboard", host: "localhost:3000" } });
      expect(isHostileBrowserOrigin(req)).toBe(false);
    });

    it("should allow local dashboard origins", () => {
      expect(isHostileBrowserOrigin(createReq({
        headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
      }))).toBe(false);
      expect(isHostileBrowserOrigin(createReq({
        headers: { origin: "http://[::1]:3000", host: "[::1]:3000" },
      }))).toBe(false);
    });

    it("should allow same-boundary forwarded local dashboard origins", () => {
      const req = createReq({
        headers: {
          host: "127.0.0.1:4444",
          "x-forwarded-host": "localhost:4444",
          origin: "http://localhost:4444",
        },
      });
      expect(isHostileBrowserOrigin(req)).toBe(false);
    });

    it("should allow CLI/API requests missing all browser origin headers", () => {
      const req = createReq({ headers: { host: "localhost:3000" } });
      expect(isHostileBrowserOrigin(req)).toBe(false);
    });
  });

  describe("applyDashboardSecurityHeaders", () => {
    it("should apply correct security headers", () => {
      const setHeaderMock = vi.fn();
      const res = { setHeader: setHeaderMock } as unknown as Response;

      applyDashboardSecurityHeaders(res);

      expect(setHeaderMock).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
      expect(setHeaderMock).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
      expect(setHeaderMock).toHaveBeenCalledWith("X-Frame-Options", "SAMEORIGIN");
      expect(setHeaderMock).toHaveBeenCalledWith("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    });
  });
});
