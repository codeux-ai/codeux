import { describe, it, expect, afterAll } from "vitest";
import { validateSafeRepoName, validateSafeClonePath, validateNonEmptyDir } from "../../../../src/utils/path-validator.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

describe("validateSafeRepoName", () => {
  it("allows safe repo names", () => {
    expect(() => validateSafeRepoName("my-repo")).not.toThrow();
    expect(() => validateSafeRepoName("repo.123_abc")).not.toThrow();
  });

  it("rejects empty names", () => {
    expect(() => validateSafeRepoName("")).toThrow();
    expect(() => validateSafeRepoName("  ")).toThrow();
  });

  it("rejects path separators", () => {
    expect(() => validateSafeRepoName("my/repo")).toThrow();
    expect(() => validateSafeRepoName("my\\repo")).toThrow();
  });

  it("rejects path traversal", () => {
    expect(() => validateSafeRepoName("..")).toThrow();
    expect(() => validateSafeRepoName("a..b")).toThrow();
  });

  it("rejects control characters", () => {
    expect(() => validateSafeRepoName("my\x00repo")).toThrow();
    expect(() => validateSafeRepoName("my\nrepo")).toThrow();
  });

  it("rejects pure metacharacters", () => {
    expect(() => validateSafeRepoName("$$$")).toThrow();
    expect(() => validateSafeRepoName("___")).not.toThrow(); // Valid by the github/gitlab rules actually, but handled by other checks or fine to pass
  });

  it("rejects invalid characters", () => {
    expect(() => validateSafeRepoName("my repo")).toThrow();
    expect(() => validateSafeRepoName("repo$name")).toThrow();
  });
});

describe("validateSafeClonePath", () => {
  it("rejects filesystem root", () => {
    const root = path.parse(process.cwd()).root;
    expect(() => validateSafeClonePath(root)).toThrow(/Cannot initialize repository in filesystem root/);
  });

  it("rejects home directory", () => {
    expect(() => validateSafeClonePath(os.homedir())).toThrow(/Cannot initialize repository in home directory/);
  });

  it("allows safe paths", () => {
    const safePath = path.join(os.homedir(), "projects", "repo");
    expect(() => validateSafeClonePath(safePath)).not.toThrow();
  });

  it("rejects path outside allowed root", () => {
    const allowedRoot = path.join(os.homedir(), "projects");
    const evilPath = path.join(os.homedir(), "evil-repo");
    expect(() => validateSafeClonePath(evilPath, allowedRoot)).toThrow(/Cannot initialize repository outside of allowed root/);
  });

  it("allows path inside allowed root", () => {
    const allowedRoot = path.join(os.homedir(), "projects");
    const safePath = path.join(os.homedir(), "projects", "my-repo");
    expect(() => validateSafeClonePath(safePath, allowedRoot)).not.toThrow();
  });
});

describe("validateNonEmptyDir", () => {
  const testDir = path.join(os.tmpdir(), "codeux-test-dir-" + Date.now());

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("passes when directory does not exist", () => {
    expect(() => validateNonEmptyDir(path.join(testDir, "not-exist"))).not.toThrow();
  });

  it("passes when directory is empty", () => {
    const emptyDir = path.join(testDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    expect(() => validateNonEmptyDir(emptyDir)).not.toThrow();
  });

  it("throws when directory is not empty", () => {
    const nonEmptyDir = path.join(testDir, "non-empty");
    fs.mkdirSync(nonEmptyDir, { recursive: true });
    fs.writeFileSync(path.join(nonEmptyDir, "file.txt"), "hello");
    expect(() => validateNonEmptyDir(nonEmptyDir)).toThrow(/Target directory already exists and is not empty/);
  });

  it("throws when path is a file", () => {
    const file = path.join(testDir, "just-a-file.txt");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(file, "hello");
    expect(() => validateNonEmptyDir(file)).toThrow(/Target path exists and is not a directory/);
  });
});
