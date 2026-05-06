/**
 * @vitest-environment jsdom
 */
import { render, fireEvent, screen, cleanup } from '@testing-library/preact';
import { Button } from '../../../dashboard/src/v2/components/ui/Button';
import { IconButton } from '../../../dashboard/src/v2/components/IconButton';
import { vi, describe, it, expect, afterEach } from 'vitest';

describe('Button and IconButton pending/disabled states', () => {
    afterEach(() => {
        cleanup();
    });

    it('Button pending state is non-clickable but retains focus', () => {
        const onClick = vi.fn();
        render(<Button pending onClick={onClick}>Click me</Button>);
        const btn = screen.getByRole('button');

        expect(btn.getAttribute('aria-busy')).toBe('true');
        expect(btn.getAttribute('aria-disabled')).toBe('true');
        expect(btn.hasAttribute('disabled')).toBe(false);

        fireEvent.click(btn);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('IconButton pending state is non-clickable but retains focus', () => {
        const onClick = vi.fn();
        render(<IconButton pending onClick={onClick}>Icon</IconButton>);
        const btn = screen.getByRole('button');

        expect(btn.getAttribute('aria-busy')).toBe('true');
        expect(btn.getAttribute('aria-disabled')).toBe('true');
        expect(btn.hasAttribute('disabled')).toBe(false);

        fireEvent.click(btn);
        expect(onClick).not.toHaveBeenCalled();
    });
});
