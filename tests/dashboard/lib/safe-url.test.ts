/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { getSafeUrl } from "../../../dashboard/src/v2/lib/safe-url.js";

describe("getSafeUrl", () => {
  it("allows valid http/https URLs", () => {
    expect(getSafeUrl("http://example.com")).toBe("http://example.com/");
    expect(getSafeUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  it("blocks dangerous protocols", () => {
    expect(getSafeUrl("javascript:alert(1)")).toBeUndefined();
    expect(getSafeUrl("JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(getSafeUrl("java&#x73;cript:alert(1)")).toBeUndefined();
    expect(getSafeUrl("java&#115;cript:alert(1)")).toBeUndefined();
    expect(getSafeUrl("java\nscript:alert(1)")).toBeUndefined();
    expect(getSafeUrl("data:text/html,<html>")).toBeUndefined();
    expect(getSafeUrl("vbscript:msgbox('hello')")).toBeUndefined();
  });

  it("blocks unsafe image protocols", () => {
    expect(getSafeUrl("data:image/svg+xml,<svg onload=alert(1)>", { kind: "image" })).toBeUndefined();
    expect(getSafeUrl("mailto:test@example.com", { kind: "image" })).toBeUndefined();
    expect(getSafeUrl("https://example.com/image.png", { kind: "image" })).toBe("https://example.com/image.png");
  });

  it("allows relative internal paths", () => {
    expect(getSafeUrl("/about")).toBe("/about");
    expect(getSafeUrl("docs/page.html")).toBe("docs/page.html");
    expect(getSafeUrl("docs/page.html?time=12:30")).toBe("docs/page.html?time=12:30");
    expect(getSafeUrl("docs/page.html#section:1")).toBe("docs/page.html#section:1");
    expect(getSafeUrl("#top")).toBe("#top");
    expect(getSafeUrl("?search=test")).toBe("?search=test");
  });

  it("blocks protocol-relative and backslash-prefixed URLs", () => {
    expect(getSafeUrl("//example.com/path")).toBeUndefined();
    expect(getSafeUrl("\\\\example.com\\path")).toBeUndefined();
    expect(getSafeUrl("\\example.com/path")).toBeUndefined();
    expect(getSafeUrl("/\\example.com/path")).toBeUndefined();
  });

  it("blocks scheme smuggling before the first path delimiter", () => {
    expect(getSafeUrl("javascript:alert(1)/safe")).toBeUndefined();
    expect(getSafeUrl("data:text/html/safe")).toBeUndefined();
    expect(getSafeUrl("docs/javascript:notes")).toBe("docs/javascript:notes");
    expect(getSafeUrl("docs?redirect=javascript:alert(1)")).toBe("docs?redirect=javascript:alert(1)");
  });

  it("blocks malformed absolute URLs", () => {
    expect(getSafeUrl("https://[::1")).toBeUndefined();
    expect(getSafeUrl("http://exa mple.com")).toBeUndefined();
  });

  it("handles null/undefined/empty", () => {
    expect(getSafeUrl(null)).toBeUndefined();
    expect(getSafeUrl(undefined)).toBeUndefined();
    expect(getSafeUrl("")).toBeUndefined();
    expect(getSafeUrl("   ")).toBeUndefined();
  });

  it("blocks generic strings that are not valid URLs or paths", () => {
    expect(getSafeUrl("just some text")).toBeUndefined();
  });
});
