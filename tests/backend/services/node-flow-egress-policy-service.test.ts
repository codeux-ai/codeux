import { describe, expect, it, vi } from "vitest";
import { EgressPolicyService } from "../../../src/services/node-flows/egress-policy-service.js";

const publicLookup = async (): Promise<Array<{ address: string; family: number }>> => [{ address: "8.8.8.8", family: 4 }];

describe("EgressPolicyService", () => {
  it.each([
    "https://127.0.0.1/x", "https://10.0.0.1/x", "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/x", "https://localhost/x", "https://[::1]/x",
  ])("rejects private, loopback, and metadata target %s", async (url) => {
    await expect(new EgressPolicyService().validateUrl(url)).rejects.toThrow(/private|loopback|metadata/i);
  });

  it("requires HTTPS, rejects URL credentials and raw credential headers", async () => {
    const service = new EgressPolicyService({ lookup: publicLookup });
    await expect(service.validateUrl("http://api.example.test/x")).rejects.toThrow(/HTTPS/);
    await expect(service.validateUrl("https://user:pass@api.example.test/x")).rejects.toThrow(/credentials/i);
    await expect(service.request({ url: "https://api.example.test/x", headers: { Authorization: "Bearer raw" } })).rejects.toThrow(/restricted/i);
  });

  it("detects rebinding and revalidates redirects", async () => {
    let lookups = 0;
    const rebinding = new EgressPolicyService({ lookup: async () => [{ address: ++lookups === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }] });
    await expect(rebinding.validateUrl("https://api.example.test/x")).rejects.toThrow(/rebinding/i);

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }));
    const redirects = new EgressPolicyService({ lookup: publicLookup, fetch: fetchMock });
    await expect(redirects.request({ url: "https://api.example.test/x" })).rejects.toThrow(/HTTPS|private/i);
  });

  it("bounds response size, retry count, and host allowlists", async () => {
    const oversized = new EgressPolicyService({ lookup: publicLookup, fetch: vi.fn().mockResolvedValue(new Response("12345", { headers: { "content-type": "text/plain", "content-length": "5" } })) });
    await expect(oversized.request({ url: "https://api.example.test/x", policy: { maxResponseBytes: 4 } })).rejects.toThrow(/size limit/i);
    await expect(oversized.validateUrl("https://other.example.test/x", { allowedHosts: ["api.example.test"] })).rejects.toThrow(/allowlisted/i);

    const fetchMock = vi.fn().mockImplementation(async () => new Response("retry", { status: 503, headers: { "content-type": "text/plain" } }));
    const retries = new EgressPolicyService({ lookup: publicLookup, fetch: fetchMock });
    const response = await retries.request({ url: "https://api.example.test/x", policy: { maxRetries: 2 } });
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([0, -1, 120_001, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects an unsafe request timeout of %s before dispatch",
    async (timeoutMs) => {
      const fetchMock = vi.fn();
      const service = new EgressPolicyService({ lookup: publicLookup, fetch: fetchMock });

      await expect(service.request({
        url: "https://api.example.test/x",
        policy: { timeoutMs },
      })).rejects.toThrow(/timeout must be between 1 and 120000/i);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([1, 120_000])("accepts the bounded request timeout %sms", async (timeoutMs) => {
    const service = new EgressPolicyService({
      lookup: publicLookup,
      fetch: vi.fn().mockResolvedValue(new Response("ok", { headers: { "content-type": "text/plain" } })),
    });

    await expect(service.request({
      url: "https://api.example.test/x",
      policy: { timeoutMs },
    })).resolves.toMatchObject({ status: 200 });
  });
});
