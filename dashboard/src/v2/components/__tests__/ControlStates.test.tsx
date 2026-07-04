// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/preact";
import { Button } from "../ui/Button.js";
import { IconButton } from "../IconButton.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Toggle } from "../ui/Toggle.js";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

afterEach(() => {
    cleanup();
});

vi.mock("gsap", () => ({
    default: {
        fromTo: vi.fn(),
        to: vi.fn(),
        set: vi.fn(),
        timeline: vi.fn(() => ({ to: vi.fn().mockReturnThis() })),
    },
}));

test('controls handle aria-invalid and disabled attributes', () => {
    const { container: btnContainer } = render(<Button disabled>Test</Button>);
    expect(btnContainer.querySelector('button')).toHaveAttribute('disabled');

    const { container: inputContainer } = render(<Input aria-invalid="true" />);
    expect(inputContainer.querySelector('input')).toHaveAttribute('aria-invalid', 'true');

    const { container: selectContainer } = render(<Select aria-invalid="true"><option>A</option></Select>);
    expect(selectContainer.querySelector('select')).toHaveAttribute('aria-invalid', 'true');

    const { container: toggleContainer } = render(<Toggle aria-label="Toggle" value={false} onChange={() => {}} disabled />);
    expect(toggleContainer.querySelector('button')).toHaveAttribute('disabled');
});

test('Button sets aria-busy true while loading', () => {
    const { container, rerender } = render(<Button pending={false}>Action</Button>);
    expect(container.querySelector('button')).not.toHaveAttribute('aria-busy', 'true');

    rerender(<Button pending={true}>Action</Button>);
    expect(container.querySelector('button')).toHaveAttribute('aria-busy', 'true');
});

test('buttons suppress clicks while aria-disabled or pending', () => {
    const buttonClick = vi.fn();
    const iconClick = vi.fn();

    const { getByRole, rerender } = render(<Button aria-disabled="true" onClick={buttonClick}>Action</Button>);
    fireEvent.click(getByRole('button', { name: 'Action' }));
    expect(buttonClick).not.toHaveBeenCalled();

    rerender(<Button pending onClick={buttonClick}>Action</Button>);
    fireEvent.click(getByRole('button', { name: 'Action' }));
    expect(buttonClick).not.toHaveBeenCalled();

    const { getByRole: getIconByRole, rerender: rerenderIcon } = render(
        <IconButton aria-label="Refresh" aria-disabled="true" onClick={iconClick}><span>R</span></IconButton>
    );
    fireEvent.click(getIconByRole('button', { name: 'Refresh' }));
    expect(iconClick).not.toHaveBeenCalled();

    rerenderIcon(<IconButton aria-label="Refresh" pending onClick={iconClick}><span>R</span></IconButton>);
    fireEvent.click(getIconByRole('button', { name: 'Refresh' }));
    expect(iconClick).not.toHaveBeenCalled();
});

test('shared controls expose visible focus and reduced-motion-safe token classes', () => {
    const { container } = render(
        <div>
            <Button>Save</Button>
            <IconButton aria-label="Refresh"><span>R</span></IconButton>
            <Select aria-disabled="true"><option>A</option></Select>
        </div>
    );

    const [button, iconButton] = Array.from(container.querySelectorAll('button'));
    const select = container.querySelector('select');

    expect(button).toHaveClass('focus-visible:ring-[var(--focus-ring-signal)]');
    expect(iconButton).toHaveClass('focus-visible:ring-[var(--focus-ring-signal)]');
    expect(iconButton).toHaveClass('motion-reduce:duration-0');
    expect(iconButton).toHaveStyle({
        transitionDuration: '150ms',
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
    });
    expect(select).toHaveAttribute('aria-disabled', 'true');
    expect(select).toHaveClass('duration-[var(--interaction-control-feedback-duration)]');
    expect(select).toHaveClass('motion-reduce:duration-0');
});

test('Toggle maintains explicit aria-checked values', () => {
    const { container, rerender } = render(<Toggle aria-label="Toggle" value={false} onChange={() => {}} />);
    expect(container.querySelector('button')).toHaveAttribute('aria-checked', 'false');

    rerender(<Toggle aria-label="Toggle" value={true} onChange={() => {}} />);
    expect(container.querySelector('button')).toHaveAttribute('aria-checked', 'true');
});

test('Input wires helper/error text properly', () => {
    const { container, getByRole } = render(<Input id="test-input" errorText="Name is required" helperText="Not visible when error is present" />);

    const errorAlert = getByRole('alert');
    expect(errorAlert.textContent).toBe('Name is required');
    expect(errorAlert.id).toBe('test-input-error');

    const input = container.querySelector('input');
    expect(input).toHaveAttribute('aria-errormessage', 'test-input-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(container.querySelector('.min-h-\\[1\\.25rem\\]')).toBeInTheDocument();
});

test('Select wires helper/error text properly', () => {
    const { container, getByRole } = render(<Select id="test-select" helperText="Choose wisely"><option>1</option></Select>);

    const helperSpan = container.querySelector('span[id="test-select-helper"]');
    expect(helperSpan).not.toBeNull();
    expect(helperSpan?.textContent).toBe('Choose wisely');

    const select = container.querySelector('select');
    expect(select).toHaveAttribute('aria-describedby', 'test-select-helper');
});
