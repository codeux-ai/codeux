/**
 * @vitest-environment jsdom
 */
import { render, fireEvent, screen } from '@testing-library/preact';
import { describe, it, expect, vi } from 'vitest';
import { CellActions } from '../../../src/v2/components/ui/CellActions';

describe('CellActions', () => {
    it('invokes open, settings, and primary handlers without bubbling', () => {
        const parentClick = vi.fn();
        const onOpen = vi.fn();
        const onSettings = vi.fn();
        const onPrimaryAction = vi.fn();

        render(
            <div onClick={parentClick}>
                <CellActions
                    isRunning={false}
                    onPrimaryAction={onPrimaryAction}
                    onOpen={onOpen}
                    onSettings={onSettings}
                />
            </div>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Open' }));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(parentClick).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(onSettings).toHaveBeenCalledTimes(1);
        expect(parentClick).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Play' }));
        expect(onPrimaryAction).toHaveBeenCalledTimes(1);
        expect(parentClick).not.toHaveBeenCalled();
    });
});
