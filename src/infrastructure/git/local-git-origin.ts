import * as fs from "fs";
import * as path from "path";

const originUrlCache = new Map<string, { mtimeMs: number; size: number; url: string | null }>();

export function readLocalGitOriginUrl(repoPath: string): string | null {
  const configPath = resolveGitConfigPath(repoPath);
  if (!configPath) {
    return null;
  }

  try {
    const stat = fs.statSync(configPath);
    const cached = originUrlCache.get(configPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.url;
    }
    const config = fs.readFileSync(configPath, "utf8");
    const url = parseOriginUrlFromGitConfig(config);
    originUrlCache.set(configPath, { mtimeMs: stat.mtimeMs, size: stat.size, url });
    return url;
  } catch {
    return null;
  }
}

export function parseOriginUrlFromGitConfig(config: string): string | null {
  let inOriginSection = false;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const section = line.match(/^\[remote\s+"([^"]+)"\]$/);
    if (section) {
      inOriginSection = section[1] === "origin";
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      inOriginSection = false;
      continue;
    }
    if (!inOriginSection) {
      continue;
    }
    const url = line.match(/^url\s*=\s*(.+)$/);
    if (url?.[1]?.trim()) {
      return url[1].trim();
    }
  }
  return null;
}

function resolveGitConfigPath(repoPath: string): string | null {
  const gitDir = resolveGitDir(repoPath);
  return gitDir ? path.join(gitDir, "config") : null;
}

function resolveGitDir(repoPath: string): string | null {
  const dotGitPath = path.join(repoPath, ".git");
  try {
    const stat = fs.statSync(dotGitPath);
    if (stat.isDirectory()) {
      return dotGitPath;
    }
    if (!stat.isFile()) {
      return null;
    }
    const pointer = fs.readFileSync(dotGitPath, "utf8").trim();
    const match = pointer.match(/^gitdir:\s*(.+)$/i);
    if (!match?.[1]?.trim()) {
      return null;
    }
    return path.resolve(repoPath, match[1].trim());
  } catch {
    return null;
  }
}
