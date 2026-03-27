/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/preact";
import { ChatIdentityAvatar } from "../../../dashboard/src/v2/components/chat/ChatIdentityAvatar.js";

import { beforeAll, vi } from "vitest";

describe("ChatIdentityAvatar", () => {
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

  it("renders correct label for jules role", () => {
    const { getByLabelText } = render(<ChatIdentityAvatar role="jules" />);
    expect(getByLabelText("Jules")).toBeDefined();
  });

  it("renders correct label for virtual role", () => {
    const { getByLabelText } = render(<ChatIdentityAvatar role="virtual" />);
    expect(getByLabelText("Virtual Worker")).toBeDefined();
  });

  it("renders correct label for user role", () => {
    const { getByLabelText } = render(<ChatIdentityAvatar role="user" />);
    expect(getByLabelText("User")).toBeDefined();
  });

  it("applies extra className", () => {
    const { container } = render(<ChatIdentityAvatar role="jules" className="test-class" />);
    expect(container.firstElementChild?.classList.contains("test-class")).toBe(true);
  });
});
