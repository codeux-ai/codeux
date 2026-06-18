import { sendBufferedPreviewResponse, injectPreviewBridgeIntoHtml, PREVIEW_BRIDGE_PATH } from "../../../src/server/preview-host-utils.js";
import { describe, it, expect } from "vitest";
import {
  buildPreviewProxyRequestHeaders,
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
          "host": "dashboard.local",
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
      const html = "<html><head></head><body>Hello</body></html>";
      const injected = injectPreviewBridgeIntoHtml(html);
      expect(injected).toContain(PREVIEW_BRIDGE_PATH);
      expect(injected).toContain("</head>");
    });
  });

  describe("sendBufferedPreviewResponse", () => {
    it("forwards the preview app's set-cookie header", () => {
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
          headers: { "set-cookie": ["secret=1"], "content-type": "text/html" },
          body: Buffer.from("<html></html>")
        }
      });

      // Preview runs on its own origin, so its session cookies must reach the browser.
      expect(writtenHeaders["set-cookie"]).toEqual(["secret=1"]);
    });
  });

});
