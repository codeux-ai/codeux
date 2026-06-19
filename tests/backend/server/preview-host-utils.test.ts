import { sendBufferedPreviewResponse, injectPreviewBridgeIntoHtml, PREVIEW_BRIDGE_PATH } from "../../../src/server/preview-host-utils.js";
import { describe, it, expect } from "vitest";
import {
  buildPreviewBridgeScript,
  buildPreviewProxyRequestHeaders,
  mergePreviewCorsHeaders,
  rewritePreviewLocationHeader,
} from "../../../src/server/preview-host-utils.js";
import type { Request } from "express";

describe("preview-host-utils", () => {
  describe("buildPreviewProxyRequestHeaders", () => {
    it("strips hop-by-hop/transport headers but forwards the preview app's own credentials", () => {
      const req = {
        headers: {
          "authorization": "Bearer token",
          "cookie": "session=123",
          "connection": "keep-alive",
          "upgrade": "websocket",
          "transfer-encoding": "chunked",
          "x-code-ux-test": "test",
          "proxy-authenticate": "test",
          "content-length": "100",
          "accept-encoding": "gzip",
          "host": "preview-session.localhost:4444",
          "origin": "http://preview-session.localhost:4444",
          "referer": "http://preview-session.localhost:4444/api/form",
          "sec-fetch-site": "cross-site",
          "x-custom": "allowed",
        },
        protocol: "http",
        socket: { localPort: 8080 },
      } as unknown as Request;
      const result = buildPreviewProxyRequestHeaders(req, 3000);
      // The preview iframe runs on its own origin (preview-<id>.localhost), so cookie/
      // authorization belong to the previewed app — forward them so stateful apps work.
      expect(result["authorization"]).toBe("Bearer token");
      expect(result["cookie"]).toBe("session=123");
      // Hop-by-hop and transport headers must still be stripped for correct proxying.
      expect(result["connection"]).toBeUndefined();
      expect(result["upgrade"]).toBeUndefined();
      expect(result["transfer-encoding"]).toBeUndefined();
      expect(result["x-code-ux-test"]).toBeUndefined();
      expect(result["proxy-authenticate"]).toBeUndefined();
      expect(result["content-length"]).toBeUndefined();
      expect(result["accept-encoding"]).toBeUndefined();
      expect(result["x-custom"]).toBe("allowed");
      expect(result.host).toBe("127.0.0.1:3000");
      expect(result.origin).toBe("http://127.0.0.1:3000");
      expect(result.referer).toBe("http://127.0.0.1:3000/api/form");
      expect(result["sec-fetch-site"]).toBe("same-origin");
      expect(result["x-forwarded-host"]).toBe("preview-session.localhost:4444");
    });
  });

  describe("rewritePreviewLocationHeader", () => {
    it("rewrites exact upstream origins to relative paths", () => {
      const req = { protocol: "http", headers: { host: "dashboard.local" } } as unknown as Request;
      expect(rewritePreviewLocationHeader("http://127.0.0.1:3000/foo", req, 3000)).toBe("/foo");
      expect(rewritePreviewLocationHeader("http://localhost:3000/bar?q=1", req, 3000)).toBe("/bar?q=1");
    });

    it("leaves relative and external URLs unchanged", () => {
      const req = { protocol: "http", headers: { host: "dashboard.local" } } as unknown as Request;
      expect(rewritePreviewLocationHeader("/relative/path", req, 3000)).toBe("/relative/path");
      expect(rewritePreviewLocationHeader("https://external.com/path", req, 3000)).toBe("https://external.com/path");
    });
  });



  describe("injectPreviewBridgeIntoHtml", () => {
    it("injects bridge script into HTML", () => {
      const html = "<html><HEAD data-app=\"preview\"><script src=\"/early-app.js\"></script></HEAD><body>Hello</body></html>";
      const injected = injectPreviewBridgeIntoHtml(html);
      expect(injected).toContain(PREVIEW_BRIDGE_PATH);
      expect(injected.indexOf(PREVIEW_BRIDGE_PATH)).toBeLessThan(injected.indexOf("/early-app.js"));
      expect(injected).toContain("<HEAD data-app=\"preview\">");
    });
  });

  describe("buildPreviewBridgeScript", () => {
    it("rewrites same-dashboard and any-port loopback fetch/XHR calls through the preview origin", () => {
      const script = buildPreviewBridgeScript();
      expect(script).toContain("rewriteCodeUxPreviewUrl");
      expect(script).toContain("window.fetch = function");
      expect(script).toContain("window.XMLHttpRequest.prototype.open");
      expect(script).toContain("isPreviewLoopbackTarget");
      expect(script).not.toContain("url.port !== window.location.port");
    });
  });

  describe("mergePreviewCorsHeaders", () => {
    it("overrides upstream CORS policy for preview-host responses", () => {
      const req = {
        headers: {
          origin: "http://preview-test.localhost:4444",
          "access-control-request-headers": "x-preview-token, content-type",
        },
      } as unknown as Request;
      const headers: Record<string, string | string[] | undefined> = {
        "access-control-allow-origin": "https://blocked.example",
        vary: "Accept-Encoding",
      };

      mergePreviewCorsHeaders(req, headers);

      expect(headers["access-control-allow-origin"]).toBeUndefined();
      expect(headers["Access-Control-Allow-Origin"]).toBe("http://preview-test.localhost:4444");
      expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
      expect(headers["Access-Control-Allow-Headers"]).toBe("x-preview-token, content-type");
      expect(headers["Vary"]).toBe("Accept-Encoding, Origin");
    });
  });

  describe("sendBufferedPreviewResponse", () => {
    it("forwards cookies while stripping frame-blocking document headers", () => {
      const req = { protocol: "http", headers: { host: "dashboard.local" } } as unknown as Request;
      let writtenHeaders: any;
      const res = {
        writeHead: (status: number, headers: any) => { writtenHeaders = headers; },
        end: () => {},
      } as any;

      sendBufferedPreviewResponse({
        req, res, upstreamPort: 3000,
        response: {
          statusCode: 200,
          headers: {
            "set-cookie": ["secret=1"],
            "content-type": "text/html",
            "Content-Security-Policy": "default-src 'self'",
            "X-Frame-Options": "DENY",
          },
          body: Buffer.from("<html></html>")
        }
      });

      // Preview runs on its own origin, so its session cookies must reach the browser.
      expect(writtenHeaders["set-cookie"]).toEqual(["secret=1"]);
      expect(writtenHeaders["Content-Security-Policy"]).toBeUndefined();
      expect(writtenHeaders["X-Frame-Options"]).toBeUndefined();
    });
  });

});
