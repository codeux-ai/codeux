/**
 * @vitest-environment jsdom
 */
import { render, fireEvent, screen, waitFor } from '@testing-library/preact';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourceCell } from '../../../src/v2/components/ui/SourceCell';

const { navigate, selectProject } = vi.hoisted(() => ({
    navigate: vi.fn(),
    selectProject: vi.fn(),
}));

vi.mock('gsap', () => ({
    default: {
        to: vi.fn(),
    },
}));

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
}));

vi.mock('../../../src/v2/context/project-data.js', () => ({
    useProjectData: () => ({
        selectProject,
    }),
}));

describe('SourceCell', () => {
    beforeEach(() => {
        navigate.mockReset();
        selectProject.mockReset();
        selectProject.mockResolvedValue(undefined);
    });

    it('selects the project before opening sprints or settings', async () => {
        render(
            <SourceCell
                source={{
                    id: 'project-1',
                    name: 'Project 1',
                    status: 'idle',
                    openTasks: 2,
                    completedTasks: 4,
                } as any}
                isEven={true}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Open' }));

        await waitFor(() => {
            expect(selectProject).toHaveBeenCalledWith('project-1');
        });
        expect(navigate).toHaveBeenCalledWith({ to: '/sprints' });

        selectProject.mockClear();
        navigate.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        await waitFor(() => {
            expect(selectProject).toHaveBeenCalledWith('project-1');
        });
        expect(navigate).toHaveBeenCalledWith({ to: '/config' });
    });
});
