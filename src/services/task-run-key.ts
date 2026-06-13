import * as path from "path";
import { execSync } from "child_process";

const sanitizeSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

export const buildTaskRunKey = (repoPath: string, sprintNumber: number, taskName: string): string => {
  let repoName = "";
  try {
    const resolvedPath = path.resolve(repoPath);
    const baseName = path.basename(resolvedPath);
    if (!process.env.VITEST && (repoPath === "/workspace" || repoPath === "/workspace/")) {
      const gitUrl = execSync("git config --get remote.origin.url", {
        cwd: resolvedPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (gitUrl) {
        const parts = gitUrl.replace(/\.git$/, "").split(/[\\/:]/);
        repoName = parts[parts.length - 1] || "";
      }
    }
    if (!repoName) {
      repoName = baseName;
    }
  } catch {
    repoName = path.basename(path.resolve(repoPath));
  }
  const repoSegment = sanitizeSegment(repoName) || "repo";
  const sprintSegment = Number.isFinite(sprintNumber) ? String(sprintNumber) : "0";
  const taskSegment = sanitizeSegment(taskName) || "task";
  return `${repoSegment}/s${sprintSegment}/${taskSegment}`;
};

export const buildTaskRunTag = (repoPath: string, sprintNumber: number, taskName: string): string => {
  return `[run:${buildTaskRunKey(repoPath, sprintNumber, taskName)}]`;
};

export const extractTaskRunKeyFromTitle = (title: string | undefined): string | null => {
  if (!title) {
    return null;
  }
  const match = title.match(/\[run:([^\]]+)\]/);
  return match ? match[1] : null;
};
