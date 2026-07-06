import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeEach, vi } from "vitest";

const originalEmitWarning = process.emitWarning.bind(process);
const originalLogLevel = process.env.LOG_LEVEL;
const DETERMINISTIC_TIME_ZONE = "UTC";
const DETERMINISTIC_LOCALE = "C.UTF-8";

process.env.TZ = DETERMINISTIC_TIME_ZONE;
process.env.LANG = DETERMINISTIC_LOCALE;
process.env.LC_ALL = DETERMINISTIC_LOCALE;

const createIsolatedHomeDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "code-ux-vitest-home-"));
const isolatedHomeDir = createIsolatedHomeDir();

interface HomeEnvSnapshot {
  HOME: string | undefined;
  USERPROFILE: string | undefined;
  XDG_CONFIG_HOME: string | undefined;
  XDG_STATE_HOME: string | undefined;
  XDG_CACHE_HOME: string | undefined;
}

const captureHomeEnv = (): HomeEnvSnapshot => ({
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
});

const restoreEnvValue = (key: keyof HomeEnvSnapshot, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

const applyIsolatedHomeEnv = (homeDir: string): void => {
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.XDG_CONFIG_HOME = path.join(homeDir, ".config");
  process.env.XDG_STATE_HOME = path.join(homeDir, ".local", "state");
  process.env.XDG_CACHE_HOME = path.join(homeDir, ".cache");
};

const restoreHomeEnv = (snapshot: HomeEnvSnapshot): void => {
  restoreEnvValue("HOME", snapshot.HOME);
  restoreEnvValue("USERPROFILE", snapshot.USERPROFILE);
  restoreEnvValue("XDG_CONFIG_HOME", snapshot.XDG_CONFIG_HOME);
  restoreEnvValue("XDG_STATE_HOME", snapshot.XDG_STATE_HOME);
  restoreEnvValue("XDG_CACHE_HOME", snapshot.XDG_CACHE_HOME);
};

applyIsolatedHomeEnv(isolatedHomeDir);

export function restoreLeakedFakeTimers(): boolean {
  if (!vi.isFakeTimers()) {
    return false;
  }

  vi.useRealTimers();
  return true;
}

beforeEach(() => {
  if (restoreLeakedFakeTimers()) {
    throw new Error("Vitest fake timers leaked from a previous test. Call vi.useRealTimers() before the test finishes.");
  }
});

afterAll(() => {
  if (restoreLeakedFakeTimers()) {
    throw new Error("Vitest fake timers were still enabled after this test file. Call vi.useRealTimers() during cleanup.");
  }
});

const removeTempHomeDir = (homeDir: string): void => {
  try {
    fs.rmSync(homeDir, { recursive: true, force: true });
  } catch (error) {
    if (!isWindowsTempLockError(error, homeDir)) {
      throw error;
    }
  }
};

const isPromiseLike = <T>(value: T | Promise<T>): value is Promise<T> => {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
};

export function withIsolatedTestHome<T>(callback: (homeDir: string) => Promise<T>): Promise<T>;
export function withIsolatedTestHome<T>(callback: (homeDir: string) => T): T;
export function withIsolatedTestHome<T>(callback: (homeDir: string) => T | Promise<T>): T | Promise<T> {
  const previousEnv = captureHomeEnv();
  const homeDir = createIsolatedHomeDir();
  applyIsolatedHomeEnv(homeDir);

  const cleanup = (): void => {
    restoreHomeEnv(previousEnv);
    removeTempHomeDir(homeDir);
  };

  try {
    const result = callback(homeDir);
    if (isPromiseLike(result)) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning?.message ?? "";
  const type = warning instanceof Error
    ? warning.name
    : typeof args[0] === "string"
      ? args[0]
      : "";

  if (type === "ExperimentalWarning" && message.includes("SQLite is an experimental feature")) {
    return;
  }

  return originalEmitWarning(warning as never, ...(args as []));
}) as typeof process.emitWarning;

process.env.LOG_LEVEL = originalLogLevel ?? "error";
// Force console verbosity to error level regardless of any persisted dashboard
// `consoleLogLevel` setting that services load at runtime. Without this, services
// that boot maintenance/cleanup routines (database maintenance, docker prune,
// sprint preview cleanup) spew INFO logs into the test reporter. Honor an explicit
// caller override so suites that assert on logging can opt back in.
process.env.CODEUX_FORCE_LOG_LEVEL = process.env.CODEUX_FORCE_LOG_LEVEL ?? "error";

const isWindowsTempLockError = (error: unknown, targetPath: unknown): boolean => {
  if (process.platform !== "win32" || !error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  if (code !== "EBUSY" && code !== "EPERM") {
    return false;
  }
  const resolvedTarget = path.resolve(String(targetPath));
  const resolvedTemp = path.resolve(os.tmpdir());
  return resolvedTarget === resolvedTemp || resolvedTarget.startsWith(`${resolvedTemp}${path.sep}`);
};

vi.doMock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      try {
        return await actual.rm(...args);
      } catch (error) {
        if (isWindowsTempLockError(error, args[0])) {
          return undefined;
        }
        throw error;
      }
    },
  };
});

