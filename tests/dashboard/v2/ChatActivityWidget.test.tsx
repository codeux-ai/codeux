import { describe, it, expect } from "vitest";
import { render } from "@testing-library/preact";
import { ChatActivityWidget } from "../../../dashboard/src/v2/components/chat/ChatActivityWidget.js";

describe("ChatActivityWidget", () => {
  it("renders planning state correctly", () => {
    const { getByText, getByRole } = render(<ChatActivityWidget status="planning" />);
    const status = getByRole("status");
    expect(status.getAttribute("aria-label")).toBe("Thinking...");
    expect(getByText("thinking...")).toBeDefined();
  });

  it("renders with displayName correctly", () => {
    const { getByText } = render(<ChatActivityWidget status="waiting" displayName="Jules" />);
    expect(getByText("Jules is waiting for reply...")).toBeDefined();
  });
});
