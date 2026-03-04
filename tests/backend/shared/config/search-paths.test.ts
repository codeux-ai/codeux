import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import * as path from "path";
import { buildSearchRoots, buildCandidatePaths } from "../../../../src/shared/config/search-paths.js";

vi.mock("os");

describe("search-paths helper", () => {
  const MOCK_CWD = "/mock/cwd";
  const MOCK_HOME = "/mock/home";
  const MOCK_PROJECT_ROOT = "/mock/project";
  const MOCK_REPO_PATH = "/mock/repo";

  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue(MOCK_CWD);
    vi.spyOn(os, "homedir").mockReturnValue(MOCK_HOME);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildSearchRoots", () => {
    it("should return roots in the correct order (Repo > CWD > Project > Home)", () => {
      const roots = buildSearchRoots(MOCK_PROJECT_ROOT, MOCK_REPO_PATH);
      expect(roots).toEqual([
        path.resolve(MOCK_REPO_PATH),
        path.resolve(MOCK_CWD),
        path.resolve(MOCK_PROJECT_ROOT),
        path.resolve(MOCK_HOME),
      ]);
    });

    it("should omit repoPath when not provided", () => {
      const roots = buildSearchRoots(MOCK_PROJECT_ROOT);
      expect(roots).toEqual([
        path.resolve(MOCK_CWD),
        path.resolve(MOCK_PROJECT_ROOT),
        path.resolve(MOCK_HOME),
      ]);
    });

    it("should deduplicate roots", () => {
      // Set project root same as CWD
      const roots = buildSearchRoots(MOCK_CWD);
      expect(roots).toEqual([
        path.resolve(MOCK_CWD),
        path.resolve(MOCK_HOME),
      ]);
    });

    it("should deduplicate with repoPath", () => {
      const roots = buildSearchRoots(MOCK_PROJECT_ROOT, MOCK_CWD);
      expect(roots).toEqual([
        path.resolve(MOCK_CWD),
        path.resolve(MOCK_PROJECT_ROOT),
        path.resolve(MOCK_HOME),
      ]);
    });
  });

  describe("buildCandidatePaths", () => {
    it("should build paths with the relative path appended", () => {
      const relativePath = "settings.json";
      const paths = buildCandidatePaths(relativePath, MOCK_PROJECT_ROOT, MOCK_REPO_PATH);
      expect(paths).toEqual([
        path.resolve(path.join(MOCK_REPO_PATH, relativePath)),
        path.resolve(path.join(MOCK_CWD, relativePath)),
        path.resolve(path.join(MOCK_PROJECT_ROOT, relativePath)),
        path.resolve(path.join(MOCK_HOME, relativePath)),
      ]);
    });

    it("should deduplicate paths", () => {
        const relativePath = "settings.json";
        // Same root and project root
        const paths = buildCandidatePaths(relativePath, MOCK_CWD);
        expect(paths).toEqual([
          path.resolve(path.join(MOCK_CWD, relativePath)),
          path.resolve(path.join(MOCK_HOME, relativePath)),
        ]);
      });
  });
});
