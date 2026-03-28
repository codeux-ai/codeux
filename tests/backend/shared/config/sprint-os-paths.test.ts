import { describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import {
  SPRINT_OS_DIRNAME,
  getRelativeSprintOsPath,
  getRepoSprintOsDir,
  getRepoSprintOsPath,
  getHomeSprintOsDir,
  getHomeSprintOsPath,
  getSprintSubtasksDir,
  getRepoDebugLogPath
} from "../../../../src/shared/config/sprint-os-paths.js";

describe("sprint-os-paths", () => {
  it("getRelativeSprintOsPath joins segments", () => {
    expect(getRelativeSprintOsPath("a", "b")).toBe(path.join(SPRINT_OS_DIRNAME, "a", "b"));
  });

  it("getRepoSprintOsDir joins repo path", () => {
    expect(getRepoSprintOsDir("/repo")).toBe(path.join("/repo", SPRINT_OS_DIRNAME));
  });

  it("getRepoSprintOsPath joins repo path and segments", () => {
    expect(getRepoSprintOsPath("/repo", "a", "b")).toBe(path.join("/repo", SPRINT_OS_DIRNAME, "a", "b"));
  });

  it("getHomeSprintOsDir joins home path", () => {
    expect(getHomeSprintOsDir()).toBe(path.join(os.homedir(), SPRINT_OS_DIRNAME));
  });

  it("getHomeSprintOsPath joins home path and segments", () => {
    expect(getHomeSprintOsPath("a", "b")).toBe(path.join(os.homedir(), SPRINT_OS_DIRNAME, "a", "b"));
  });

  it("getSprintSubtasksDir returns correctly formatted sprint directory", () => {
    expect(getSprintSubtasksDir("/repo", 5)).toBe(path.join("/repo", SPRINT_OS_DIRNAME, "sprints", "sprint5-subtasks"));
  });

  it("getRepoDebugLogPath returns correctly formatted debug path", () => {
    expect(getRepoDebugLogPath("/repo")).toBe(path.join("/repo", SPRINT_OS_DIRNAME, "debug.log"));
  });
});
