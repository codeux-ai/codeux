/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundManager } from "../../../dashboard/src/v2/components/backgrounds/BackgroundManager.js";

describe("BackgroundManager", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("uses a context-free fallback for the Nodes canvas", () => {
    render(<BackgroundManager mode="ANIMATED" animation="deep-ocean" staticColor="#111111" isDark suspendAnimation />);

    expect(screen.getByTestId("suspended-dashboard-background").style.backgroundColor).toBe("rgb(6, 10, 13)");
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("releases the animated background when the tab becomes hidden", () => {
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    const { queryByTestId } = render(
      <BackgroundManager mode="ANIMATED" animation="deep-ocean" staticColor="#111111" isDark={false} />,
    );

    expect(queryByTestId("suspended-dashboard-background")).toBeNull();
    act(() => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.getByTestId("suspended-dashboard-background").style.backgroundColor).toBe("rgb(219, 232, 248)");
  });
});
