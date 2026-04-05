import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchJson } from "../../../dashboard/src/lib/api/fetch-json.js";

describe("fetchJson", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should return JSON on success", async () => {
    const mockData = { hello: "world" };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify(mockData),
    } as any);

    const result = await fetchJson("/api/test");
    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith("/api/test", undefined);
  });

  it("should handle empty response body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "",
    } as any);

    const result = await fetchJson("/api/empty");
    expect(result).toEqual({});
  });

  it("should handle 204 No Content response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => { throw new Error("Should not be called"); },
    } as any);

    const result = await fetchJson("/api/204");
    expect(result).toEqual({});
  });

  it("should throw error with JSON error message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "Bad Request" }),
    } as any);

    await expect(fetchJson("/api/fail")).rejects.toThrow("Bad Request");
  });

  it("should throw generic error if non-JSON or missing error property", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error("Not JSON"); },
    } as any);

    await expect(fetchJson("/api/fail-500")).rejects.toThrow("Request failed: /api/fail-500");
  });

  it("should preserve AbortSignal", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "{}",
    } as any);

    await fetchJson("/api/abort", { signal: controller.signal });
    expect(fetch).toHaveBeenCalledWith("/api/abort", { signal: controller.signal });
  });
});
