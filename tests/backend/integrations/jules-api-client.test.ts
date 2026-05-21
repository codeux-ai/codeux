import { describe, expect, it, vi } from "vitest";
import { JulesApiClient } from "../../../src/integrations/jules-api-client.js";
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

    it("interceptor adds api key if present", () => {
        const client = new JulesApiClient({ baseUrl: "http://url", apiKey: "key" });
        const cb = (mockInstance.interceptors.request as any)._cb;
        const config = cb({ headers: {} });
        expect(config.headers["X-Goog-Api-Key"]).toBe("key");
    });

    it("interceptor removes api key if absent", () => {
        const client = new JulesApiClient({ baseUrl: "http://url" });
        const cb = (mockInstance.interceptors.request as any)._cb;
        const config = cb({ headers: { "X-Goog-Api-Key": "test" } });
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
});
