/** @vitest-environment jsdom */
import { render, screen, cleanup } from '@testing-library/preact';
import { expect, test, afterEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { Select } from '../Select.js';

expect.extend(matchers);

afterEach(() => {
    cleanup();
});

test('passes down aria attributes correctly', () => {
    render(
        <Select aria-label="Pick an option" aria-describedby="help-text" aria-invalid="true" aria-errormessage="error-msg">
            <option value="1">Option 1</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Pick an option' });
    expect(select).toBeInTheDocument();
    expect(select).toHaveAttribute('aria-describedby', 'help-text');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-errormessage', 'error-msg');
});

test('handles disabled controls', () => {
    render(<Select aria-label="Disabled Select" disabled><option value="1">Option 1</option></Select>);

    const select = screen.getByRole('combobox', { name: 'Disabled Select' });
    expect(select).toBeDisabled();
});

test('applies valid attributes correctly', () => {
    render(
        <Select aria-label="Valid Select" valid={true}>
            <option value="1">Option 1</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Valid Select' });
    expect(select).toHaveAttribute('data-valid', 'true');
});
