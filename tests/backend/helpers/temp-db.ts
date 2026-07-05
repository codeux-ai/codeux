import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { SqliteDatabaseAdapter } from "../../../src/repositories/db/sqlite-database-adapter.js";

type Closable = {
  close(): void;
};

export interface TempDbContext {
  readonly rootDir: string;
  readonly homeDir: string;
  dbPath(name?: string): string;
  createAdapter(name?: string): SqliteDatabaseAdapter;
  createStorage(dbPath?: string): AppDbStorage;
  closeAll(): void;
  removeSqliteSidecars(dbPath?: string): void;
  cleanup(): void;
}

const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

export async function createTempDbContext(prefix = "code-ux-db-test-"): Promise<TempDbContext> {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const homeDir = path.join(rootDir, "home");
  fs.mkdirSync(homeDir, { recursive: true });

  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  const closables: Closable[] = [];
  const dbPaths = new Set<string>();
  let cleanedUp = false;

  const dbPath = (name = "app.db"): string => {
    const resolvedPath = path.join(rootDir, name);
    dbPaths.add(resolvedPath);
    return resolvedPath;
  };

  const removeSqliteSidecars = (targetDbPath?: string): void => {
    const targets = targetDbPath ? [targetDbPath] : [...dbPaths];
    for (const target of targets) {
      for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
        try {
          fs.rmSync(`${target}${suffix}`, { force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }
    }
  };

  const closeAll = (): void => {
    const errors: unknown[] = [];
    while (closables.length > 0) {
      const closable = closables.pop();
      try {
        closable?.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw errors[0];
    }
  };

  const restoreHomeEnv = (): void => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  };

  return {
    rootDir,
    homeDir,
    dbPath,
    createAdapter(name = "app.db"): SqliteDatabaseAdapter {
      const adapter = new SqliteDatabaseAdapter(dbPath(name));
      closables.push(adapter);
      return adapter;
    },
    createStorage(targetDbPath?: string): AppDbStorage {
      const storage = new AppDbStorage(targetDbPath);
      dbPaths.add(storage.getPath());
      closables.push(storage);
      return storage;
    },
    closeAll,
    removeSqliteSidecars,
    cleanup(): void {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      try {
        closeAll();
        removeSqliteSidecars();
        try {
          fs.rmSync(rootDir, { recursive: true, force: false });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      } finally {
        restoreHomeEnv();
      }
    },
  };
}
