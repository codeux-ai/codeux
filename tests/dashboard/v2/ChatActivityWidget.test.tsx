/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/preact";
import { ChatActivityWidget } from "../../../dashboard/src/v2/components/chat/ChatActivityWidget.js";

describe("ChatActivityWidget", () => {
  it("renders planning state label correctly", () => {
    const { getByText } = render(<ChatActivityWidget state="planning" />);
    expect(getByText("Planning next steps")).toBeDefined();
  });

  it("renders waiting state label correctly", () => {
    const { getByText } = render(<ChatActivityWidget state="waiting" />);
    expect(getByText("Waiting for reply")).toBeDefined();
  });

  it("renders custom message if provided", () => {
    const { getByText } = render(<ChatActivityWidget state="planning" message="Custom thinking" />);
    expect(getByText("Custom thinking")).toBeDefined();
  });

  it("renders nothing when state is idle", () => {
    const { container } = render(<ChatActivityWidget state="idle" />);
    expect(container.firstChild).toBeNull();
  });
});
