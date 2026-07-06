import { describe, it, expect } from "vitest";
import {
  parseRequiredString,
  parseOptionalString,
  parseOptionalStringArray,
  parseOptionalNumber,
  parseOptionalBoolean,
  parseOptionalObject,
  parseRequiredObject,
  parseRequiredPresentValue,
  parseOptionalEnum,
  parseOptionalEnumStrict,
  parseOptionalIntegerStrict,
  formatManagementErrorEnvelope,
  ManagementValidationError,
} from "../../../src/mcp/management/payload-parsers.js";

describe("Payload Parsers", () => {
  it("parseRequiredString", () => {
    expect(parseRequiredString({ foo: " bar " }, "foo")).toBe("bar");
    expect(() => parseRequiredString({ foo: "   " }, "foo")).toThrow("foo is required");
    expect(() => parseRequiredString({}, "foo")).toThrow("foo is required");
    expect(() => parseRequiredString({}, "foo", "Custom error!")).toThrow("Custom error!");
  });

  it("parseRequiredString treats null and non-string values as validation errors", () => {
    for (const payload of [
      { foo: null },
      { foo: undefined },
      { foo: 42 },
      { foo: ["secret-value"] },
      { foo: { token: "secret-value" } },
    ]) {
      expect(() => parseRequiredString(payload, "foo")).toThrow("foo is required");
      try {
        parseRequiredString(payload, "foo");
      } catch (error) {
        expect(error).toBeInstanceOf(ManagementValidationError);
        expect((error as ManagementValidationError).field).toBe("foo");
        expect((error as Error).message).not.toContain("secret-value");
      }
    }
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

  it("parseOptionalNumber rejects invalid numeric shapes and ranges without coercion", () => {
    expect(parseOptionalNumber({ foo: "42" }, "foo")).toBeUndefined();
    expect(parseOptionalNumber({ foo: Infinity }, "foo")).toBeUndefined();
    expect(parseOptionalNumber({ foo: -1 }, "foo", 0)).toBeUndefined();
    expect(parseOptionalNumber({ foo: 101 }, "foo", 0, 100)).toBeUndefined();
    expect(parseOptionalNumber({ foo: 100 }, "foo", 0, 100)).toBe(100);
  });

  it("parseOptionalBoolean", () => {
    expect(parseOptionalBoolean({ foo: true }, "foo")).toBe(true);
    expect(parseOptionalBoolean({ foo: false }, "foo")).toBe(false);
    expect(parseOptionalBoolean({ foo: "true" }, "foo")).toBeUndefined();
    expect(parseOptionalBoolean({}, "foo")).toBeUndefined();
  });

  it("parseOptionalBoolean does not coerce string or numeric booleans", () => {
    expect(parseOptionalBoolean({ foo: "false" }, "foo")).toBeUndefined();
    expect(parseOptionalBoolean({ foo: 0 }, "foo")).toBeUndefined();
    expect(parseOptionalBoolean({ foo: 1 }, "foo")).toBeUndefined();
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
    expect(parseOptionalEnum({ foo: ["yes"] }, "foo", valid)).toBeUndefined();
    expect(parseOptionalEnum({}, "foo", valid)).toBeUndefined();
  });

  it("parseOptionalEnumStrict", () => {
    const valid = ["yes", "no"] as const;
    expect(parseOptionalEnumStrict({ foo: " YES " }, "foo", valid)).toBe("yes");
    expect(parseOptionalEnumStrict({}, "foo", valid)).toBeUndefined();
    expect(() => parseOptionalEnumStrict({ foo: "maybe" }, "foo", valid))
      .toThrow("Invalid value for foo. Must be one of: yes, no");
    expect(() => parseOptionalEnumStrict({ foo: ["yes"] }, "foo", valid))
      .toThrow("Invalid value for foo. Must be one of: yes, no");
  });

  it("parseRequiredObject rejects unexpected payload shapes", () => {
    expect(parseRequiredObject({ approval: { confirmed: true } }, "approval")).toEqual({ confirmed: true });
    for (const payload of [
      {},
      { approval: null },
      { approval: [] },
      { approval: "confirmed=true" },
    ]) {
      expect(() => parseRequiredObject(payload, "approval")).toThrow("approval object is required");
      try {
        parseRequiredObject(payload, "approval");
      } catch (error) {
        expect(error).toBeInstanceOf(ManagementValidationError);
        expect((error as ManagementValidationError).field).toBe("approval");
      }
    }
  });

  it("parseRequiredPresentValue distinguishes missing fields from explicit null approval values", () => {
    expect(parseRequiredPresentValue({ confirmed: null }, "confirmed")).toBeNull();
    expect(parseRequiredPresentValue({ confirmed: false }, "confirmed")).toBe(false);
    expect(() => parseRequiredPresentValue({}, "confirmed"))
      .toThrow("confirmed is required");
  });

  it("parseOptionalIntegerStrict", () => {
    expect(parseOptionalIntegerStrict({ count: "6.9" }, "count", { min: 1 })).toBe(6);
    expect(parseOptionalIntegerStrict({}, "count", { min: 1 })).toBeUndefined();
    expect(() => parseOptionalIntegerStrict({ count: "not-a-number" }, "count", { min: 1 }))
      .toThrow("Invalid value for count. Must be a valid integer.");
    expect(() => parseOptionalIntegerStrict({ count: "0" }, "count", { min: 1 }))
      .toThrow("Invalid value for count. Must be at least 1.");
    expect(() => parseOptionalIntegerStrict({ count: "11" }, "count", { max: 10 }))
      .toThrow("Invalid value for count. Must be at most 10.");
    expect(() => parseOptionalIntegerStrict({ count: "" }, "count"))
      .toThrow("Invalid value for count. Must be a valid integer.");
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

  it("formats approval validation failures as sanitized validation envelopes", () => {
    const secret = "approval-secret-token";
    const error = new ManagementValidationError("approval object is required", "approval");
    const envelope = formatManagementErrorEnvelope("settings", "replace_system_settings", error);

    expect(envelope).toEqual({
      result: {
        status: "error",
        domain: "settings",
        action: "replace_system_settings",
        message: "approval object is required",
        errorType: "validation",
        field: "approval",
      },
    });
    expect(JSON.stringify(envelope)).not.toContain(secret);
  });
});
