import { describe, expect, it } from "vitest";
import { getModelCatalogProvider, getModelCatalogProviders } from "../../../../src/domain/model-catalog/model-catalog-loader.js";

describe("model catalog provider summaries", () => {
  it("exposes a provider list with known base API endpoints where models.dev publishes one", () => {
    const providers = getModelCatalogProviders();
    expect(providers.length).toBeGreaterThan(50);

    const alibaba = getModelCatalogProvider("alibaba");
    expect(alibaba?.name).toBeTruthy();
    expect(alibaba?.apiBaseUrl).toMatch(/^https:\/\//);
  });

  it("leaves apiBaseUrl undefined for providers that rely on their SDK's default endpoint", () => {
    const openai = getModelCatalogProvider("openai");
    expect(openai?.name).toBe("OpenAI");
    expect(openai?.apiBaseUrl).toBeUndefined();
  });

  it("returns undefined for an unknown provider id", () => {
    expect(getModelCatalogProvider("not-a-real-provider")).toBeUndefined();
  });
});
