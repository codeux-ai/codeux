import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("runtime warning filter", () => {
  let originalEmitWarning: typeof process.emitWarning;
  let forwardedWarnings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalEmitWarning = process.emitWarning;
    forwardedWarnings = vi.fn();
    process.emitWarning = forwardedWarnings as typeof process.emitWarning;
    vi.resetModules();
  });

  afterEach(() => {
    process.emitWarning = originalEmitWarning;
    vi.restoreAllMocks();
  });

  it("suppresses Node SQLite experimental warnings", async () => {
    const { installRuntimeWarningFilter } = await import("../../src/runtime-warning-filter.js");

    installRuntimeWarningFilter();
    process.emitWarning("SQLite is an experimental feature and might change at any time", "ExperimentalWarning");

    expect(forwardedWarnings).not.toHaveBeenCalled();
  });

  it("forwards unrelated warnings to the original process emitter", async () => {
    const { installRuntimeWarningFilter } = await import("../../src/runtime-warning-filter.js");

    installRuntimeWarningFilter();
    process.emitWarning("Other runtime warning", "Warning");

    expect(forwardedWarnings).toHaveBeenCalledTimes(1);
    expect(forwardedWarnings).toHaveBeenCalledWith("Other runtime warning", "Warning");
  });

  it("does not wrap the process emitter more than once", async () => {
    const { installRuntimeWarningFilter } = await import("../../src/runtime-warning-filter.js");

    installRuntimeWarningFilter();
    installRuntimeWarningFilter();
    process.emitWarning("Other runtime warning", "Warning");

    expect(forwardedWarnings).toHaveBeenCalledTimes(1);
  });
});
