import { describe, expect, it } from "vitest";
import { getValueByPath, setValueByPath } from "../../../dashboard/src/v2/lib/settings-path-updates.js";

describe("settings-path-updates", () => {
  describe("getValueByPath", () => {
    it("returns a top-level value", () => {
      const obj = { a: 1 };
      expect(getValueByPath(obj, "a")).toBe(1);
    });

    it("returns a nested value", () => {
      const obj = { a: { b: 2 } };
      expect(getValueByPath(obj, "a.b")).toBe(2);
    });

    it("returns undefined for missing intermediate path", () => {
      const obj = { a: {} };
      expect(getValueByPath(obj, "a.b.c")).toBeUndefined();
    });

    it("returns undefined for null/undefined root", () => {
      expect(getValueByPath(null, "a")).toBeUndefined();
      expect(getValueByPath(undefined, "a")).toBeUndefined();
    });

    it("returns value from an array", () => {
      const obj = { a: [10, 20] };
      expect(getValueByPath(obj, "a.1")).toBe(20);
    });
  });

  describe("setValueByPath", () => {
    it("sets a top-level value and maintains immutability", () => {
      const obj = { a: 1, b: 2 };
      const next = setValueByPath(obj, "a", 10);
      expect(next).toEqual({ a: 10, b: 2 });
      expect(next).not.toBe(obj);
    });

    it("sets a nested value and maintains structural sharing", () => {
      const obj = { a: { b: 1 }, c: { d: 2 } };
      const next = setValueByPath(obj, "a.b", 10);
      expect(next).toEqual({ a: { b: 10 }, c: { d: 2 } });
      expect(next.c).toBe(obj.c);
      expect(next.a).not.toBe(obj.a);
    });

    it("creates intermediate objects if they don't exist", () => {
      const obj = {} as any;
      const next = setValueByPath(obj, "a.b.c", 100);
      expect(next).toEqual({ a: { b: { c: 100 } } });
    });

    it("overwrites non-object intermediate values", () => {
      const obj = { a: 1 };
      const next = setValueByPath(obj, "a.b", 2);
      expect(next).toEqual({ a: { b: 2 } });
    });

    it("handles array elements (as objects)", () => {
      const obj = { a: [1, 2] };
      const next = setValueByPath(obj, "a.1", 20);
      // Note: currently setValueByPath treats everything as an object when creating/cloning intermediate
      // If we target an existing array index, it will work because { ...array } works but might not be what we want
      // for strict array preservation if we wanted to push. But for settings it's usually replacements.
      expect(next.a[1]).toBe(20);
    });

    it("handles no-op updates (still returns new root by current impl)", () => {
      const obj = { a: 1 };
      const next = setValueByPath(obj, "a", 1);
      expect(next).toEqual(obj);
      expect(next).not.toBe(obj);
    });
  });
});
