import { describe, it, expect } from "vitest";
import { SettingsPathUpdater } from "../../../src/services/settings-path-updater.js";

describe("SettingsPathUpdater.patchObject", () => {
  it("patches a nested path immutably", () => {
    const original = { a: { b: { c: 1 }, keep: true }, top: "x" };
    const result = SettingsPathUpdater.patchObject(original, "a.b.c", 2);

    expect(result.a.b.c).toBe(2);
    expect(result.a.keep).toBe(true);
    expect(result.top).toBe("x");
    // Input is untouched (clone-on-write).
    expect(original.a.b.c).toBe(1);
    expect(result).not.toBe(original);
    expect(result.a).not.toBe(original.a);
  });

  it("creates intermediate objects for missing path segments", () => {
    const result = SettingsPathUpdater.patchObject({} as Record<string, any>, "x.y.z", 7);
    expect(result.x.y.z).toBe(7);
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects the dangerous path key %s",
    (key) => {
      expect(() => SettingsPathUpdater.patchObject({}, `${key}.polluted`, true)).toThrow(/Invalid path part/);
      expect(() => SettingsPathUpdater.patchObject({}, `a.${key}`, true)).toThrow(/Invalid path part/);
    },
  );

  it("does not pollute Object.prototype via a crafted path", () => {
    expect(() => SettingsPathUpdater.patchObject({}, "__proto__.polluted", "yes")).toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
  });

  it("throws when trying to traverse through a primitive", () => {
    expect(() => SettingsPathUpdater.patchObject({ a: 5 }, "a.b", 1)).toThrow(/primitive/);
  });
});
