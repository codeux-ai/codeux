import { readdir, readFile } from "node:fs/promises";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { withIsolatedTestHome } from "../../setup/runtime-warning-filter.js";

type HomeEnvKey = "HOME" | "USERPROFILE" | "XDG_CONFIG_HOME" | "XDG_STATE_HOME" | "XDG_CACHE_HOME";

type GuardrailViolation = {
  path: string;
  category: string;
  detail: string;
};

const HOME_ENV_KEYS: HomeEnvKey[] = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"];
const REPO_ROOT = process.cwd();
const BACKEND_TEST_ROOT = path.join(REPO_ROOT, "tests", "backend");

const DOCUMENTED_FAKE_TIMER_ALLOWLIST: Record<string, string> = {};

async function readRepoFile(repoRelativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, repoRelativePath), "utf8");
}

async function listBackendTestFiles(directory = BACKEND_TEST_ROOT): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listBackendTestFiles(fullPath);
    }
    if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) {
      return [path.relative(REPO_ROOT, fullPath).replaceAll(path.sep, "/")];
    }
    return [];
  }));

  return files.flat().sort();
}

function snapshotHomeEnv(): Record<HomeEnvKey, string | undefined> {
  return {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  };
}

function restoreHomeEnv(snapshot: Record<HomeEnvKey, string | undefined>): void {
  for (const key of HOME_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function expectIsolatedHomeEnv(homeDir: string): void {
  expect(process.env.HOME).toBe(homeDir);
  expect(process.env.USERPROFILE).toBe(homeDir);
  expect(process.env.XDG_CONFIG_HOME).toBe(path.join(homeDir, ".config"));
  expect(process.env.XDG_STATE_HOME).toBe(path.join(homeDir, ".local", "state"));
  expect(process.env.XDG_CACHE_HOME).toBe(path.join(homeDir, ".cache"));
  expect(os.homedir()).toBe(homeDir);
}

function formatViolations(violations: GuardrailViolation[]): string {
  return violations
    .map((violation) => `${violation.path}: ${violation.category} - ${violation.detail}`)
    .join("\n");
}

function hasAfterEachTimerCleanup(lines: string[]): boolean {
  return lines.some((line, index) => {
    if (!line.includes("afterEach")) {
      return false;
    }
    const cleanupWindow = lines.slice(index, Math.min(lines.length, index + 40)).join("\n");
    return cleanupWindow.includes("vi.useRealTimers(") || cleanupWindow.includes("restoreLeakedFakeTimers(");
  });
}

function hasNearbyTimerCleanup(lines: string[], fakeTimerLineIndex: number): boolean {
  const cleanupWindow = lines
    .slice(fakeTimerLineIndex, Math.min(lines.length, fakeTimerLineIndex + 220))
    .join("\n");
  return cleanupWindow.includes("vi.useRealTimers(") || cleanupWindow.includes("restoreLeakedFakeTimers(");
}

function findFakeTimerCleanupViolations(sources: Array<{ path: string; text: string }>): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  for (const source of sources) {
    if (!source.text.includes("vi.useFakeTimers(")) {
      continue;
    }

    const allowlistReason = DOCUMENTED_FAKE_TIMER_ALLOWLIST[source.path];
    if (allowlistReason?.trim()) {
      continue;
    }

    const lines = source.text.split(/\r?\n/);
    const hasFileCleanup = hasAfterEachTimerCleanup(lines);
    const missingCleanupLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.includes("vi.useFakeTimers("))
      .filter(({ index }) => !hasFileCleanup && !hasNearbyTimerCleanup(lines, index))
      .map(({ index }) => index + 1);

    if (missingCleanupLines.length > 0) {
      violations.push({
        path: source.path,
        category: "fake timer cleanup",
        detail: `vi.useFakeTimers() is missing nearby vi.useRealTimers(), restoreLeakedFakeTimers(), or afterEach cleanup in the same file near lines ${missingCleanupLines.join(", ")}`,
      });
    }
  }

  return violations;
}

