import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import type { AxiosInstance } from "axios";
import { JulesApiClient, type JulesCreateSessionRequest } from "../../../src/integrations/jules-api-client.js";

type HeaderCarrier = { headers?: Record<string, string> };
type RequestInterceptor = (config: HeaderCarrier) => HeaderCarrier;

vi.mock("axios", () => ({
  default: {
    create: vi.fn(),
  },
}));

describe("JulesApiClient", () => {
  const get = vi.fn();
  const post = vi.fn();
  const use = vi.fn();
  const axiosCreate = vi.mocked(axios.create);
  let requestInterceptor: RequestInterceptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    requestInterceptor = undefined;

    use.mockImplementation((handler: RequestInterceptor) => {
      requestInterceptor = handler;
      return 0;
    });

    axiosCreate.mockReturnValue({
      get,
      post,
      interceptors: {
        request: { use },
      },
    } as unknown as AxiosInstance);
  });

  it("maps listSources args to Jules API query params", async () => {
    get.mockResolvedValue({
      data: {
        sources: [{ id: "sources/1", name: "sources/1" }],
        nextPageToken: "next-source-token",
      },
    });

    const client = new JulesApiClient({
      apiKey: "api-key",
      baseUrl: "https://example.test",
    });

    const response = await client.listSources({
      filter: "state:ACTIVE",
      page_size: 25,
      page_token: "token-1",
    });

    expect(get).toHaveBeenCalledWith("/sources", {
      params: {
        filter: "state:ACTIVE",
        pageSize: 25,
        pageToken: "token-1",
      },
    });
    expect(response.sources).toHaveLength(1);
    expect(response.nextPageToken).toBe("next-source-token");
  });

  it("paginates listAllSources until no nextPageToken remains", async () => {
    get
      .mockResolvedValueOnce({
        data: {
          sources: [{ id: "sources/1", name: "sources/1" }],
          nextPageToken: "token-2",
        },
      })
      .mockResolvedValueOnce({
        data: {
          sources: [{ id: "sources/2", name: "sources/2" }],
        },
      });

    const client = new JulesApiClient({
      apiKey: "api-key",
      baseUrl: "https://example.test",
    });

    const sources = await client.listAllSources("state:ACTIVE");

    expect(sources).toHaveLength(2);
    expect(get).toHaveBeenNthCalledWith(1, "/sources", {
      params: { filter: "state:ACTIVE", pageToken: undefined },
    });
    expect(get).toHaveBeenNthCalledWith(2, "/sources", {
      params: { filter: "state:ACTIVE", pageToken: "token-2" },
    });
  });

  it("normalizes session names for session and activity routes", async () => {
    get.mockResolvedValue({ data: { sessions: [] } });
    post.mockResolvedValue({ data: { name: "sessions/123" } });

    const client = new JulesApiClient({
      apiKey: "api-key",
      baseUrl: "https://example.test",
    });

    await client.getSession("123");
    await client.listActivities({ session_id: "sessions/123", page_size: 10, page_token: "page-1" });
    await client.approveSessionPlan("sessions/123");
    await client.sendSessionMessage("123", "Need more detail");

    expect(get).toHaveBeenNthCalledWith(1, "/sessions/123");
    expect(get).toHaveBeenNthCalledWith(2, "/sessions/123/activities", {
      params: {
        pageSize: 10,
        pageToken: "page-1",
      },
    });
    expect(post).toHaveBeenNthCalledWith(1, "/sessions/123:approvePlan");
    expect(post).toHaveBeenNthCalledWith(2, "/sessions/123:sendMessage", { prompt: "Need more detail" });
  });

  it("uses typed createSession payload and request interceptor api key", async () => {
    post.mockResolvedValue({
      data: {
        name: "sessions/s-1",
        id: "sessions/s-1",
        prompt: "Build it",
      },
    });

    const client = new JulesApiClient({
      apiKey: "api-key",
      baseUrl: "https://example.test",
    });

    const payload: JulesCreateSessionRequest = {
      prompt: "Build it",
      title: "Task",
      sourceContext: {
        source: "sources/abc",
        githubRepoContext: { startingBranch: "feature/sprint1" },
      },
      automationMode: "AUTO_CREATE_PR",
      requirePlanApproval: false,
    };

    await client.createSession(payload);

    expect(post).toHaveBeenCalledWith("/sessions", payload);
    expect(requestInterceptor).toBeDefined();

    const firstConfig = requestInterceptor!({ headers: {} });
    expect(firstConfig.headers?.["X-Goog-Api-Key"]).toBe("api-key");

    client.setApiKey("\n");
    const secondConfig = requestInterceptor!({ headers: { "X-Goog-Api-Key": "stale" } });
    expect(secondConfig.headers?.["X-Goog-Api-Key"]).toBeUndefined();
  });

  it("rejects requests when api key is missing", async () => {
    const client = new JulesApiClient({
      apiKey: "",
      baseUrl: "https://example.test",
    });

    await expect(client.getSource("sources/1")).rejects.toThrow("Jules API key is not configured.");
    expect(get).not.toHaveBeenCalled();
  });
});
