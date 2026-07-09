import type { Express } from "express";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import type {
  LocalDirectoryBrowserEntry,
  LocalDirectoryBrowserResponse,
  LocalFileBrowserEntry,
  LocalFileBrowserResponse,
} from "../contracts/app-types.js";
import { asyncRoute } from "./route-utils.js";
import { parseTrimmedString } from "./request-parsers.js";
import { expandHomePath } from "../shared/config/home-path.js";
import { isPathInside, type ValidatedPath } from "../utils/path-validator.js";

function asValidatedPath(candidate: string): ValidatedPath {
  return candidate as ValidatedPath;
}

function isWithinAnyRoot(candidate: string, roots: string[]): boolean {
  return roots.some((root) => {
    return isPathInside(root, candidate);
  });
}

async function canonicalizeTrustedRoot(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  try {
    const realPath = await fs.realpath(resolved);
    return typeof realPath === "string" && realPath.length > 0 ? realPath : resolved;
  } catch {
    return resolved;
  }
}

async function resolveAllowedRoots(): Promise<string[]> {
  const configuredRoots = [
    os.homedir(),
    process.cwd(),
    ...(process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS || "").split(",").filter(Boolean),
  ];
  const roots = await Promise.all(configuredRoots.map(async (root) => {
    const resolvedRoot = path.resolve(expandHomePath(root));
    const realRoot = await canonicalizeTrustedRoot(resolvedRoot);
    return [resolvedRoot, realRoot];
  }));
  return [...new Set(roots.flat())];
}

async function canonicalizeAllowedPath(resolvedTargetPath: string, resolvedAllowedRoots: string[]): Promise<ValidatedPath | null> {
  if (!isWithinAnyRoot(resolvedTargetPath, resolvedAllowedRoots)) {
    return null;
  }

  let realTargetPath = resolvedTargetPath;
  try {
    realTargetPath = await fs.realpath(resolvedTargetPath);
  } catch {
    realTargetPath = resolvedTargetPath;
  }

  return isWithinAnyRoot(realTargetPath, resolvedAllowedRoots) ? asValidatedPath(realTargetPath) : null;
}

/**
 * Resolves `targetPath` to its canonical real path and confirms it lives inside
 * one of the allowed roots (home, cwd, or configured browser roots). The roots
 * include both configured spellings and canonical realpaths so platform aliases
 * such as macOS `/var` and `/private/var` are treated as the same location.
 * Returns the vetted real path on success, or null if it falls outside every
 * allowed root.
 *
 * Returning the resolved path (rather than a boolean) lets callers run all
 * subsequent filesystem operations against the value that was actually checked,
 * closing the gap between the allow-list check and the FS access.
 */
async function resolveAllowedPath(targetPath: string): Promise<ValidatedPath | null> {
  const resolvedTargetPath = path.resolve(targetPath);
  const resolvedAllowedRoots = await resolveAllowedRoots();
  return canonicalizeAllowedPath(resolvedTargetPath, resolvedAllowedRoots);
}

interface LocalBrowserDirectoryListing {
  currentPath: ValidatedPath;
  parentPath: string | null;
  rootPath: string;
  homePath: string;
  directories: LocalDirectoryBrowserEntry[];
  files: LocalFileBrowserEntry[];
}

function sortEntriesByName<T extends { name: string }>(entries: T[]): T[] {
  return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code
  );
}

async function listAllowedDirectory(requestedPath: string): Promise<LocalBrowserDirectoryListing> {
  const resolvedPath = path.resolve(expandHomePath(requestedPath));

  // safePath is the canonical real path that passed the allow-list check;
  // every filesystem operation below uses it, never the raw request input.
  const safePath = await resolveAllowedPath(resolvedPath);
  if (!safePath) {
    throw new LocalBrowserError(403, "Access denied");
  }
  // Inline containment check directly beside the filesystem calls below
  // (in addition to the allow-list check inside resolveAllowedPath), so
  // the guard sits right next to the paths it protects.
  const allowedRoots = await resolveAllowedRoots();
  if (!isWithinAnyRoot(safePath, allowedRoots)) {
    throw new LocalBrowserError(403, "Access denied");
  }
  const safePathUrl = pathToFileURL(safePath);

  let stat;
  try {
    // safePath is the canonical path returned by resolveAllowedPath after
    // lexical and realpath containment checks against allowed roots.
    stat = await fs.stat(safePathUrl);
  } catch (err: unknown) {
    if (hasErrorCode(err, "ENOENT")) {
      throw new LocalBrowserError(400, "Path does not exist");
    }
    throw new LocalBrowserError(403, "Access denied");
  }

  if (!stat.isDirectory()) {
    throw new LocalBrowserError(400, "Path is not a directory");
  }

  let entries;
  try {
    // safePath is the canonical path returned by resolveAllowedPath after
    // lexical and realpath containment checks against allowed roots.
    entries = await fs.readdir(safePathUrl, { withFileTypes: true });
  } catch (err: unknown) {
    throw new LocalBrowserError(403, "Access denied");
  }

  const directories = sortEntriesByName(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(safePath, entry.name),
    })));
  const files = sortEntriesByName(entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      path: path.join(safePath, entry.name),
    })));
  const rootPath = path.parse(safePath).root;
  return {
    currentPath: safePath,
    parentPath: safePath === rootPath ? null : path.dirname(safePath),
    rootPath,
    homePath: os.homedir(),
    directories,
    files,
  };
}

class LocalBrowserError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function registerLocalDirectoryRoutes(router: Express): void {
  router.get("/api/local-directories", asyncRoute(async (req, res) => {
    try {
      const requestedPath = parseTrimmedString(req.query.path) || os.homedir();
      const listing = await listAllowedDirectory(requestedPath);
      const response: LocalDirectoryBrowserResponse = {
        currentPath: listing.currentPath,
        parentPath: listing.parentPath,
        rootPath: listing.rootPath,
        homePath: listing.homePath,
        directories: listing.directories,
      };

      res.json(response);
    } catch (error) {
      if (error instanceof LocalBrowserError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: "Failed to list directories" });
    }
  }));

  router.get("/api/local-files", asyncRoute(async (req, res) => {
    try {
      const requestedPath = parseTrimmedString(req.query.path) || os.homedir();
      const listing = await listAllowedDirectory(requestedPath);
      const response: LocalFileBrowserResponse = {
        currentPath: listing.currentPath,
        parentPath: listing.parentPath,
        rootPath: listing.rootPath,
        homePath: listing.homePath,
        directories: listing.directories,
        files: listing.files,
      };

      res.json(response);
    } catch (error) {
      if (error instanceof LocalBrowserError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: "Failed to list files" });
    }
  }));
}
