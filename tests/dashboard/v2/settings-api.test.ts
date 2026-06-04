import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSettingsApiCacheForTests,
  fetchProjectEffectiveSettings,
} from "../../../dashboard/src/v2/lib/settings-api.js";

const jsonResponse = (body: unknown): Response => (
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
);

describe("settings-api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearSettingsApiCacheForTests();
  });

  it("does not share abortable effective-settings requests with stable consumers", async () => {
    const abortableController = new AbortController();
    const abortableRequest = new Promise<Response>((_, reject) => {
      abortableController.signal.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
    const stableSettings = {
      settings: { automationLevel: "FULL" },
      sources: {},
    };

    vi.stubGlobal("fetch", vi.fn((_: string, init?: RequestInit) => {
      if (init?.signal) {
        return abortableRequest;
      }
      return Promise.resolve(jsonResponse(stableSettings));
    }));

    const abortable = fetchProjectEffectiveSettings("project-1", { signal: abortableController.signal });
    const stable = fetchProjectEffectiveSettings("project-1");
    abortableController.abort();

    await expect(abortable).rejects.toThrow("Aborted");
    await expect(stable).resolves.toEqual(stableSettings);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bypasses the renderer effective-settings cache when reload is requested", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        settings: { automationLevel: "FULL" },
        sources: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        settings: { automationLevel: "LOW" },
        sources: { automationLevel: "project" },
      })));

    await expect(fetchProjectEffectiveSettings("project-1")).resolves.toMatchObject({
      settings: { automationLevel: "FULL" },
    });
    await expect(fetchProjectEffectiveSettings("project-1", { cache: "reload" })).resolves.toMatchObject({
      settings: { automationLevel: "LOW" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
