/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/preact";
import { ProviderBrandIcon } from "../../../dashboard/src/v2/components/providers/ProviderBrandIcon.js";

describe("ProviderBrandIcon", () => {
  it("renders built-in provider brand assets", () => {
    render(<ProviderBrandIcon id="codex" />);

    expect(document.body.querySelector('img[src="/lobe-icons/codex-color.svg"]')).not.toBeNull();
  });

  it("renders fallback initials for unknown provider ids instead of the Jules asset", () => {
    render(<ProviderBrandIcon id="custom" fallbackLabel="Override" />);

    expect(document.body.querySelector('img[src="/lobe-icons/google-color.svg"]')).toBeNull();
    expect(document.body.querySelector('img[src="/lobe-icons/.svg"]')).toBeNull();
    expect(document.body.textContent).toContain("OV");
  });
});
