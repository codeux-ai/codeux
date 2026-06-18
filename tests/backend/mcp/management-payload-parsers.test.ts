import { describe, it, expect } from "vitest";
import {
  parseRequiredString,
  parseOptionalString,
  parseOptionalStringArray,
  parseOptionalNumber,
  parseOptionalBoolean,
  parseOptionalObject,
  parseOptionalEnum,
} from "../../../src/mcp/management/payload-parsers.js";

describe("Payload Parsers", () => {
  it("parseRequiredString", () => {
    expect(parseRequiredString({ foo: " bar " }, "foo")).toBe("bar");
    expect(() => parseRequiredString({ foo: "   " }, "foo")).toThrow("foo is required");
    expect(() => parseRequiredString({}, "foo")).toThrow("foo is required");
    expect(() => parseRequiredString({}, "foo", "Custom error!")).toThrow("Custom error!");
  });

  it("parseOptionalString", () => {
    expect(parseOptionalString({ foo: " bar " }, "foo")).toBe("bar");
    expect(parseOptionalString({ foo: "   " }, "foo")).toBeUndefined();
    expect(parseOptionalString({}, "foo")).toBeUndefined();
  });

  it("parseOptionalStringArray", () => {
    expect(parseOptionalStringArray({ foo: [" bar ", "   ", 123] }, "foo")).toEqual(["bar"]);
    expect(parseOptionalStringArray({ foo: ["   "] }, "foo")).toBeUndefined();
    expect(parseOptionalStringArray({ foo: [] }, "foo")).toBeUndefined();
    expect(parseOptionalStringArray({}, "foo")).toBeUndefined();
  });

  it("parseOptionalNumber", () => {
    expect(parseOptionalNumber({ foo: 42 }, "foo")).toBe(42);
    expect(parseOptionalNumber({ foo: 42 }, "foo", 50)).toBeUndefined();
    expect(parseOptionalNumber({ foo: 42 }, "foo", 0, 40)).toBeUndefined();
    expect(parseOptionalNumber({ foo: NaN }, "foo")).toBeUndefined();
    expect(parseOptionalNumber({}, "foo")).toBeUndefined();
  });

  it("parseOptionalBoolean", () => {
    expect(parseOptionalBoolean({ foo: true }, "foo")).toBe(true);
    expect(parseOptionalBoolean({ foo: false }, "foo")).toBe(false);
    expect(parseOptionalBoolean({ foo: "true" }, "foo")).toBeUndefined();
    expect(parseOptionalBoolean({}, "foo")).toBeUndefined();
  });

  it("parseOptionalObject", () => {
    expect(parseOptionalObject({ foo: { a: 1 } }, "foo")).toEqual({ a: 1 });
    expect(parseOptionalObject({ foo: [1, 2] }, "foo")).toBeUndefined();
    expect(parseOptionalObject({ foo: null }, "foo")).toBeUndefined();
    expect(parseOptionalObject({}, "foo")).toBeUndefined();
  });

  it("parseOptionalEnum", () => {
    const valid = ["yes", "no"] as const;
    expect(parseOptionalEnum({ foo: " YES " }, "foo", valid)).toBe("yes");
    expect(parseOptionalEnum({ foo: "maybe" }, "foo", valid)).toBeUndefined();
    expect(parseOptionalEnum({}, "foo", valid)).toBeUndefined();
  });
});