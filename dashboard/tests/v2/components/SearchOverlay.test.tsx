
beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();
});

// @vitest-environment jsdom
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { expect, describe, it, vi, beforeAll } from 'vitest';
import { SearchOverlay } from '../../../src/v2/components/search/SearchOverlay';

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>
}));

vi.mock('../../../src/v2/hooks/use-reduced-motion.js', () => ({
    useReducedMotion: () => false
}));

describe('SearchOverlay', () => {
    it('renders quick navigation when query is empty', () => {
        const onClose = vi.fn();
        const results = { sprints: [], tasks: [], agents: [], containers: [] };

        render(
            <SearchOverlay
                isOpen={true}
                onClose={onClose}
                searchQuery=""
                onSearchChange={() => {}}
                results={results}
            />
        );

        expect(screen.getByText('Quick navigation')).not.toBeNull();
        expect(screen.getByText('Sprints')).not.toBeNull();
        expect(screen.getByText('Tasks')).not.toBeNull();
        expect(screen.getByText('Agents')).not.toBeNull();

    });

    it('provides accessible roles and attributes for the search dialog', () => {
        const onClose = vi.fn();
        const results = { sprints: [], tasks: [], agents: [], containers: [] };

        render(
            <SearchOverlay
                isOpen={true}
                onClose={onClose}
                searchQuery=""
                onSearchChange={() => {}}
                results={results}
            />
        );

        const dialog = screen.getAllByRole('dialog')[0];
        expect(dialog).not.toBeNull();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBe('search-dialog-title');

        const heading = screen.getAllByText('Search', { selector: 'h2' })[0];
        expect(heading.id).toBe('search-dialog-title');
        expect(heading.className).toContain('sr-only');

        const input = screen.getAllByRole('combobox')[0];
        expect(input).not.toBeNull();
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect(input.getAttribute('aria-controls')).toBe('search-results-listbox');

        const listbox = screen.getAllByRole('listbox')[0];
        expect(listbox.id).toBe('search-results-listbox');
    });

    it('announces live region updates based on status and result counts', () => {
        const { rerender } = render(
            <SearchOverlay
                isOpen={true}
                onClose={() => {}}
                searchQuery="query"
                onSearchChange={() => {}}
                results={{ sprints: [], tasks: [], agents: [], containers: [] }}
                isLoading={true}
            />
        );

        let liveRegion = screen.getAllByText('Searching...')[0];
        expect(liveRegion.closest('[aria-live="polite"]')).not.toBeNull();

        rerender(
            <SearchOverlay
                isOpen={true}
                onClose={() => {}}
                searchQuery="query"
                onSearchChange={() => {}}
                results={{ sprints: [], tasks: [], agents: [], containers: [] }}
                isLoading={false}
            />
        );
        expect(screen.getAllByText("No results found for 'query'")[0]).not.toBeNull(); // This is the visual message
        expect(screen.getByText("No results found for 'query'", { selector: '[aria-live="polite"]' })).not.toBeNull(); // This is the live region

        const mockItem = { id: '1', title: 'Test', category: 'sprints' };
        rerender(
            <SearchOverlay
                isOpen={true}
                onClose={() => {}}
                searchQuery="test"
                onSearchChange={() => {}}
                results={{ sprints: [mockItem], tasks: [], agents: [], containers: [] }}
                isLoading={false}
            />
        );
        expect(screen.getByText('1 results found.', { selector: '[aria-live="polite"]' })).not.toBeNull();
    });

    it.skip('manages active descendant and aria-selected for results', () => {
        const mockItem1 = { id: '1', title: 'Test Sprint', category: 'sprints' };
        const mockItem2 = { id: '2', title: 'Test Task', category: 'tasks' };

        render(
            <SearchOverlay
                isOpen={true}
                onClose={() => {}}
                searchQuery="test"
                onSearchChange={() => {}}
                results={{ sprints: [mockItem1], tasks: [mockItem2], agents: [], containers: [] }}
                isLoading={false}
            />
        );

        const options = screen.getAllByRole('option');
        expect(options.length).toBeGreaterThanOrEqual(2);

        const input = screen.getAllByRole('combobox')[0];
        expect(input.getAttribute('aria-activedescendant')).toBeFalsy();

        // Use document.body to trigger event listeners attached to window
        fireEvent.keyDown(window, { key: 'ArrowDown' });

        // The first option should now be focused
        expect(input.getAttribute('aria-activedescendant')).toBe('search-result-item-0');
        expect(options[0].getAttribute('aria-selected')).toBe('true');
        expect(options[1].getAttribute('aria-selected')).toBe('false');

        // Go to second option
        act(() => {
            fireEvent.keyDown(document.body, { key: 'ArrowDown', code: 'ArrowDown' });
        });
        expect(input.getAttribute('aria-activedescendant')).toBe('search-result-item-1');

        // Wrap around back to first using ArrowDown
        act(() => {
            fireEvent.keyDown(document.body, { key: 'ArrowDown', code: 'ArrowDown' });
        });
        expect(input.getAttribute('aria-activedescendant')).toBe('search-result-item-0');

        // Wrap around to last using ArrowUp
        act(() => {
            fireEvent.keyDown(document.body, { key: 'ArrowUp', code: 'ArrowUp' });
        });
        expect(input.getAttribute('aria-activedescendant')).toBe('search-result-item-1');
    });
});
