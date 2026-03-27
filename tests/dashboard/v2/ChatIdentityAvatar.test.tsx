import { describe, it, expect } from "vitest";
import { render } from "@testing-library/preact";
import { ChatIdentityAvatar } from "../../../dashboard/src/v2/components/chat/ChatIdentityAvatar.js";

describe("ChatIdentityAvatar", () => {
  it("renders jules icon correctly", () => {
    const { container, getByLabelText } = render(<ChatIdentityAvatar role="assistant" isJules={true} />);
    const avatar = getByLabelText("Jules");
    expect(avatar).toBeDefined();
    expect(container.innerHTML).toContain("animate-pulse");
  });

  it("renders boat icon correctly", () => {
    const { container, getByLabelText } = render(<ChatIdentityAvatar role="connection" isCli={true} providerId="test-cli" />);
    const avatar = getByLabelText("test-cli");
    expect(avatar).toBeDefined();
    expect(container.innerHTML).toContain("animate-bounce");
  });

  it("renders user avatar correctly", () => {
    const { getByLabelText } = render(<ChatIdentityAvatar role="user" />);
    const avatar = getByLabelText("User");
    expect(avatar).toBeDefined();
  });
});
