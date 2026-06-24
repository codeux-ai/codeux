import { describe, expect, it, vi } from "vitest";
import { JulesApiClient, JulesNotFoundError } from "../../../src/integrations/jules-api-client.js";
import axios from "axios";

const mockInstance = Object.assign(
  vi.fn(),
  {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: {
      request: {
        use: vi.fn((cb) => {
          (mockInstance.interceptors.request as any)._cb = cb;
        }),
      },
      response: {
        use: vi.fn((successCb, errorCb) => {
          (mockInstance.interceptors.response as any)._successCb = successCb;
          (mockInstance.interceptors.response as any)._errorCb = errorCb;
        }),
      }
    }
  }
);

vi.mock("axios", () => {
  return {
    default: {
      create: vi.fn(() => mockInstance),
      isAxiosError: vi.fn((err: any) => err && typeof err === "object" && (err.isAxiosError === true || err.response?.status !== undefined)),
    }
  };
});

describe("JulesApiClient coverage", () => {
    it("handles listAllSources pagination", async () => {
        vi.mocked(mockInstance.get)
            .mockResolvedValueOnce({ data: { sources: [{ id: "1" }], nextPageToken: "token" } })
            .mockResolvedValueOnce({ data: { sources: [{ id: "2" }] } });

        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key" });
        const res = await client.listAllSources();
        expect(res).toHaveLength(2);
    });

    it("handles listAllActivities pagination", async () => {
        vi.mocked(mockInstance.get)
            .mockResolvedValueOnce({ data: { activities: [{ id: "1" }], nextPageToken: "token" } })
            .mockResolvedValueOnce({ data: { activities: [{ id: "2" }] } });

        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key" });
        const res = await client.listAllActivities("sess");
        expect(res).toHaveLength(2);
    });

    it("hasApiKey and setApiKey normalize", () => {
        const client = new JulesApiClient({ baseUrl: "http://url" });
        expect(client.hasApiKey()).toBe(false);
        client.setApiKey("  ");
        expect(client.hasApiKey()).toBe(false);
        client.setApiKey("key");
        expect(client.hasApiKey()).toBe(true);
    });

    it("extractSessionId handling", () => {
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key" });
        expect(client.extractSessionId({})).toBeUndefined();
        expect(client.extractSessionId({ name: "sessions/1" })).toBe("1");
        expect(client.extractSessionId({ id: "sessions/1" })).toBe("1");
        expect(client.extractSessionId({ name: "" })).toBeUndefined();
        expect(client.extractSessionId({ id: "" })).toBeUndefined();
    });

    it("resolveSessionName handling", () => {
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key" });
        expect(client.resolveSessionName({})).toBeUndefined();
        expect(client.resolveSessionName({ name: "" })).toBeUndefined();
        expect(client.resolveSessionName({ id: "" })).toBeUndefined();
        expect(client.resolveSessionName({ id: "1" })).toBe("sessions/1");
        expect(client.resolveSessionName({ name: "sessions/2" })).toBe("sessions/2");
    });

    it("interceptor adds api key if present", async () => {
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key" });
        const cb = (mockInstance.interceptors.request as any)._cb;
        const config = await cb({ headers: {} });
        expect(config.headers["X-Goog-Api-Key"]).toBe("key");
    });

    it("interceptor removes api key if absent", async () => {
        const client = new JulesApiClient({ baseUrl: "http://url" });
        const cb = (mockInstance.interceptors.request as any)._cb;
        const config = await cb({ headers: { "X-Goog-Api-Key": "test" } });
        expect(config.headers["X-Goog-Api-Key"]).toBeUndefined();
    });

    it("interceptor retries on 429", async () => {
        vi.useFakeTimers();
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key" });
        const errorCb = (mockInstance.interceptors.response as any)._errorCb;
        
        mockInstance.mockResolvedValue({ data: "success" });

        const mockError = {
          config: { url: "http://url/test" },
          response: { status: 429 }
        };

        const promise = errorCb(mockError);
        
        await vi.runAllTimersAsync();
        
        const result = await promise;
        expect(result.data).toBe("success");
        expect(mockInstance).toHaveBeenCalledWith(mockError.config);

        vi.useRealTimers();
    });

    it("interceptor honors Retry-After on 429", async () => {
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key" });
        const errorCb = (mockInstance.interceptors.response as any)._errorCb;

        mockInstance.mockResolvedValue({ data: "ok" });
        const mockError = {
          config: { url: "http://url/test" },
          response: { status: 429, headers: { "retry-after": "3" } },
        };

        const promise = errorCb(mockError);
        await vi.runAllTimersAsync();
        await promise;

        // 3s Retry-After should dominate the 1s first-attempt backoff.
        expect(setTimeoutSpy.mock.calls.some(([, ms]) => ms === 3000)).toBe(true);
        setTimeoutSpy.mockRestore();
        vi.useRealTimers();
    });

    it("throttles request starts by the minimum interval", async () => {
        vi.useFakeTimers();
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 200 });
        const cb = (mockInstance.interceptors.request as any)._cb;

        await cb({ headers: {} });

        let resolved = false;
        const second = cb({ headers: {} }).then(() => { resolved = true; });
        await Promise.resolve();
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(200);
        await second;
        expect(resolved).toBe(true);

        vi.useRealTimers();
    });

    it("fetchRecentActivitiesLite returns recent activities without per-activity hydration", async () => {
        vi.mocked(mockInstance.get).mockReset();
        vi.mocked(mockInstance.get)
            .mockResolvedValueOnce({ data: { activities: [{ id: "a1", createTime: "2026-01-02T00:00:00Z", agentMessaged: { agentMessage: "second" } }], nextPageToken: "t" } })
            .mockResolvedValueOnce({ data: { activities: [{ id: "a0", createTime: "2026-01-01T00:00:00Z", agentMessaged: { agentMessage: "first" } }] } });

        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 0 });
        const res = await client.fetchRecentActivitiesLite("sessions/x", 5);

        // Sorted ascending by createTime, and only the two list calls (no getActivity hydration).
        expect(res.map((a) => a.id)).toEqual(["a0", "a1"]);
        expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it("getCachedSessions coalesces concurrent callers into a single fetch", async () => {
        vi.mocked(mockInstance.get).mockReset();
        let resolveGet: (v: unknown) => void = () => {};
        vi.mocked(mockInstance.get).mockReturnValueOnce(new Promise((r) => { resolveGet = r; }));

        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 0, now: () => 0 });
        const p1 = client.getCachedSessions();
        const p2 = client.getCachedSessions();
        resolveGet({ data: { sessions: [{ id: "1" }] } });
        const [r1, r2] = await Promise.all([p1, p2]);

        expect(mockInstance.get).toHaveBeenCalledTimes(1);
        expect(r1).toBe(r2);
        expect(r1.map((s) => s.id)).toEqual(["1"]);
    });

    it("getCachedSessions serves the cached snapshot within the TTL and re-fetches after expiry", async () => {
        vi.mocked(mockInstance.get).mockReset();
        vi.mocked(mockInstance.get)
            .mockResolvedValueOnce({ data: { sessions: [{ id: "1" }] } })
            .mockResolvedValueOnce({ data: { sessions: [{ id: "2" }] } });

        let t = 0;
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 0, sessionsCacheTtlMs: 1000, now: () => t });

        expect((await client.getCachedSessions()).map((s) => s.id)).toEqual(["1"]);
        t = 500; // within TTL -> cached
        expect((await client.getCachedSessions()).map((s) => s.id)).toEqual(["1"]);
        expect(mockInstance.get).toHaveBeenCalledTimes(1);
        t = 1500; // expired -> refetch
        expect((await client.getCachedSessions()).map((s) => s.id)).toEqual(["2"]);
        expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it("getCachedSessions paginates and stops at maxSnapshotSessions", async () => {
        vi.mocked(mockInstance.get).mockReset();
        vi.mocked(mockInstance.get)
            .mockResolvedValueOnce({ data: { sessions: [{ id: "1" }, { id: "2" }], nextPageToken: "t" } })
            .mockResolvedValueOnce({ data: { sessions: [{ id: "3" }] } });

        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 0, now: () => 0 });
        expect((await client.getCachedSessions()).map((s) => s.id)).toEqual(["1", "2", "3"]);
    });

    it("sendSessionMessage invalidates the session snapshot so the next read refetches", async () => {
        vi.mocked(mockInstance.get).mockReset();
        vi.mocked(mockInstance.post).mockReset();
        vi.mocked(mockInstance.get)
            .mockResolvedValueOnce({ data: { sessions: [{ id: "1" }] } })
            .mockResolvedValueOnce({ data: { sessions: [{ id: "2" }] } });
        vi.mocked(mockInstance.post).mockResolvedValueOnce({ data: {} });

        // Long TTL so a re-fetch can only happen via invalidation.
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 0, sessionsCacheTtlMs: 1_000_000, now: () => 0 });
        expect((await client.getCachedSessions()).map((s) => s.id)).toEqual(["1"]);
        await client.sendSessionMessage("s", "hello");
        expect((await client.getCachedSessions()).map((s) => s.id)).toEqual(["2"]);
        expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it("getCachedSessions serves the last good snapshot when a refresh fails", async () => {
        vi.mocked(mockInstance.get).mockReset();
        vi.mocked(mockInstance.get)
            .mockResolvedValueOnce({ data: { sessions: [{ id: "1" }] } })
            .mockRejectedValueOnce(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }));

        let t = 0;
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 0, sessionsCacheTtlMs: 1000, now: () => t });
        expect((await client.getCachedSessions()).map((s) => s.id)).toEqual(["1"]);
        t = 2000; // expired -> refresh fails -> serve stale
        expect((await client.getCachedSessions()).map((s) => s.id)).toEqual(["1"]);
    });

    it("retries transient network errors (ETIMEDOUT) then resolves", async () => {
        vi.useFakeTimers();
        new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 0, maxTransientRetries: 2 });
        const errorCb = (mockInstance.interceptors.response as any)._errorCb;

        (mockInstance as any).mockReset();
        (mockInstance as any).mockResolvedValueOnce({ data: "recovered" });
        const config = { url: "/sessions" };
        const err = Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:443"), { code: "ETIMEDOUT", config });

        const p = errorCb(err);
        await vi.advanceTimersByTimeAsync(35000);
        await expect(p).resolves.toEqual({ data: "recovered" });
        expect(mockInstance).toHaveBeenCalledWith(config);
        vi.useRealTimers();
    });

    it("does not retry non-transient HTTP errors", async () => {
        new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 0 });
        const errorCb = (mockInstance.interceptors.response as any)._errorCb;
        const err = { response: { status: 404 }, config: { url: "/x" }, message: "Request failed with status code 404" };
        await expect(errorCb(err)).rejects.toBe(err);
    });

    it("handles 404 in listAllActivities by throwing JulesNotFoundError", async () => {
        vi.mocked(mockInstance.get).mockReset();
        const err = Object.assign(new Error("Request failed with status code 404"), {
          response: { status: 404 },
          config: { url: "/sessions/sess/activities" }
        });
        vi.mocked(mockInstance.get).mockRejectedValueOnce(err);

        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key", minRequestIntervalMs: 0 });
        
        const promise = client.listAllActivities("sess");
        await expect(promise).rejects.toThrow("Jules activities not found for session: sess");
        await expect(promise).rejects.toBeInstanceOf(JulesNotFoundError);
    });
});
