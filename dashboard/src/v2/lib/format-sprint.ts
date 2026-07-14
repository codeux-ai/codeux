import { translateDashboardMessage, type DashboardLocale } from "../i18n/locales.js";
import { sprintsMessages } from "../i18n/messages/sprints.js";

export function formatSprintTitle(sprint?: { name?: string; sprintNumber?: number | string | null; number?: number | string | null } | null, sprintKeyPrefix: string = "SPR", locale: DashboardLocale = "en"): string {
    if (!sprint) return translateDashboardMessage(sprintsMessages, locale, "allSprints");

    let num = sprint.sprintNumber || sprint.number;
    let name = sprint.name;

    // Attempt to extract sprint number if not provided
    if (!num && name) {
        const prefixEscaped = sprintKeyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = name.match(new RegExp(`^${prefixEscaped}-(\\d+)`, 'i'));
        if (match) {
            num = match[1];
        }
    }

    if (num) {
        // Strip out existing prefix-<num> from the name to prevent duplication
        // It handles optional spaces and colons/hyphens
        const prefixEscaped = sprintKeyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const prefixRegex = new RegExp(`^${prefixEscaped}-${num}\\s*[:\\-]?\\s*`, 'i');
        return name ? name.replace(prefixRegex, '') : translateDashboardMessage(sprintsMessages, locale, "sprintNumber", { number: num });
    }

    return name || translateDashboardMessage(sprintsMessages, locale, "unnamedSprint");
}

export function formatSprintDisplay(sprint?: { name?: string; sprintNumber?: number | string | null; number?: number | string | null } | null, sprintKeyPrefix: string = "SPR", locale: DashboardLocale = "en"): string {
    if (!sprint) return translateDashboardMessage(sprintsMessages, locale, "allSprints");

    let num = sprint.sprintNumber || sprint.number;
    const name = sprint.name;
    if (!num && name) {
        const prefixEscaped = sprintKeyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = name.match(new RegExp(`^${prefixEscaped}-(\\d+)`, 'i'));
        if (match) {
            num = match[1];
        }
    }
    if (num) {
        return `${sprintKeyPrefix}-${num}: ${formatSprintTitle(sprint, sprintKeyPrefix, locale)}`;
    }

    return formatSprintTitle(sprint, sprintKeyPrefix, locale);
}
