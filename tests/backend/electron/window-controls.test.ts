import { describe, expect, it, vi } from "vitest";
import {
  CODE_UX_RELEASES_LATEST_URL,
  openCodeUxUpdatesPage,
  toggleWindowMaximized,
  type MaximizableWindowTarget,
} from "../../../src/electron/window-controls.js";

class FakeWindow implements MaximizableWindowTarget {
  public maximizeCalls = 0;
  public unmaximizeCalls = 0;

  public constructor(private maximized: boolean) {}

  public isMaximized(): boolean {
    return this.maximized;
  }

  public maximize(): void {
    this.maximizeCalls += 1;
    this.maximized = true;
  }

  public unmaximize(): void {
    this.unmaximizeCalls += 1;
    this.maximized = false;
  }
}

describe("Electron window controls", () => {
  it("maximizes a restored window and returns the resulting maximized state", () => {
    const window = new FakeWindow(false);

    expect(toggleWindowMaximized(window)).toBe(true);
    expect(window.isMaximized()).toBe(true);
    expect(window.maximizeCalls).toBe(1);
    expect(window.unmaximizeCalls).toBe(0);
  });

  it("restores a maximized window and returns the resulting maximized state", () => {
    const window = new FakeWindow(true);

    expect(toggleWindowMaximized(window)).toBe(false);
    expect(window.isMaximized()).toBe(false);
    expect(window.maximizeCalls).toBe(0);
    expect(window.unmaximizeCalls).toBe(1);
  });

  it("opens the official latest releases URL for desktop updates", async () => {
    const openExternal = vi.fn<(url: string) => Promise<void>>(async () => undefined);

    await expect(openCodeUxUpdatesPage({ openExternal })).resolves.toBe(true);

    expect(CODE_UX_RELEASES_LATEST_URL).toBe("https://github.com/codeux-ai/codeux/releases/latest");
    expect(new URL(CODE_UX_RELEASES_LATEST_URL).hostname).toBe("github.com");
    expect(new URL(CODE_UX_RELEASES_LATEST_URL).pathname).toBe("/codeux-ai/codeux/releases/latest");
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(CODE_UX_RELEASES_LATEST_URL);
  });

  it("reports rejected update open requests without throwing", async () => {
    const openExternal = vi.fn<(url: string) => Promise<void>>(async () => {
      throw new Error("external opener unavailable");
    });

    await expect(openCodeUxUpdatesPage({ openExternal })).resolves.toBe(false);

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(CODE_UX_RELEASES_LATEST_URL);
  });
});
