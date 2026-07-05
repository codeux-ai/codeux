/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageContainer } from "../PageContainer.js";

vi.mock("../../../lib/motion/index.js", () => ({
  useInteractionTokens: vi.fn(() => ({
    controlFeedback: { duration: "0ms", ease: "linear" },
    enterExit: { duration: "0ms", ease: "linear" },
  })),
}));

describe("PageContainer", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps unlabeled route wrappers out of generic landmarks and focus fallbacks", () => {
    const { container } = render(<PageContainer>Unlabeled page</PageContainer>);

    const wrapper = container.firstElementChild;
    expect(screen.queryByRole("region", { name: "Page content" })).not.toBeInTheDocument();
    expect(wrapper).not.toHaveAttribute("role");
    expect(wrapper).not.toHaveAttribute("aria-label");
    expect(wrapper).not.toHaveAttribute("data-focus-fallback");
    expect(wrapper).not.toHaveAttribute("tabindex");
  });

  it("keeps named route wrappers available as navigation focus fallbacks", () => {
    render(<PageContainer aria-label="Scheduler">Scheduler page</PageContainer>);

    const wrapper = screen.getByRole("region", { name: "Scheduler" });
    expect(wrapper).toHaveAttribute("data-focus-fallback", "");
    expect(wrapper).toHaveAttribute("tabindex", "-1");
  });

  it("accepts aria-labelledby as the required accessible name for fallback targets", () => {
    render(
      <PageContainer aria-labelledby="route-title">
        <h1 id="route-title">Knowledge</h1>
      </PageContainer>,
    );

    const wrapper = screen.getByRole("region", { name: "Knowledge" });
    expect(wrapper).toHaveAttribute("data-focus-fallback", "");
    expect(wrapper).toHaveAttribute("tabindex", "-1");
  });
});
