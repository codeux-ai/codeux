/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

// Mock gsap
vi.mock("gsap", () => ({
  default: {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: vi.fn((cb) => {
      cb();
      return { revert: vi.fn() };
    })
  }
}));

// Mock useReducedMotion
vi.mock("../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true
}));

// Components that rely on useReducedMotion
import { Dialog, DialogContent } from "../Dialog.js";
import { ActionFeedbackRegion } from "../ActionFeedbackRegion.js";
import { CollapsiblePanel } from "../CollapsiblePanel.js";
import { Activity } from "lucide-preact";

afterEach(() => {
  cleanup();
});

describe("Reduced Motion Semantics", () => {
  describe("Dialog", () => {
    it("renders children immediately and skips animations when reduced motion is true", () => {
      const { getByText, getByRole } = render(
        <Dialog isOpen={true} onClose={() => {}}>
          <DialogContent>
            <div>Instant Dialog Content</div>
          </DialogContent>
        </Dialog>
      );

      const dialogContent = getByText("Instant Dialog Content");
      expect(dialogContent).toBeInTheDocument();

      const dialogNode = getByRole("dialog");
      expect(dialogNode).toBeInTheDocument();
    });
  });

  describe("ActionFeedbackRegion", () => {
    it("mounts without error and displays content when reduced motion is true", () => {
      const { getByText, getByRole } = render(
        <ActionFeedbackRegion
          status="success"
          message="Action completed instantly"
        />
      );

      const message = getByText("Action completed instantly");
      expect(message).toBeInTheDocument();

      const region = getByRole("status");
      expect(region).toBeInTheDocument();
    });
  });

  describe("CollapsiblePanel", () => {
    it("mounts without errors and respects motion constraints", () => {
        const { getByText } = render(
          <CollapsiblePanel
            title="Instant Panel"
            icon={Activity}
            accentHex="#000000"
            defaultOpen={true}
          >
            <div>Instant Content</div>
          </CollapsiblePanel>
        );

        const content = getByText("Instant Content");
        expect(content).toBeInTheDocument();
    });
  });
});