const installAnimationFramePolyfill = (): void => {
  const target = globalThis as typeof globalThis & {
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame?: (id: number) => void;
    window?: Window & typeof globalThis;
  };

  if (!target.requestAnimationFrame) {
    target.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      return setTimeout(() => callback(Date.now()), 0) as unknown as number;
    };
  }

  if (!target.cancelAnimationFrame) {
    target.cancelAnimationFrame = (id: number): void => {
      clearTimeout(id);
    };
  }

  if (target.window) {
    target.window.requestAnimationFrame ??= target.requestAnimationFrame;
    target.window.cancelAnimationFrame ??= target.cancelAnimationFrame;
  }
};

installAnimationFramePolyfill();

const createCanvasGradientStub = (): CanvasGradient => ({
  addColorStop: () => {},
}) as CanvasGradient;

const createCanvasContextStub = (): CanvasRenderingContext2D => {
  return new Proxy({
    canvas: null,
    createLinearGradient: createCanvasGradientStub,
    createRadialGradient: createCanvasGradientStub,
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
    createImageData: () => ({ data: new Uint8ClampedArray(0) }),
  } as Record<string, unknown>, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof typeof target];
      }
      return () => undefined;
    },
    set(target, property, value) {
      target[property as keyof typeof target] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
};

const installCanvasContextPolyfill = (): void => {
  const target = globalThis as typeof globalThis & {
    HTMLCanvasElement?: {
      prototype?: {
        getContext?: (contextId: string) => RenderingContext | null;
      };
    };
  };

  const canvasPrototype = target.HTMLCanvasElement?.prototype;
  if (!canvasPrototype) {
    return;
  }

  canvasPrototype.getContext = (contextId: string): RenderingContext | null => {
    if (
      contextId === "2d"
      || contextId === "webgl"
      || contextId === "experimental-webgl"
      || contextId === "webgl2"
    ) {
      return createCanvasContextStub() as unknown as RenderingContext;
    }
    return null;
  };
};

installCanvasContextPolyfill();

// In DOM test environments (happy-dom/jsdom) component effects frequently fire
// real `fetch` calls against relative `/api/...` paths. Those resolve against the
// environment's default origin (http://localhost:3000) and hit the network: in
// Node they log `ECONNREFUSED` noise, and under happy-dom they stay pending until
// the window teardown aborts them, surfacing `AbortError` traces after otherwise
// green suites. Install a default stub that short-circuits unmocked requests with
// a benign 503 Response — no socket, nothing pending at teardown. Tests that
// exercise fetch override this via vi.stubGlobal/vi.spyOn, so they are unaffected.
const installDefaultFetchGuard = (): void => {
  const target = globalThis as typeof globalThis & { window?: unknown; Response?: typeof Response };
  if (typeof target.window === "undefined" || typeof target.Response === "undefined") {
    return;
  }

  target.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String((input as Request).url ?? input);
    return new target.Response!(
      JSON.stringify({ error: "network access is disabled in unit tests", url }),
      { status: 503, statusText: "Service Unavailable", headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
};

installDefaultFetchGuard();
