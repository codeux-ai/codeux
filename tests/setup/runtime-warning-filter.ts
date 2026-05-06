import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const originalEmitWarning = process.emitWarning.bind(process);
const originalLogLevel = process.env.LOG_LEVEL;
const isolatedHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-ux-vitest-home-"));

process.env.HOME = isolatedHomeDir;
process.env.USERPROFILE = isolatedHomeDir;
process.env.XDG_CONFIG_HOME = path.join(isolatedHomeDir, ".config");
process.env.XDG_STATE_HOME = path.join(isolatedHomeDir, ".local", "state");
process.env.XDG_CACHE_HOME = path.join(isolatedHomeDir, ".cache");

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
