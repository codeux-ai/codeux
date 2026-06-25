/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { normalizePath, buildPreviewOrigin, buildPreviewUrl } from "../../../dashboard/src/v2/lib/preview-origin.js";

describe("preview-origin utilities", () => {
  describe("normalizePath", () => {
    it("handles null/undefined gracefully", () => {
      expect(normalizePath(null)).toBe("/");
      expect(normalizePath(undefined)).toBe("/");
      expect(normalizePath("")).toBe("/");
      expect(normalizePath("   ")).toBe("/");
    });

    it("ensures leading slash for relative paths", () => {
      expect(normalizePath("foo/bar")).toBe("/foo/bar");
      expect(normalizePath("/foo/bar")).toBe("/foo/bar");
    });

    it("extracts pathname and search from absolute URLs", () => {
      expect(normalizePath("http://example.com")).toBe("/");
      expect(normalizePath("https://example.com/foo")).toBe("/foo");
      expect(normalizePath("http://example.com/foo?q=1#hash")).toBe("/foo?q=1#hash");
    });

    it("handles invalid URLs", () => {
      expect(normalizePath("http://%%")).toBe("/");
    });

    it("handles trailing slashes", () => {
      expect(normalizePath("/path/to/resource/")).toBe("/path/to/resource");
      expect(normalizePath("/path/to/resource")).toBe("/path/to/resource");
    });

    it("handles redundant slashes", () => {
      expect(normalizePath("/path//to//resource")).toBe("/path/to/resource");
    });

    it("handles relative segments", () => {
      expect(normalizePath("/path/./to/resource")).toBe("/path/to/resource");
      expect(normalizePath("/path/to/../other")).toBe("/path/other");
    });

    it("handles edge cases", () => {
      expect(normalizePath("/")).toBe("/");
      expect(normalizePath("/path with spaces")).toBe("/path%20with%20spaces");
    });
  });

  describe("buildPreviewOrigin", () => {
    let originalLocation: Location;

    beforeEach(() => {
      originalLocation = window.location;
      // @ts-ignore
      delete window.location;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it("builds localhost origin correctly with port", () => {
      window.location = {
        protocol: "http:",
        hostname: "localhost",
        port: "3000",
      } as any;
      expect(buildPreviewOrigin("123")).toBe("http://preview-123.localhost:3000");
    });

    it("builds 127.0.0.1 origin correctly without port", () => {
      window.location = {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "",
      } as any;
      expect(buildPreviewOrigin("abc")).toBe("http://preview-abc.localhost");
    });

    it("builds custom host origin correctly", () => {
      window.location = {
        protocol: "https:",
        hostname: "myapp.com",
        port: "",
      } as any;
      expect(buildPreviewOrigin("xyz")).toBe("https://preview-xyz.myapp.com");
    });
  });

  describe("buildPreviewUrl", () => {
    let originalLocation: Location;

    beforeEach(() => {
      originalLocation = window.location;
      // @ts-ignore
      delete window.location;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it("assembles origin and normalized path", () => {
      window.location = {
        protocol: "http:",
        hostname: "localhost",
        port: "8080",
      } as any;
      expect(buildPreviewUrl("456", "test/path?foo=bar")).toBe("http://preview-456.localhost:8080/test/path?foo=bar");
    });
  });
});
