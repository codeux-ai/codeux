import type { Express } from "express";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
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

async function resolveAllowedRoots(): Promise<string[]> {
  const configuredRoots = [
    os.homedir(),
    process.cwd(),
    ...(process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS || "").split(",").filter(Boolean),
  ];
  return configuredRoots.map((root) => path.resolve(expandHomePath(root)));
}

/**
 * Resolves `targetPath` to its canonical real path and confirms it lives inside
 * one of the allowed roots (home, cwd, or configured browser roots). Returns the
 * vetted real path on success, or null if it falls outside every allowed root.
 *
 * Returning the resolved path (rather than a boolean) lets callers run all
 * subsequent filesystem operations against the value that was actually checked,
 * closing the gap between the allow-list check and the FS access.
 */
async function resolveAllowedPath(targetPath: string): Promise<ValidatedPath | null> {
  const resolvedTargetPath = path.resolve(targetPath);
  const resolvedAllowedRoots = await resolveAllowedRoots();
  if (!isWithinAnyRoot(resolvedTargetPath, resolvedAllowedRoots)) {
    return null;
  }

  let realTargetPath: string;
  try {
    // resolvedTargetPath already passed lexical containment against the allowed
    // directory roots; this canonicalizes the same candidate for a second check.
    // codeql[js/path-injection]
    realTargetPath = await fs.realpath(resolvedTargetPath);
  } catch (err) {
    // If the path doesn't exist, we fall back to the resolved absolute path.
    realTargetPath = resolvedTargetPath;
  }

  return isWithinAnyRoot(realTargetPath, resolvedAllowedRoots) ? asValidatedPath(realTargetPath) : null;
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

  let stat;
  try {
    // safePath is the canonical path returned by resolveAllowedPath after
    // lexical and realpath containment checks against allowed roots.
    stat = await fs.stat(safePath); // lgtm[js/path-injection]
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
    entries = await fs.readdir(safePath, { withFileTypes: true }); // lgtm[js/path-injection]
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
