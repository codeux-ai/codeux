// @vitest-environment jsdom
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { expect, describe, it, vi } from 'vitest';
import { SearchOverlay } from '../../../src/v2/components/search/SearchOverlay';

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn()
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
});
