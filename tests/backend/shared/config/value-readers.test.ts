import { describe, it, expect } from "vitest";
import { readBoolean, readInteger, readPort, readString } from "../../../../src/shared/config/value-readers.js";

describe("value-readers", () => {
  describe("readBoolean", () => {
    it("should return boolean value if provided as boolean", () => {
      expect(readBoolean(true, false)).toBe(true);
      expect(readBoolean(false, true)).toBe(false);
    });

    it("should parse string representations of boolean", () => {
      expect(readBoolean("true", false)).toBe(true);
      expect(readBoolean("TRUE", false)).toBe(true);
      expect(readBoolean("1", false)).toBe(true);
      expect(readBoolean("yes", false)).toBe(true);
      expect(readBoolean("on", false)).toBe(true);

      expect(readBoolean("false", true)).toBe(false);
      expect(readBoolean("FALSE", true)).toBe(false);
      expect(readBoolean("0", true)).toBe(false);
      expect(readBoolean("no", true)).toBe(false);
      expect(readBoolean("off", true)).toBe(false);
    });

    it("should return fallback for invalid values", () => {
      expect(readBoolean(null, true)).toBe(true);
      expect(readBoolean(undefined, false)).toBe(false);
      expect(readBoolean("maybe", true)).toBe(true);
      expect(readBoolean(123, false)).toBe(false);
    });
  });

  describe("readString", () => {
    it("should return string if provided as string", () => {
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
    it("should return rounded integer if provided as number", () => {
      expect(readInteger(123, 0)).toBe(123);
      expect(readInteger(123.4, 0)).toBe(123);
      expect(readInteger(123.6, 0)).toBe(124);
    });

    it("should parse string representations of integers", () => {
      expect(readInteger("123", 0)).toBe(123);
      expect(readInteger("123.9", 0)).toBe(123); // parseInt behavior
    });

    it("should return fallback for invalid numbers", () => {
      expect(readInteger(Infinity, 0)).toBe(0);
      expect(readInteger(NaN, 0)).toBe(0);
      expect(readInteger("abc", 0)).toBe(0);
      expect(readInteger(null, 0)).toBe(0);
    });
  });

  describe("readPort", () => {
    it("should return port if within range", () => {
      expect(readPort(1, 4444)).toBe(1);
      expect(readPort(65535, 4444)).toBe(65535);
      expect(readPort("8080", 4444)).toBe(8080);
    });

    it("should return fallback if out of range", () => {
      expect(readPort(0, 4444)).toBe(4444);
      expect(readPort(65536, 4444)).toBe(4444);
      expect(readPort(-1, 4444)).toBe(4444);
    });

    it("should return fallback for invalid values", () => {
      expect(readPort("abc", 4444)).toBe(4444);
      expect(readPort(null, 4444)).toBe(4444);
    });
  });
});
