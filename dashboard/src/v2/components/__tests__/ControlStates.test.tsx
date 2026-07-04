// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { Button } from "../ui/Button.js";
import { IconButton } from "../IconButton.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Toggle } from "../ui/Toggle.js";
import { DropdownMenu, DropdownMenuItem } from "../ui/DropdownMenu.js";
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
        killTweensOf: vi.fn(),
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

test('native disabled controls suppress activation and preserve disabled descriptions', () => {
    const buttonClick = vi.fn();
    const selectChange = vi.fn();

    const { getByRole } = render(
        <div>
            <p id="disabled-reason">Available after setup completes.</p>
            <Button disabled aria-describedby="disabled-reason" title="Available after setup completes" onClick={buttonClick}>Start</Button>
            <Select aria-disabled="true" helperText="Available after setup completes." onChange={selectChange}>
                <option>One</option>
                <option>Two</option>
            </Select>
        </div>
    );

    const button = getByRole('button', { name: 'Start' });
    fireEvent.click(button);
    expect(buttonClick).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('disabled');
    expect(button).toHaveAttribute('aria-describedby', 'disabled-reason');
    expect(button).toHaveAttribute('title', 'Available after setup completes');

    const select = getByRole('combobox');
    fireEvent.change(select, { target: { value: 'Two' } });
    expect(selectChange).not.toHaveBeenCalled();
    expect(select).toHaveAttribute('disabled');
    expect(select).toHaveAttribute('aria-disabled', 'true');
});

test('dropdown keyboard navigation skips disabled menu items and suppresses aria-disabled activation', async () => {
    const disabledClick = vi.fn();
    const enabledClick = vi.fn();

    const MenuHarness = () => {
        const [open, setOpen] = useState(false);
        return (
            <DropdownMenu
                isOpen={open}
                onOpenChange={setOpen}
                content={
                    <div>
                        <DropdownMenuItem aria-disabled="true" onClick={disabledClick}>Disabled item</DropdownMenuItem>
                        <DropdownMenuItem onClick={enabledClick}>Enabled item</DropdownMenuItem>
                    </div>
                }
            >
                <button type="button">Open menu</button>
            </DropdownMenu>
        );
    };

    const { getByRole } = render(<MenuHarness />);

    fireEvent.keyDown(getByRole('button', { name: 'Open menu' }), { key: 'ArrowDown' });

    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const enabledItem = getByRole('menuitem', { name: 'Enabled item' });
    expect(document.activeElement).toBe(enabledItem);

    fireEvent.click(getByRole('menuitem', { name: 'Disabled item' }));
    expect(disabledClick).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(enabledClick).toHaveBeenCalledTimes(1);
});

test('form controls suppress changes while disabled or aria-disabled', () => {
    const inputHandler = vi.fn();
    const selectHandler = vi.fn();

    const { container: inputContainer } = render(<Input aria-disabled="true" onInput={inputHandler} />);
    const input = inputContainer.querySelector('input')!;
    fireEvent.input(input, { target: { value: 'blocked' } });
    expect(inputHandler).not.toHaveBeenCalled();
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('aria-disabled', 'true');

    const { container: selectContainer } = render(
        <Select aria-disabled="true" onChange={selectHandler}>
            <option>A</option>
            <option>B</option>
        </Select>
    );
    const select = selectContainer.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'B' } });
    expect(selectHandler).not.toHaveBeenCalled();
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('aria-disabled', 'true');
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
    const { container, getByRole } = render(<Input id="test-input" errorText="Name is required" helperText="Not visible when error is present" forceValidation />);

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
