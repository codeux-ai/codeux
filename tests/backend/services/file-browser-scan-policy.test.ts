import { describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  isPrunedPath,
  normalizeAndValidatePath,
  MAX_FILE_BYTES,
  MAX_TREE_ENTRIES,
  PRUNED_DIRECTORIES,
} from "../../../src/services/file-browser-scan-policy.js";
import { validateExistingPathInside } from "../../../src/utils/path-validator.js";

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
      expect(() => normalizeAndValidatePath("%2e%2e/secrets.env")).toThrowError("encoded traversal is not allowed");
    });

    it("rejects double-encoded traversal", () => {
      expect(() => normalizeAndValidatePath("foo/%252e%252e/bar")).toThrowError("encoded traversal is not allowed");
      expect(() => normalizeAndValidatePath("src%252f..%252fsecrets.env")).toThrowError("encoded traversal is not allowed");
    });

    it("rejects plain traversal segments", () => {
      expect(() => normalizeAndValidatePath("../secrets.env")).toThrowError("encoded traversal is not allowed");
      expect(() => normalizeAndValidatePath("src/../../secrets.env")).toThrowError("encoded traversal is not allowed");
      expect(() => normalizeAndValidatePath("..")).toThrowError("encoded traversal is not allowed");
    });

    it("rejects control characters", () => {
      expect(() => normalizeAndValidatePath("foo/\x00bar")).toThrowError("control characters are not allowed");
    });

    it("rejects .git internals", () => {
      expect(() => normalizeAndValidatePath(".git")).toThrowError(".git internals are not allowed");
      expect(() => normalizeAndValidatePath(".git/config")).toThrowError(".git internals are not allowed");
    });

    it("rejects Windows drive paths", () => {
      expect(() => normalizeAndValidatePath("C:Windows/System32")).toThrowError("absolute paths are not allowed");
      expect(() => normalizeAndValidatePath("C:/Windows/System32")).toThrowError("absolute paths are not allowed");
    });

    it("allows valid paths", () => {
      expect(normalizeAndValidatePath("valid/path/to/file.ts")).toBe("valid/path/to/file.ts");
      expect(normalizeAndValidatePath("foo/.git/config")).toBe("foo/.git/config");
    });
  });

  describe("canonical containment rules", () => {
    it("returns the canonical path for normal nested files", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-policy-"));
      try {
        await fs.mkdir(path.join(root, "src"), { recursive: true });
        await fs.writeFile(path.join(root, "src", "index.ts"), "export {};\n");

        const validated = validateExistingPathInside(root, "src/index.ts");

        expect(validated).toBe(await fs.realpath(path.join(root, "src", "index.ts")));
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("rejects symlinks that resolve outside the workspace", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-policy-"));
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-policy-outside-"));
      try {
        await fs.writeFile(path.join(outside, "secret.txt"), "secret\n");
        await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "linked-secret.txt"));

        expect(() => validateExistingPathInside(root, "linked-secret.txt")).toThrowError("Path must be inside the project directory.");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        await fs.rm(outside, { recursive: true, force: true });
      }
    });

    it("rejects missing files without returning an unchecked path", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-policy-"));
      try {
        expect(() => validateExistingPathInside(root, "missing.txt")).toThrowError("Path not found");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
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
