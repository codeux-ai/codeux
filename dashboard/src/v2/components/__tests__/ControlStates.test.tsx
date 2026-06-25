// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { render } from "@testing-library/preact";
import { Button } from "../ui/Button.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Toggle } from "../ui/Toggle.js";

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
});

test('Select wires helper/error text properly', () => {
    const { container, getByRole } = render(<Select id="test-select" helperText="Choose wisely"><option>1</option></Select>);

    const helperSpan = container.querySelector('span[id="test-select-helper"]');
    expect(helperSpan).not.toBeNull();
    expect(helperSpan?.textContent).toBe('Choose wisely');

    const select = container.querySelector('select');
    expect(select).toHaveAttribute('aria-describedby', 'test-select-helper');
});
