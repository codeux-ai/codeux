/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { KineticDock } from '../../KineticDock.js';
import * as ProjectDataHook from '../../../context/project-data.js';
import * as ProjectEffectiveSettingsHook from '../../../hooks/use-project-effective-settings.js';
import * as ReducedMotionHook from '../../../hooks/use-reduced-motion.js';
import * as RouterHook from '@tanstack/react-router';
import * as matchers from '@testing-library/jest-dom/matchers';
import { forwardRef } from 'preact/compat';

expect.extend(matchers);

vi.mock('../../../context/project-data.js');
vi.mock('../../../hooks/use-project-effective-settings.js');
vi.mock('../../../hooks/use-reduced-motion.js');
vi.mock('@tanstack/react-router', async () => {
    const actual = await vi.importActual('@tanstack/react-router');
    const { forwardRef } = await vi.importActual('preact/compat') as any;
    return {
        ...actual as any,
        useRouterState: vi.fn(),
        Link: forwardRef(({ children, to, className }: any, ref: any) => <a ref={ref} href={to} data-testid={`link-${to}`} className={className}>{children}</a>)
    };
});

describe('BottomNavigationDock (KineticDock)', () => {
    beforeEach(() => {
        vi.spyOn(ProjectDataHook, 'useProjectData').mockReturnValue({ selectedProject: { id: 'test-project' } } as any);
        vi.spyOn(ProjectEffectiveSettingsHook, 'useProjectEffectiveSettings').mockReturnValue({ data: { settings: { sprintPreview: { enabled: true, showInAppBrowser: true } } } } as any);
        // CRITICAL: We must mock useReducedMotion to FALSE to prove that even when animations are enabled,
        // the cursor-snapping behavior is intentionally gone.
        vi.spyOn(ReducedMotionHook, 'useReducedMotion').mockReturnValue(false);
        vi.spyOn(RouterHook, 'useRouterState').mockReturnValue({ matches: [{ pathname: '/' }] } as any);
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('should assert that cursor proximity does not trigger style transforms (no cursor snapping)', () => {
        const { container } = render(<KineticDock />);

        const nav = screen.getByRole('navigation', { name: 'Dock navigation' });
        expect(nav).toBeInTheDocument();

        const overviewLink = screen.getByTestId('link-/');

        // Initial state should not have inline transform applied to the link
        expect(overviewLink.style.transform).toBe('');

        // Simulate pointer movement across the dock
        fireEvent.mouseMove(nav, { clientX: 100, clientY: 100 });
        fireEvent.mouseMove(overviewLink, { clientX: 150, clientY: 150 });

        // Inline transform should still be empty (no js-based proximity snapping applied)
        expect(overviewLink.style.transform).toBe('');
    });

    it('should verify that hover and active states still apply static CSS lift-up classes', () => {
        render(<KineticDock />);

        // The inner icon wrapper that receives the hover transform classes
        const overviewLink = screen.getByTestId('link-/');
        const iconWrapper = overviewLink.querySelector('div.transition-transform');

        expect(iconWrapper).toBeInTheDocument();
        // Check for the explicit presence of the static CSS class handling the lift
        expect(iconWrapper?.className).toContain('group-hover:-translate-y-2.5');
        expect(iconWrapper?.className).toContain('group-hover:scale-[1.15]');
    });

    it('should support keyboard navigation paths without modifying pointer-specific styles', () => {
        render(<KineticDock />);

        const overviewLink = screen.getByTestId('link-/');

        overviewLink.focus();

        // Ensure keyboard focus doesn't trigger JS transform manipulation
        expect(overviewLink.style.transform).toBe('');
        // Ensure standard hover class is present, which standard browser behavior handles with :focus-visible / group-focus etc if defined,
        // or ensure no crash/override happens during keyboard focus.
        const iconWrapper = overviewLink.querySelector('div.transition-transform');
        expect(iconWrapper?.className).toContain('group-hover:-translate-y-2.5');
    });
});
