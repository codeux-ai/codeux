import { describe, expect, it } from "vitest";
import {
  deepDiff,
  deepMerge,
  flattenSources,
  safeClone,
} from "../../../../src/domain/settings/settings-merge.js";

describe("Settings Merge Domain Helper", () => {
  describe("safeClone", () => {
    it("clones primitives", () => {
      expect(safeClone(1)).toBe(1);
      expect(safeClone("string")).toBe("string");
      expect(safeClone(true)).toBe(true);
      expect(safeClone(null)).toBe(null);
      expect(safeClone(undefined)).toBe(undefined);
    });

    it("clones arrays", () => {
      const arr = [1, { a: 2 }, [3]];
      const cloned = safeClone(arr);
      expect(cloned).toEqual(arr);
      expect(cloned).not.toBe(arr);
      expect(cloned[1]).not.toBe(arr[1]);
      expect(cloned[2]).not.toBe(arr[2]);
    });

    it("clones plain objects", () => {
      const obj = { a: 1, b: { c: 2 } };
      const cloned = safeClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.b).not.toBe(obj.b);
    });

    it("clones null prototype objects", () => {
      const obj = Object.create(null);
      obj.a = 1;
      const cloned = safeClone(obj);
      expect(cloned).toEqual(obj);
      expect(Object.getPrototypeOf(cloned)).toBe(null);
    });

    it("throws on unsupported object shapes", () => {
      class Custom {}
      expect(() => safeClone(new Custom())).toThrow(/Unsupported object shape/);
      expect(() => safeClone(new Date())).toThrow(/Unsupported object shape/);
    });

    it("throws on unsupported types", () => {
      expect(() => safeClone(() => {})).toThrow(/Unsupported type/);
    });
  });

  describe("deepMerge", () => {
    it("merges nested objects", () => {
      const base = { a: 1, b: { c: 2, d: 3 } };
      const patch = { b: { c: 20 } };
      const result = deepMerge(base, patch);
      expect(result).toEqual({ a: 1, b: { c: 20, d: 3 } });
    });

    it("replaces arrays", () => {
      const base = { arr: [1, 2] };
      const patch = { arr: [3] };
      const result = deepMerge(base, patch);
      expect(result).toEqual({ arr: [3] });
      expect(result.arr).not.toBe(patch.arr); // Should be cloned
    });

    it("handles undefined patch as base", () => {
      const base = { a: 1 };
      expect(deepMerge(base, undefined)).toBe(base);
    });

    it("handles null patch as replacement", () => {
      const base = { a: 1 };
      expect(deepMerge(base, null)).toBe(null);
    });

    it("handles non-object patch as replacement", () => {
      const base = { a: 1 };
      expect(deepMerge(base, "string")).toBe("string");
    });

    it("creates new objects during merge to avoid mutating base", () => {
      const base = { b: { c: 2 } };
      const patch = { b: { d: 3 } };
      const result = deepMerge(base, patch);
      expect(result.b).not.toBe(base.b);
      expect(base.b).toEqual({ c: 2 });
    });
  });

  describe("deepDiff", () => {
    it("returns undefined for equal objects", () => {
      expect(deepDiff({ a: 1 }, { a: 1 })).toBeUndefined();
    });

    it("returns diff for different objects", () => {
      expect(deepDiff({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    });

    it("returns diff for nested objects", () => {
      expect(deepDiff({ a: { b: 1 } }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
    });

    it("returns whole array if different", () => {
      expect(deepDiff([1], [2])).toEqual([2]);
    });

    it("returns undefined for equal arrays", () => {
      expect(deepDiff([1], [1])).toBeUndefined();
    });
  });

  describe("flattenSources", () => {
    it("flattens nested objects with source metadata", () => {
      const value = { a: 1, b: { c: 2 } };
      const result = flattenSources(value, "project");
      expect(result).toEqual({
        "a": "project",
        "b.c": "project",
      });
    });

    it("treats arrays as leaf values", () => {
      const value = { arr: [1, 2] };
      const result = flattenSources(value, "sprint");
      expect(result).toEqual({
        "arr": "sprint",
      });
    });

    it("handles empty objects", () => {
      expect(flattenSources({}, "system")).toEqual({});
    });

    it("handles primitive values at root with prefix", () => {
      expect(flattenSources(1, "system", "root")).toEqual({ "root": "system" });
    });
  });
});
