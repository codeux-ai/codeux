/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/preact";
import { ProviderInstanceCard } from "../../../../../../dashboard/src/v2/components/settings/ProviderInstanceCard";
import type { SystemProviderConfig } from "../../../../../../dashboard/src/v2/lib/provider-runtime-preview";

describe("ProviderInstanceCard", () => {
  it("opens the token pricing modal, edits fields, and saves", async () => {
    const provider: SystemProviderConfig = {
      provider: "opencode",
      name: "Test Provider",
      apiKey: "test",
      mountAuth: false,
      authPath: ""
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="test-id"
        provider={provider}
        providerModel="test-model"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    // Open the token pricing modal
    const tokenPricingBtn = screen.getByText("Token pricing");
    expect(tokenPricingBtn).toBeDefined();
    fireEvent.click(tokenPricingBtn);

    // Assert that the modal opens
    expect(screen.getByText("Configure cost per million tokens for accurate execution metrics.")).toBeDefined();

    // Find the inputs
    const inputTokensInput = screen.getAllByRole("spinbutton")[0];
    const outputTokensInput = screen.getAllByRole("spinbutton")[1];
    const cachedInputTokensInput = screen.getAllByRole("spinbutton")[2];

    // Change values
    fireEvent.input(inputTokensInput, { target: { value: "0.15" } });
    fireEvent.input(outputTokensInput, { target: { value: "0.60" } });
    fireEvent.input(cachedInputTokensInput, { target: { value: "0.05" } });

    // Save pricing
    const saveBtn = screen.getByText("Save pricing");
    fireEvent.click(saveBtn);

    // Assert that onUpdate was called with the new pricing
    expect(onUpdate).toHaveBeenCalledWith({
      tokenPricing: {
        inputTokens: 0.15,
        outputTokens: 0.6,
        cachedInputTokens: 0.05,
      },
    });
  });
});
