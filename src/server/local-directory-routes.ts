import type { Express } from "express";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { LocalDirectoryBrowserResponse } from "../contracts/app-types.js";
import { asyncRoute } from "./route-utils.js";
import { parseTrimmedString } from "./request-parsers.js";
import { expandHomePath } from "../shared/config/home-path.js";

/**
 * Resolves `targetPath` to its canonical real path and confirms it lives inside
 * one of the allowed roots (home, cwd, or configured browser roots). Returns the
 * vetted real path on success, or null if it falls outside every allowed root.
 *
 * Returning the resolved path (rather than a boolean) lets callers run all
 * subsequent filesystem operations against the value that was actually checked,
 * closing the gap between the allow-list check and the FS access.
 */
async function resolveAllowedPath(targetPath: string): Promise<string | null> {
  let realTargetPath: string;
  try {
    realTargetPath = await fs.realpath(targetPath);
  } catch (err) {
    // If the path doesn't exist, we fall back to the resolved absolute path.
    realTargetPath = path.resolve(targetPath);
  }

  const allowedRoots = [
    os.homedir(),
    process.cwd(),
    ...(process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS || "").split(",").filter(Boolean)
  ].map(async (r) => {
    try {
      return await fs.realpath(r);
    } catch {
      return path.resolve(r);
    }
  });

  const resolvedAllowedRoots = await Promise.all(allowedRoots);

  const allowed = resolvedAllowedRoots.some((root) => {
    return realTargetPath === root || realTargetPath.startsWith(root + path.sep) || realTargetPath.startsWith(root + "/");
  });

  return allowed ? realTargetPath : null;
}

export function registerLocalDirectoryRoutes(router: Express): void {
  router.get("/api/local-directories", asyncRoute(async (req, res) => {
    try {
      const requestedPath = parseTrimmedString(req.query.path) || os.homedir();
      const resolvedPath = path.resolve(expandHomePath(requestedPath));

      // safePath is the canonical real path that passed the allow-list check;
      // every filesystem operation below uses it, never the raw request input.
      const safePath = await resolveAllowedPath(resolvedPath);
      if (!safePath) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      let stat;
      try {
        stat = await fs.stat(safePath);
      } catch (err: any) {
        if (err.code === "ENOENT") {
           res.status(400).json({ error: "Path does not exist" });
           return;
        }
        res.status(403).json({ error: "Access denied" });
        return;
      }

      if (!stat.isDirectory()) {
        res.status(400).json({ error: "Path is not a directory" });
        return;
      }

      let entries;
      try {
        entries = await fs.readdir(safePath, { withFileTypes: true });
      } catch (err: any) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: path.join(safePath, entry.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      const rootPath = path.parse(safePath).root;
      const response: LocalDirectoryBrowserResponse = {
        currentPath: safePath,
        parentPath: safePath === rootPath ? null : path.dirname(safePath),
        rootPath,
        homePath: os.homedir(),
        directories,
      };

      res.json(response);
    } catch (error) {
      res.status(400).json({ error: "Failed to list directories" });
    }
  }));
}