function findAppStateIsolationViolations(
  sources: Array<{ path: string; text: string }>,
  vitestConfigText: string,
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const globalInMemoryDb = /process\.env\.VITEST_IN_MEMORY_DB\s*=\s*["']true["']/.test(vitestConfigText);

  for (const source of sources) {
    const disablesInMemoryDb = /process\.env\.VITEST_IN_MEMORY_DB\s*=\s*["']false["']/.test(source.text);
    const mutatesHomeEnv = /\bprocess\.env\.(HOME|USERPROFILE|XDG_CONFIG_HOME|XDG_STATE_HOME|XDG_CACHE_HOME)\s*=/.test(source.text)
      || /\bvi\.stubEnv\(\s*["'](HOME|USERPROFILE|XDG_CONFIG_HOME|XDG_STATE_HOME|XDG_CACHE_HOME)["']/.test(source.text);
    const usesDefaultAppDb = /\bnew\s+AppDbStorage\s*\(\s*\)/.test(source.text)
      || /\bcreateAppDbStorage\s*\(\s*\)/.test(source.text);
    const usesFileBackedSqlite = disablesInMemoryDb
      || /\bopenSqliteDatabase\s*\(/.test(source.text)
      || /\bnew\s+AppDbStorage\s*\([^)]/.test(source.text)
      || /\bnode:sqlite\b/.test(source.text);
    const usesIsolatedState = /\b(withIsolatedTestHome|withSqliteTempHome|createSqliteTempHome|removeSqliteTempHome)\b/.test(source.text)
      || /\b(fs\.)?mkdtemp(Sync)?\s*\(/.test(source.text)
      || /\bos\.tmpdir\s*\(/.test(source.text)
      || /["']:memory:["']/.test(source.text);

    if (usesDefaultAppDb && !globalInMemoryDb) {
      violations.push({
        path: source.path,
        category: "SQLite app state",
        detail: "default AppDbStorage usage requires vitest.config.ts to set VITEST_IN_MEMORY_DB=true",
      });
    }

    if ((disablesInMemoryDb || mutatesHomeEnv || usesFileBackedSqlite) && !usesIsolatedState) {
      violations.push({
        path: source.path,
        category: "filesystem app state",
        detail: "file-backed SQLite or HOME/XDG mutation must use withIsolatedTestHome(), SQLite temp helpers, :memory:, or an OS temp directory",
      });
    }
  }

  return violations;
}

describe("test determinism guardrails", () => {
  it("withIsolatedTestHome sets and restores all HOME and XDG paths after successful callbacks", async () => {
    const originalEnv = snapshotHomeEnv();
    const sentinelEnv: Record<HomeEnvKey, string> = {
      HOME: "/tmp/code-ux-original-home",
      USERPROFILE: "/tmp/code-ux-original-userprofile",
      XDG_CONFIG_HOME: "/tmp/code-ux-original-config",
      XDG_STATE_HOME: "/tmp/code-ux-original-state",
      XDG_CACHE_HOME: "/tmp/code-ux-original-cache",
    };
    let isolatedHome = "";

    try {
      restoreHomeEnv(sentinelEnv);

      const result = await withIsolatedTestHome(async (homeDir) => {
        isolatedHome = homeDir;
        expectIsolatedHomeEnv(homeDir);
        return "completed";
      });

      expect(result).toBe("completed");
      expect(snapshotHomeEnv()).toEqual(sentinelEnv);
      expect(fs.existsSync(isolatedHome)).toBe(false);
    } finally {
      restoreHomeEnv(originalEnv);
    }
  });

  it("withIsolatedTestHome restores all HOME and XDG paths after throwing callbacks", async () => {
    const originalEnv = snapshotHomeEnv();
    const sentinelEnv: Record<HomeEnvKey, string> = {
      HOME: "/tmp/code-ux-throw-home",
      USERPROFILE: "/tmp/code-ux-throw-userprofile",
      XDG_CONFIG_HOME: "/tmp/code-ux-throw-config",
      XDG_STATE_HOME: "/tmp/code-ux-throw-state",
      XDG_CACHE_HOME: "/tmp/code-ux-throw-cache",
    };
    let isolatedHome = "";
    const expectedError = new Error("intentional failure");

    try {
      restoreHomeEnv(sentinelEnv);

      await expect(withIsolatedTestHome(async (homeDir) => {
        isolatedHome = homeDir;
        expectIsolatedHomeEnv(homeDir);
        throw expectedError;
      })).rejects.toThrow(expectedError);

      expect(snapshotHomeEnv()).toEqual(sentinelEnv);
      expect(fs.existsSync(isolatedHome)).toBe(false);
    } finally {
      restoreHomeEnv(originalEnv);
    }
  });

  it("keeps Vitest configured for deterministic backend runtime defaults", async () => {
    const config = await readRepoFile("vitest.config.ts");

    expect(config).toMatch(/process\.env\.VITEST_IN_MEMORY_DB\s*=\s*["']true["']/);
    expect(config).toMatch(/process\.env\.TZ\s*=\s*["']UTC["']/);
    expect(config).toMatch(/process\.env\.LANG\s*=\s*["']C\.UTF-8["']/);
    expect(config).toMatch(/process\.env\.LC_ALL\s*=\s*["']C\.UTF-8["']/);
    expect(config).toMatch(/\benvironment:\s*["']node["']/);
  });

  it("requires backend fake-timer tests to clean timers explicitly", async () => {
    const files = await listBackendTestFiles();
    const sources = await Promise.all(files.map(async (filePath) => ({
      path: filePath,
      text: await readRepoFile(filePath),
    })));
    const violations = findFakeTimerCleanupViolations(sources);

    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("keeps backend filesystem app state and SQLite tests isolated from real user homes", async () => {
    const [vitestConfig, files] = await Promise.all([
      readRepoFile("vitest.config.ts"),
      listBackendTestFiles(),
    ]);
    const sources = await Promise.all(files.map(async (filePath) => ({
      path: filePath,
      text: await readRepoFile(filePath),
    })));
    const violations = findAppStateIsolationViolations(sources, vitestConfig);

    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
