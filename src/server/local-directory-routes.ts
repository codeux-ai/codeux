import type { Express } from "express";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { LocalDirectoryBrowserResponse } from "../contracts/app-types.js";
import { asyncRoute } from "./route-utils.js";
import { parseTrimmedString } from "./request-parsers.js";
import { expandHomePath } from "../shared/config/home-path.js";

async function isPathAllowed(targetPath: string): Promise<boolean> {
  let realTargetPath;
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

  return resolvedAllowedRoots.some((root) => {
    return realTargetPath === root || realTargetPath.startsWith(root + path.sep) || realTargetPath.startsWith(root + "/");
  });
}

export function registerLocalDirectoryRoutes(router: Express): void {
  router.get("/api/local-directories", asyncRoute(async (req, res) => {
    try {
      const requestedPath = parseTrimmedString(req.query.path) || os.homedir();
      const resolvedPath = path.resolve(expandHomePath(requestedPath));

      if (!(await isPathAllowed(resolvedPath))) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      let stat;
      try {
        stat = await fs.stat(resolvedPath);
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
        entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      } catch (err: any) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: path.join(resolvedPath, entry.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      const rootPath = path.parse(resolvedPath).root;
      const response: LocalDirectoryBrowserResponse = {
        currentPath: resolvedPath,
        parentPath: resolvedPath === rootPath ? null : path.dirname(resolvedPath),
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
