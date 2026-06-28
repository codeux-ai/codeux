// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { expect, test, describe, afterEach } from 'vitest';
import { Input } from '../../../src/v2/components/ui/Input';

describe('Input', () => {
    afterEach(() => {
        cleanup();
    });

    test('renders', () => {
        render(<Input />);
        expect(screen.getByRole('textbox')).not.toBeNull();
    });

    test('shows character counter when typing', async () => {
        render(<Input maxLength={20} />);
        const input = screen.getByRole('textbox');

        // At 15 chars (75%), counter should not be visible
        fireEvent.input(input, { target: { value: '123456789012345' } });
        expect(screen.queryByText(/15 \/ 20/)).toBeNull();

        // At 16 chars (80%), counter should be visible
        fireEvent.input(input, { target: { value: '1234567890123456' } });
        expect(screen.getByText('16 / 20')).not.toBeNull();
        expect(screen.getByText('16 / 20').className).toContain('text-slate-400');

        // At 18 chars (90%), counter should be amber
        fireEvent.input(input, { target: { value: '123456789012345678' } });
        expect(screen.getByText('18 / 20').className).toContain('text-amber-500');

        // At 20 chars (100%), counter should be red
        fireEvent.input(input, { target: { value: '12345678901234567890' } });
        expect(screen.getByText('20 / 20').className).toContain('text-red-500');
        expect(screen.getByText('20 / 20').className).toContain('animate-form-shake');

        // Back to 15 chars, counter should fade out
        fireEvent.input(input, { target: { value: '123456789012345' } });
        expect(screen.getByText('15 / 20').className).toContain('opacity-0');
    });

    test('no counter if maxLength not provided', () => {
        render(<Input />);
        const input = screen.getByRole('textbox');
        fireEvent.input(input, { target: { value: '12345678901234567890' } });
        expect(screen.queryByText(/\//)).toBeNull();
    });
});
