/** @vitest-environment jsdom */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { expect, test, afterEach, vi } from 'vitest';
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

test('renders an inert chevron affordance without covering select text', () => {
    const { container } = render(
        <Select aria-label="Pick an option">
            <option value="1">A very long option label that still has trailing icon space</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Pick an option' });
    const chevron = container.querySelector('svg[aria-hidden="true"]');

    expect(chevron).toBeInTheDocument();
    expect(chevron).toHaveClass('pointer-events-none');
    expect(chevron).toHaveClass('absolute');
    expect(chevron).toHaveClass('text-slate-400');
    expect(chevron).toHaveClass('dark:text-slate-500');
    expect(chevron).toHaveStyle({
        transitionProperty: 'color, opacity',
        transitionDuration: '150ms',
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
    });
    expect(select).toHaveClass('pr-10');
});

test('handles disabled controls', () => {
    const onChange = vi.fn();
    const { container } = render(<Select aria-label="Disabled Select" disabled onChange={onChange}><option value="1">Option 1</option></Select>);

    const select = screen.getByRole('combobox', { name: 'Disabled Select' });
    const chevron = container.querySelector('svg[aria-hidden="true"]');
    expect(select).toBeDisabled();
    expect(chevron).toHaveClass('opacity-50');
    fireEvent.change(select, { target: { value: '1' } });
    expect(onChange).not.toHaveBeenCalled();
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

test('suppresses aria-disabled changes and keeps recovery helper text described', () => {
    const onChange = vi.fn();
    render(
        <Select aria-label="Provider" aria-disabled="true" helperText="Enable a provider before changing this." onChange={onChange}>
            <option value="a">Provider A</option>
            <option value="b">Provider B</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Provider' });
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('aria-disabled', 'true');
    expect(select).toHaveAttribute('aria-describedby', expect.stringContaining('-helper'));
    expect(screen.getByText('Enable a provider before changing this.')).toBeInTheDocument();
});

test('error text owns invalid description and errormessage relationship', () => {
    const { container } = render(
        <Select id="provider-select" aria-label="Provider" helperText="Choose a provider." errorText="Provider is required.">
            <option value="">Choose</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Provider' });
    const alert = screen.getByRole('alert');
    const chevron = container.querySelector('svg[aria-hidden="true"]');
    expect(alert).toHaveAttribute('id', 'provider-select-error');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'provider-select-error');
    expect(select).toHaveAttribute('aria-errormessage', 'provider-select-error');
    expect(chevron).toHaveClass('text-status-red');
    expect(screen.queryByText('Choose a provider.')).not.toBeInTheDocument();
});

test('aria-invalid selects color the chevron as an error affordance', () => {
    const { container } = render(
        <Select aria-label="Invalid Select" aria-invalid="grammar">
            <option value="1">Option 1</option>
        </Select>
    );

    const chevron = container.querySelector('svg[aria-hidden="true"]');
    expect(chevron).toHaveClass('text-status-red');
});

test('focused invalid select restores helper description while the value is being corrected', async () => {
    render(
        <Select id="provider-select" aria-label="Provider" helperText="Choose a provider." errorText="Provider is required.">
            <option value="">Choose</option>
            <option value="local">Local</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Provider' });
    expect(select).toHaveAttribute('aria-describedby', 'provider-select-error');

    fireEvent.focus(select);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitFor(() => expect(select).toHaveAttribute('aria-describedby', 'provider-select-helper'));
    expect(select).not.toHaveAttribute('aria-invalid', 'true');

    fireEvent.blur(select);
    expect(screen.getByRole('alert')).toHaveTextContent('Provider is required.');
    expect(select).toHaveAttribute('aria-describedby', 'provider-select-error');
});

test('reduced motion keeps static validation cues without animated duration', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(query => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));

    const { container } = render(
        <Select aria-label="Validated select" valid>
            <option value="1">Option 1</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Validated select' });
    const chevron = container.querySelector('svg[aria-hidden="true"]');
    expect(select).toHaveAttribute('data-valid', 'true');
    expect(select).toHaveStyle({
        transitionDuration: '0ms',
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
    });
    expect(chevron).toHaveClass('motion-reduce:transition-none');
    expect(chevron).toHaveStyle({
        transitionDuration: '0ms',
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
    });

    window.matchMedia = originalMatchMedia;
});
