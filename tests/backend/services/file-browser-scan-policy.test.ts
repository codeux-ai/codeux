import { describe, expect, it } from "vitest";
import {
  isPrunedPath,
  normalizeAndValidatePath,
  MAX_FILE_BYTES,
  MAX_TREE_ENTRIES,
  PRUNED_DIRECTORIES,
} from "../../../src/services/file-browser-scan-policy.js";

describe("file browser scan policy", () => {
  describe("path normalization rules", () => {
    it("rejects empty paths", () => {
      expect(() => normalizeAndValidatePath("")).toThrowError("path cannot be empty");
      expect(() => normalizeAndValidatePath("   ")).toThrowError("path cannot be empty");
    });

    it("rejects absolute paths", () => {
      expect(() => normalizeAndValidatePath("/etc/passwd")).toThrowError("absolute paths are not allowed");
      expect(() => normalizeAndValidatePath("C:\\Windows\\System32")).toThrowError("absolute paths are not allowed");
    });

    it("rejects encoded traversal", () => {
      expect(() => normalizeAndValidatePath("foo/%2e%2e/bar")).toThrowError("encoded traversal is not allowed");
    });

    it("rejects control characters", () => {
      expect(() => normalizeAndValidatePath("foo/\x00bar")).toThrowError("control characters are not allowed");
    });

    it("rejects .git internals", () => {
      expect(() => normalizeAndValidatePath(".git")).toThrowError(".git internals are not allowed");
      expect(() => normalizeAndValidatePath(".git/config")).toThrowError(".git internals are not allowed");
    });

    it("allows valid paths", () => {
      expect(normalizeAndValidatePath("valid/path/to/file.ts")).toBe("valid/path/to/file.ts");
      expect(normalizeAndValidatePath("foo/.git/config")).toBe("foo/.git/config");
    });
  });

  describe("pruned path rules", () => {
    it("identifies pruned directories", () => {
      expect(isPrunedPath("node_modules")).toBe(true);
      expect(isPrunedPath("node_modules/package/index.js")).toBe(true);
      expect(isPrunedPath(".git")).toBe(true);
      expect(isPrunedPath(".git/objects")).toBe(true);
      expect(isPrunedPath("dist")).toBe(true);
      expect(isPrunedPath("build")).toBe(true);
      expect(isPrunedPath("coverage/lcov.info")).toBe(true);
    });

    it("allows non-pruned paths", () => {
      expect(isPrunedPath("src/index.ts")).toBe(false);
      expect(isPrunedPath("package.json")).toBe(false);
      expect(isPrunedPath("foo/node_modules")).toBe(false);
      expect(isPrunedPath("node_modules_like")).toBe(false);
    });
  });

  describe("limits configuration", () => {
    it("has reasonable limits set", () => {
      expect(MAX_TREE_ENTRIES).toBe(20_000);
      expect(MAX_FILE_BYTES).toBe(2_000_000);
      expect(PRUNED_DIRECTORIES.length).toBeGreaterThan(0);
    });
  });
});
