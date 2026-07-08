/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { KineticDock } from '../../KineticDock.js';
import * as ProjectDataHook from '../../../context/project-data.js';
import * as ProjectEffectiveSettingsHook from '../../../hooks/use-project-effective-settings.js';
import * as ReducedMotionHook from '../../../hooks/use-reduced-motion.js';
import * as RouterHook from '@tanstack/react-router';
import { prefetchRoute } from '../../../router/route-prefetch.js';
import * as matchers from '@testing-library/jest-dom/matchers';
import { forwardRef } from 'preact/compat';
import { EXTERNAL_DOCS_URL } from '../../../lib/navigation-items.js';

expect.extend(matchers);

vi.mock('../../../context/project-data.js');
vi.mock('../../../hooks/use-project-effective-settings.js');
vi.mock('../../../hooks/use-reduced-motion.js');
vi.mock('../../../router/route-prefetch.js', () => ({
    prefetchRoute: vi.fn(),
}));
vi.mock('@tanstack/react-router', async () => {
    const actual = await vi.importActual('@tanstack/react-router');
    const { forwardRef } = await vi.importActual('preact/compat') as any;
    return {
        ...actual as any,
        useRouterState: vi.fn(),
        Link: forwardRef(({ children, to, className, ...props }: any, ref: any) => <a ref={ref} href={to} data-testid={`link-${to}`} className={className} {...props}>{children}</a>)
    };
});

describe('BottomNavigationDock (KineticDock)', () => {
    beforeEach(() => {
        vi.spyOn(ProjectDataHook, 'useProjectData').mockReturnValue({ selectedProject: { id: 'test-project' } } as any);
        vi.spyOn(ProjectEffectiveSettingsHook, 'useProjectEffectiveSettings').mockReturnValue({ data: { settings: { appearance: { experienceMode: 'EXPERT' }, sprintPreview: { enabled: true, showInAppBrowser: true } } } } as any);
        // CRITICAL: We must mock useReducedMotion to FALSE to prove that even when animations are enabled,
        // the cursor-snapping behavior is intentionally gone.
        vi.spyOn(ReducedMotionHook, 'useReducedMotion').mockReturnValue(false);
        vi.spyOn(RouterHook, 'useRouterState').mockReturnValue([{ pathname: '/' }] as any);
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
        const iconWrapper = overviewLink.querySelector('svg');

        expect(iconWrapper).toBeInTheDocument();
        // Check for the explicit presence of the static CSS class handling the lift
        expect(iconWrapper?.getAttribute('class')).toContain('group-active:-translate-y-1.5');
        expect(iconWrapper?.getAttribute('class')).toContain('group-active:scale-[1.15]');
    });

    it('should support keyboard navigation paths without modifying pointer-specific styles', () => {
        render(<KineticDock />);

        const overviewLink = screen.getByTestId('link-/');

        overviewLink.focus();

        // Ensure keyboard focus doesn't trigger JS transform manipulation
        expect(overviewLink.style.transform).toBe('');
        // Ensure standard hover class is present, which standard browser behavior handles with :focus-visible / group-focus etc if defined,
        // or ensure no crash/override happens during keyboard focus.
        const iconWrapper = overviewLink.querySelector('svg');
        expect(iconWrapper?.getAttribute('class')).toContain('group-focus-visible:-translate-y-1.5');
    });

    it('should respect safe-area-inset on the dock container and apply scroll padding', () => {
        render(<KineticDock />);

        const nav = screen.getByRole('navigation', { name: 'Dock navigation' });
        expect(nav.getAttribute('class')).toContain('scroll-px-4');

        // The outer div should have the dynamic height calculation and bottom 0
        const outerDiv = nav.parentElement;
        expect(outerDiv?.getAttribute('class')).toContain('bottom-0');
        expect(outerDiv).toHaveStyle({
            height: 'calc(7rem + env(safe-area-inset-bottom) + 20px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
        });

        // Assert the spacer div is present before the live route status.
        expect(nav.querySelector('.w-\\[1px\\].shrink-0')).toBeInTheDocument();
    });

    it('renders Docs as an external link without route prefetch', () => {
        render(<KineticDock />);

        const docsLink = screen.getByRole('link', { name: 'Docs' });
        expect(docsLink).toHaveAttribute('href', EXTERNAL_DOCS_URL);
        expect(docsLink).toHaveAttribute('target', '_blank');
        expect(docsLink).toHaveAttribute('data-tour-id', 'nav-docs');

        fireEvent.mouseEnter(docsLink);
        fireEvent.pointerDown(docsLink);
        docsLink.focus();

        expect(prefetchRoute).not.toHaveBeenCalledWith(EXTERNAL_DOCS_URL);
    });

    it('renders Chat as the left dock route and prefetches it on intent', () => {
        vi.spyOn(RouterHook, 'useRouterState').mockReturnValue([{ pathname: '/chat' }] as any);

        render(<KineticDock />);

        const links = screen.getAllByRole('link');
        const chatLink = screen.getByRole('link', { name: 'Chat' });
        expect(links[0]).toBe(chatLink);
        expect(chatLink).toHaveAttribute('href', '/chat');
        expect(chatLink).toHaveAttribute('aria-current', 'page');
        expect(chatLink).toHaveAttribute('data-active', 'true');
        expect(chatLink).toHaveAttribute('data-tour-id', 'nav-chat');
        expect(screen.getByText('Active route: Chat')).toBeInTheDocument();

        fireEvent.mouseEnter(chatLink);
        fireEvent.pointerDown(chatLink);
        chatLink.focus();

        expect(prefetchRoute).toHaveBeenCalledTimes(3);
        expect(prefetchRoute).toHaveBeenNthCalledWith(1, '/chat');
        expect(prefetchRoute).toHaveBeenNthCalledWith(2, '/chat');
        expect(prefetchRoute).toHaveBeenNthCalledWith(3, '/chat');
    });
});
