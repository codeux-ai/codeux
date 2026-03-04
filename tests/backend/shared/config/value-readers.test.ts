import { describe, it, expect } from "vitest";
import {
  readBoolean,
  readString,
  readInteger,
  readPortValue,
  readPort,
} from "../../../../src/shared/config/value-readers.js";

describe("value-readers", () => {
  describe("readBoolean", () => {
    it("should return boolean value if it is a boolean", () => {
      expect(readBoolean(true, false)).toBe(true);
      expect(readBoolean(false, true)).toBe(false);
    });

    it("should parse 'true' and 'false' strings (case-insensitive)", () => {
      expect(readBoolean("true", false)).toBe(true);
      expect(readBoolean("TRUE", false)).toBe(true);
      expect(readBoolean("false", true)).toBe(false);
      expect(readBoolean("FALSE", true)).toBe(false);
    });

    it("should return fallback for invalid values", () => {
      expect(readBoolean("not-a-bool", true)).toBe(true);
      expect(readBoolean(1, false)).toBe(false);
      expect(readBoolean(null, true)).toBe(true);
      expect(readBoolean(undefined, false)).toBe(false);
    });
  });

  describe("readString", () => {
    it("should return string value if it is a string", () => {
      expect(readString("hello", "fallback")).toBe("hello");
      expect(readString("", "fallback")).toBe("");
    });

    it("should return fallback for non-string values", () => {
      expect(readString(123, "fallback")).toBe("fallback");
      expect(readString(true, "fallback")).toBe("fallback");
      expect(readString(null, "fallback")).toBe("fallback");
    });
  });

  describe("readInteger", () => {
    it("should return number if it is a finite number", () => {
      expect(readInteger(123, 0)).toBe(123);
      expect(readInteger(123.4, 0)).toBe(123);
      expect(readInteger(123.6, 0)).toBe(124);
    });

    it("should parse numeric strings", () => {
      expect(readInteger("123", 0)).toBe(123);
      expect(readInteger("123.4", 0)).toBe(123);
    });

    it("should return fallback for invalid values", () => {
      expect(readInteger("abc", 99)).toBe(99);
      expect(readInteger(Infinity, 99)).toBe(99);
      expect(readInteger(NaN, 99)).toBe(99);
      expect(readInteger(null, 99)).toBe(99);
    });
  });

  describe("readPortValue", () => {
    it("should return port if it is valid (1-65535)", () => {
      expect(readPortValue(80, 0)).toBe(80);
      expect(readPortValue("8080", 0)).toBe(8080);
      expect(readPortValue(1, 0)).toBe(1);
      expect(readPortValue(65535, 0)).toBe(65535);
    });

    it("should return fallback for out of range values", () => {
      expect(readPortValue(0, 99)).toBe(99);
      expect(readPortValue(65536, 99)).toBe(99);
      expect(readPortValue(-1, 99)).toBe(99);
    });

    it("should return fallback for non-numeric values", () => {
      expect(readPortValue("not-a-port", 99)).toBe(99);
      expect(readPortValue(null, 99)).toBe(99);
    });

    it("should allow null fallback", () => {
      expect(readPortValue("invalid", null)).toBeNull();
    });
  });

  describe("readPort", () => {
    it("should return port or mandatory fallback", () => {
      expect(readPort(80, 4444)).toBe(80);
      expect(readPort("invalid", 4444)).toBe(4444);
    });
  });
});
