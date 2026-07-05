import { type FunctionComponent, type JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ChevronDown, ExternalLink, Play } from "lucide-preact";
import type { SprintPreviewPortMapping, SprintPreviewSession } from "../../../types.js";
import { buildPreviewUrl } from "../../lib/preview-origin.js";
import { getSafeUrl } from "../../lib/safe-url.js";

interface LivePreviewLinkProps {
    session: SprintPreviewSession | null;
}

const getPortMappings = (session: SprintPreviewSession): SprintPreviewPortMapping[] => {
    if (Array.isArray(session.portMappings) && session.portMappings.length > 0) {
        return session.portMappings;
    }
    return [{
        containerPort: session.containerAppPort,
        hostPort: session.hostPort,
        isPrimary: true,
    }];
};

const getPrimaryMapping = (session: SprintPreviewSession): SprintPreviewPortMapping => {
    const mappings = getPortMappings(session);
    return mappings.find((mapping) => mapping.isPrimary === true) ?? mappings[0] ?? {
        containerPort: session.containerAppPort,
        hostPort: session.hostPort,
        isPrimary: true,
    };
};

const getMappingLabel = (mapping: SprintPreviewPortMapping): string => {
    return mapping.label?.trim() || `Port ${mapping.containerPort}`;
};

const getUnavailableReason = (mapping: SprintPreviewPortMapping): string => {
    return `${getMappingLabel(mapping)} is waiting for a routed host port.`;
};

const buildMappingPreviewUrl = (session: SprintPreviewSession, mapping: SprintPreviewPortMapping): string => {
    const url = new URL(buildPreviewUrl(session.id, session.lastKnownPath));
    url.searchParams.set("previewPort", String(mapping.containerPort));
    return url.toString();
};

