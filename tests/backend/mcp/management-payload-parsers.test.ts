import { describe, it, expect } from "vitest";
import {
  parseRequiredString,
  parseOptionalString,
  parseOptionalStringArray,
  parseOptionalNumber,
  parseOptionalBoolean,
  parseOptionalObject,
  parseOptionalEnum,
  parseOptionalEnumStrict,
  parseOptionalIntegerStrict,
  formatManagementErrorEnvelope,
  ManagementValidationError,
  sanitizeManagementErrorMessage,
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

  it("parseOptionalEnumStrict", () => {
    const valid = ["yes", "no"] as const;
    expect(parseOptionalEnumStrict({ foo: " YES " }, "foo", valid)).toBe("yes");
    expect(parseOptionalEnumStrict({}, "foo", valid)).toBeUndefined();
    expect(() => parseOptionalEnumStrict({ foo: "maybe" }, "foo", valid))
      .toThrow("Invalid value for foo. Must be one of: yes, no");
  });

  it("parseOptionalIntegerStrict", () => {
    expect(parseOptionalIntegerStrict({ count: "6.9" }, "count", { min: 1 })).toBe(6);
    expect(parseOptionalIntegerStrict({}, "count", { min: 1 })).toBeUndefined();
    expect(() => parseOptionalIntegerStrict({ count: "not-a-number" }, "count", { min: 1 }))
      .toThrow("Invalid value for count. Must be a valid integer.");
    expect(() => parseOptionalIntegerStrict({ count: "0" }, "count", { min: 1 }))
      .toThrow("Invalid value for count. Must be at least 1.");
  });

  it("formats validation and runtime error envelopes consistently", () => {
    expect(formatManagementErrorEnvelope("tasks", "create", new ManagementValidationError("bad input", "priority"))).toEqual({
      result: {
        status: "error",
        domain: "tasks",
        action: "create",
        message: "bad input",
        errorType: "validation",
        field: "priority",
      },
    });

    expect(formatManagementErrorEnvelope("tasks", "create", new Error("boom"))).toEqual({
      result: {
        status: "error",
        domain: "tasks",
        action: "create",
        message: "boom",
        errorType: "runtime",
      },
    });
  });

  it("sanitizes stack traces and secret-like metadata from runtime error envelopes", () => {
    const error = new Error("provider failed token=sk-test-123\n    at runProvider (/tmp/runtime.ts:10:2)");
    Object.assign(error, {
      apiKey: "sk-hidden",
      stack: "Error: provider failed\n    at secret (/tmp/runtime.ts:10:2)",
    });

    const envelope = formatManagementErrorEnvelope("tasks", "start", error);

    expect(envelope).toEqual({
      result: {
        status: "error",
        domain: "tasks",
        action: "start",
        message: "provider failed token=[redacted]",
        errorType: "runtime",
      },
    });
    expect(JSON.stringify(envelope)).not.toContain("sk-test-123");
    expect(JSON.stringify(envelope)).not.toContain("sk-hidden");
    expect(JSON.stringify(envelope)).not.toContain("at runProvider");
    expect(JSON.stringify(envelope)).not.toContain("stack");
  });

  it("redacts common secret field names in standalone error messages", () => {
    expect(sanitizeManagementErrorMessage("apiKey: sk-123, password=secret-value")).toBe("apiKey: [redacted], password=[redacted]");
    expect(sanitizeManagementErrorMessage("authorization=Bearer abc123\n    at auth (/tmp/auth.ts:1:1)")).toBe("authorization=[redacted]");
  });
});
