import { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useRef, useState, useEffect } from "preact/hooks";
import { Bell } from "lucide-preact";
import { Tooltip } from "../ui/Tooltip.js";
import { NotificationPanel } from "../NotificationPanel.js";
import { useNotifications } from "../../hooks/use-notifications.js";

export const NotificationIndicator: FunctionComponent = memo(() => {
    const notifications = useNotifications();
    const [notificationInteractionState, setNotificationInteractionState] = useState<'closed' | 'hover' | 'open'>('closed');
    const isNotificationMenuVisible = notificationInteractionState !== 'closed';
    const notificationHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const notificationContainerRef = useRef<HTMLDivElement>(null);

    const handleNotificationMouseEnter = () => {
        if (notificationHoverTimeout.current) clearTimeout(notificationHoverTimeout.current);
        if (notificationInteractionState === 'closed') {
            setNotificationInteractionState('hover');
        }
    };

    const handleNotificationMouseLeave = () => {
        if (notificationInteractionState === 'hover') {
            notificationHoverTimeout.current = setTimeout(() => {
                setNotificationInteractionState((prev) => (prev === 'hover' ? 'closed' : prev));
            }, 150);
        }
    };

    const handleNotificationFocus = () => {
        if (notificationHoverTimeout.current) clearTimeout(notificationHoverTimeout.current);
        setNotificationInteractionState('open');
    };

    const handleNotificationBlur = (e: FocusEvent) => {
        if (!notificationContainerRef.current?.contains(e.relatedTarget as Node)) {
            setNotificationInteractionState('closed');
        }
    };

    const toggleNotificationMenu = () => {
        if (notificationHoverTimeout.current) clearTimeout(notificationHoverTimeout.current);
        setNotificationInteractionState((prev) => (prev === 'closed' || prev === 'hover' ? 'open' : 'closed'));
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isNotificationMenuVisible) {
                setNotificationInteractionState('closed');
                const triggerBtn = notificationContainerRef.current?.querySelector('button');
                setTimeout(() => triggerBtn?.focus(), 0);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isNotificationMenuVisible]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isNotificationMenuVisible && notificationContainerRef.current && !notificationContainerRef.current.contains(e.target as Node)) {
                setNotificationInteractionState('closed');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isNotificationMenuVisible]);

    return (
        <div
            className="relative hidden md:inline-block"
            ref={notificationContainerRef}
            onMouseEnter={handleNotificationMouseEnter}
            onMouseLeave={handleNotificationMouseLeave}
        >
            <Tooltip content="Notifications">
                <button
                    type="button"
                    onClick={toggleNotificationMenu}
                    onFocus={handleNotificationFocus}
                    onBlur={handleNotificationBlur}
                    aria-haspopup="menu"
                    aria-expanded={isNotificationMenuVisible}
                    aria-label="Notifications"
                    className="relative w-11 h-11 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors group focus-visible:ring-2 focus-visible:ring-signal-500/30"
                >
                    <Bell aria-hidden="true" className="w-4 h-4 text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors" strokeWidth={1.5} />
                    {notifications.unreadCount > 0 && (
                        <span className="absolute top-2.5 right-2.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-status-red px-1 text-[9px] font-black leading-none text-white shadow-[0_0_10px_rgba(211,47,47,0.35)] ring-1 ring-[#F9F8F4] dark:ring-void-900">
                            {notifications.unreadCount > 9 ? "9+" : notifications.unreadCount}
                        </span>
                    )}
                </button>
            </Tooltip>
            {isNotificationMenuVisible && (
                <NotificationPanel
                    notifications={notifications.notifications}
                    unreadCount={notifications.unreadCount}
                    onMarkAllRead={notifications.markAllRead}
                    onMarkRead={notifications.markRead}
                    onDismiss={notifications.dismiss}
                    onRefresh={() => void notifications.refresh()}
                />
            )}
        </div>
    );
});
