/** @vitest-environment jsdom */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { render, screen, cleanup } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { Dialog } from '../../../src/v2/components/ui/Dialog';
import { Modal } from '../../../src/v2/components/ui/Modal';
import { Drawer } from '../../../src/v2/components/ui/Drawer';

vi.mock('gsap', () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn((el, options) => {
      if (options && options.onComplete) {
        options.onComplete();
      }
    }),
    context: (cb) => { cb(); return { revert: vi.fn() }; },
    set: vi.fn(),
  }
}));

describe('Dialog Primitives Accessibility', () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { cb(); return 0; });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  const primitives = [
    { name: 'Dialog', Component: Dialog },
    { name: 'Modal', Component: Modal },
    { name: 'Drawer', Component: Drawer }
  ];

  primitives.forEach(({ name, Component }) => {
    describe(`${name}`, () => {
      it('has an accessible name', async () => {
        const onClose = vi.fn();
        render(
          <Component isOpen={true} onClose={onClose} ariaLabel={`${name} Label`}>
            <p>Content</p>
          </Component>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-label', `${name} Label`);
        expect(dialog).toHaveAttribute('aria-modal', 'true');
      });

      it('traps focus inside when tabbed', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        const onClose = vi.fn();

        render(
          <div>
            <button id="outside">Outside</button>
            <Component isOpen={true} onClose={onClose} ariaLabel="Test">
              <button id="inside-1">Inside 1</button>
              <button id="inside-2">Inside 2</button>
            </Component>
          </div>
        );

        vi.advanceTimersByTime(200); await Promise.resolve(); // yield // Allow focus trap to initialize

        const inside1 = screen.getByText('Inside 1');
        const inside2 = screen.getByText('Inside 2');

        expect(document.activeElement).toBe(inside1);

        await user.tab();
        expect(document.activeElement).toBe(inside2);

        await user.tab();
        expect(document.activeElement).toBe(inside1);
      });

      it('closes on Escape', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        const onClose = vi.fn();

        render(
          <Component isOpen={true} onClose={onClose} ariaLabel="Test">
            <button id="inside">Inside</button>
          </Component>
        );

        vi.advanceTimersByTime(200); await Promise.resolve(); // yield

        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalled();
      });

      it('returns focus to opener on close', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        const onClose = vi.fn();

                const TestComponent = () => {
          const [isOpen, setIsOpen] = useState(false);
          return (
            <div>
              <button onClick={() => setIsOpen(true)}>Open</button>
              <Component isOpen={isOpen} onClose={() => setIsOpen(false)} ariaLabel="Test">
                <button>Inside</button>
              </Component>
            </div>
          );
        };

        render(<TestComponent />);

        const openBtn = screen.getByText('Open');
        openBtn.focus();
        await user.click(openBtn);
        await Promise.resolve();
        vi.advanceTimersByTime(200); await Promise.resolve(); vi.runAllTimers();
        vi.advanceTimersByTime(200); await Promise.resolve(); // yield

        // let focus shift
        await Promise.resolve();
        const insideBtn = screen.getByText("Inside");
        insideBtn.focus();
        expect(document.activeElement).toBe(insideBtn);

        await user.keyboard('{Escape}');
        vi.advanceTimersByTime(500); // Allow close animation

        expect(document.activeElement).toBe(openBtn);
      });
    });
  });
});
