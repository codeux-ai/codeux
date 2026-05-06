import type { RefObject } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';

export type InteractionState = 'closed' | 'hover' | 'open';

export interface UseMenuInteractionProps {
    containerRef: RefObject<HTMLElement>;
    menuId?: string;
    hoverDelay?: number;
    onOpen?: () => void;
}

export function useMenuInteraction({
    containerRef,
    menuId,
    hoverDelay = 150,
    onOpen
}: UseMenuInteractionProps) {
    const [interactionState, setInteractionState] = useState<InteractionState>('closed');
    const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isVisible = interactionState !== 'closed';

    const clearHoverTimeout = () => {
        if (hoverTimeout.current) {
            clearTimeout(hoverTimeout.current);
            hoverTimeout.current = null;
        }
    };

    const handleMouseEnter = () => {
        clearHoverTimeout();
        if (interactionState === 'closed') {
            onOpen?.();
            setInteractionState('hover');
        }
    };

    const handleMouseLeave = () => {
        clearHoverTimeout();
        if (interactionState === 'hover') {
            hoverTimeout.current = setTimeout(() => {
                setInteractionState('closed');
            }, hoverDelay);
        }
    };

    const handleFocus = () => {
        clearHoverTimeout();
        if (interactionState === 'closed' || interactionState === 'hover') {
            onOpen?.();
            setInteractionState('open');
        }
    };

    const handleBlur = (e: FocusEvent) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setInteractionState('closed');
        }
    };

    const toggleMenu = () => {
        clearHoverTimeout();
        if (interactionState === 'closed' || interactionState === 'hover') {
            onOpen?.();
            setInteractionState('open');
        } else {
            setInteractionState('closed');
        }
    };

    useEffect(() => {
        if (!isVisible) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setInteractionState('closed');
                const triggerBtn = containerRef.current?.querySelector('button');
                setTimeout(() => triggerBtn?.focus(), 0);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isVisible, containerRef]);

    useEffect(() => {
        if (!isVisible) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setInteractionState('closed');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isVisible, containerRef]);

    useEffect(() => {
        return clearHoverTimeout;
    }, []);

    const getTriggerProps = () => ({
        'aria-haspopup': 'menu' as const,
        'aria-expanded': isVisible,
        'aria-controls': isVisible && menuId ? menuId : undefined,
        onClick: toggleMenu,
        onFocus: handleFocus,
        onBlur: handleBlur,
    });

    const getContainerProps = () => ({
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
    });

    return {
        interactionState,
        setInteractionState,
        isVisible,
        toggleMenu,
        handleMouseEnter,
        handleMouseLeave,
        handleFocus,
        handleBlur,
        getTriggerProps,
        getContainerProps,
    };
}