export const LivePreviewLink: FunctionComponent<LivePreviewLinkProps> = ({ session }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const pendingFocusRef = useRef<"first" | "last" | null>(null);
    const [listboxId] = useState(() => `live-preview-ports-${Math.random().toString(36).slice(2, 9)}`);

    const getEnabledOptions = useCallback((): HTMLElement[] => {
        if (!containerRef.current) {
            return [];
        }
        return Array.from(
            containerRef.current.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])'),
        );
    }, []);

    const closeMenu = useCallback((restoreFocus = true) => {
        setIsOpen(false);
        pendingFocusRef.current = null;
        if (restoreFocus) {
            queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }));
        }
    }, []);

    const focusOption = useCallback((position: "first" | "last"): void => {
        const options = getEnabledOptions();
        const option = position === "first" ? options[0] : options[options.length - 1];
        option?.focus({ preventScroll: true });
    }, [getEnabledOptions]);

    const openMenu = (position: "first" | "last" = "first"): void => {
        pendingFocusRef.current = position;
        setIsOpen(true);
    };

    useEffect(() => {
        if (!isOpen || !pendingFocusRef.current) {
            return;
        }
        const position = pendingFocusRef.current;
        queueMicrotask(() => {
            focusOption(position);
            pendingFocusRef.current = null;
        });
    }, [focusOption, isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleDocumentMouseDown = (event: MouseEvent): void => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                closeMenu(false);
            }
        };
        const handleDocumentKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeMenu();
            }
        };

        document.addEventListener("mousedown", handleDocumentMouseDown);
        document.addEventListener("keydown", handleDocumentKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleDocumentMouseDown);
            document.removeEventListener("keydown", handleDocumentKeyDown);
        };
    }, [closeMenu, isOpen]);

    useEffect(() => {
        setIsOpen(false);
        pendingFocusRef.current = null;
    }, [session?.id]);

    if (!session || session.status !== "running" || !session.hostPort) {
        return null;
    }

    const previewUrl = buildPreviewUrl(session.id, session.lastKnownPath);
    const portMappings = getPortMappings(session);
    const primaryMapping = getPrimaryMapping(session);
    const hasPortMenu = portMappings.length > 1;

    const handleTriggerKeyDown: JSX.KeyboardEventHandler<HTMLButtonElement> = (event) => {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMenu("first");
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openMenu("last");
        } else if (event.key === "Escape" && isOpen) {
            event.preventDefault();
            closeMenu();
        }
    };

    const handleListboxKeyDown: JSX.KeyboardEventHandler<HTMLDivElement> = (event) => {
        const options = getEnabledOptions();
        if (options.length === 0) {
            return;
        }

        const currentIndex = options.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
            options[nextIndex]?.focus({ preventScroll: true });
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            const previousIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
            options[previousIndex]?.focus({ preventScroll: true });
        } else if (event.key === "Home") {
            event.preventDefault();
            options[0]?.focus({ preventScroll: true });
        } else if (event.key === "End") {
            event.preventDefault();
            options[options.length - 1]?.focus({ preventScroll: true });
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
        }
    };
    const firstRoutedOptionIndex = portMappings.findIndex((mapping) => Boolean(mapping.hostPort));

    return (
        <div ref={containerRef} className="relative inline-flex items-stretch">
            <a
                href={getSafeUrl(previewUrl)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open Live Preview on ${getMappingLabel(primaryMapping)}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-signal-500 hover:bg-signal-600 shadow-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 ${hasPortMenu ? "rounded-l-[10px] rounded-r-none" : "rounded-[10px]"}`}
            >
                <Play className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true" />
                Live Preview
                <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-80" strokeWidth={2.5} aria-hidden="true" />
            </a>
            {hasPortMenu && (
                <>
                    <button
                        ref={triggerRef}
                        type="button"
                        aria-label="Choose Live Preview port"
                        aria-haspopup="listbox"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? listboxId : undefined}
                        onClick={() => {
                            if (isOpen) {
                                closeMenu(false);
                            } else {
                                openMenu("first");
                            }
                        }}
                        onKeyDown={handleTriggerKeyDown}
                        className="flex w-8 items-center justify-center rounded-r-[10px] border-l border-white/20 bg-signal-500 text-white shadow-sm transition-colors duration-200 hover:bg-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45"
                    >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                    {isOpen && (
                        <div
                            id={listboxId}
                            role="listbox"
                            aria-label="Live Preview ports"
                            onKeyDown={handleListboxKeyDown}
                            className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-black/[0.08] bg-white/95 py-1 shadow-[0_16px_36px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-white/[0.1] dark:bg-void-800/95"
                        >
                            {portMappings.map((mapping, index) => {
                                const label = getMappingLabel(mapping);
                                const optionText = `:${mapping.containerPort}${mapping.hostPort ? ` -> :${mapping.hostPort}` : " -> pending"}`;
                                if (!mapping.hostPort) {
                                    const reason = getUnavailableReason(mapping);
                                    return (
                                        <div
                                            key={`${mapping.containerPort}-${index}`}
                                            role="option"
                                            aria-disabled="true"
                                            aria-label={`${label} unavailable. ${reason}`}
                                            tabIndex={-1}
                                            className="flex cursor-not-allowed flex-col gap-0.5 px-3 py-2.5 text-left opacity-70"
                                        >
                                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>
                                            <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{optionText}</span>
                                            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{reason}</span>
                                        </div>
                                    );
                                }
                                return (
                                    <a
                                        key={`${mapping.containerPort}-${index}`}
                                        href={getSafeUrl(buildMappingPreviewUrl(session, mapping))}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        role="option"
                                        aria-selected={mapping.containerPort === primaryMapping.containerPort}
                                        aria-label={`Open Live Preview ${label} on container port ${mapping.containerPort}`}
                                        tabIndex={index === firstRoutedOptionIndex ? 0 : -1}
                                        onClick={() => closeMenu(false)}
                                        className="flex flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.04] focus:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal-500/45 dark:hover:bg-white/[0.06] dark:focus:bg-white/[0.06]"
                                    >
                                        <span className="flex items-center justify-between gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                                            {label}
                                            <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={2.4} aria-hidden="true" />
                                        </span>
                                        <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{optionText}</span>
                                    </a>
                                );
                            })}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
