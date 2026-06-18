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
    expect(getSafeUrl("data:text/html,<html>")).toBeUndefined();
    expect(getSafeUrl("vbscript:msgbox('hello')")).toBeUndefined();
  });

  it("allows relative internal paths", () => {
    expect(getSafeUrl("/about")).toBe("/about");
    expect(getSafeUrl("#top")).toBe("#top");
    expect(getSafeUrl("?search=test")).toBe("?search=test");
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
